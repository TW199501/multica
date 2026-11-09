package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/aisettings"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/llm"
)

var aiSettingsProviders = map[string]struct{}{
	"claude": {}, "openai": {}, "gemini": {}, "deepseek": {}, "qwen": {}, "kimi": {},
	"zhipu": {}, "tencent": {}, "grok": {}, "openrouter": {}, "huggingface": {},
	"llamacpp": {}, "custom": {},
}

type aiSettingsResponse struct {
	SecretKeyAvailable bool    `json:"secret_key_available"`
	Configured         bool    `json:"configured"`
	Provider           string  `json:"provider"`
	BaseURL            string  `json:"base_url"`
	Model              string  `json:"model"`
	DisableThinking    bool    `json:"disable_thinking"`
	Prompt             string  `json:"prompt"`
	DefaultPrompt      string  `json:"default_prompt"`
	PromptSkillID      *string `json:"prompt_skill_id"`
	APIKeySet          bool    `json:"api_key_set"`
	APIKeyLast4        string  `json:"api_key_last4"`
	LastCalledAt       *string `json:"last_called_at"`
}

type aiSettingsRequest struct {
	Provider        string  `json:"provider"`
	BaseURL         string  `json:"base_url"`
	Model           string  `json:"model"`
	DisableThinking bool    `json:"disable_thinking"`
	Prompt          string  `json:"prompt"`
	PromptSkillID   *string `json:"prompt_skill_id"`
	APIKey          *string `json:"api_key"`
	ClearAPIKey     bool    `json:"clear_api_key"`
}

func (h *Handler) aiSettingsKeyAvailable() bool {
	return h.AISettings != nil && h.AISettings.SecretKeyAvailable()
}

func (h *Handler) aiSettingsResponse(s aisettings.Settings, configured bool) aiSettingsResponse {
	return aiSettingsResponse{
		SecretKeyAvailable: h.aiSettingsKeyAvailable(),
		Configured:         configured,
		Provider:           s.Provider,
		BaseURL:            s.BaseURL,
		Model:              s.Model,
		DisableThinking:    s.DisableThinking,
		Prompt:             s.Prompt,
		DefaultPrompt:      aisettings.DefaultPrompt(),
		PromptSkillID:      uuidToPtr(s.PromptSkillID),
		APIKeySet:          s.APIKeySet,
		APIKeyLast4:        s.APIKeyLast4,
		LastCalledAt:       timestampToPtr(s.LastCalledAt),
	}
}

// GetAISettings returns the workspace's AI settings without any key material.
func (h *Handler) GetAISettings(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "workspace id")
	if !ok {
		return
	}
	if h.AISettings == nil {
		writeJSON(w, http.StatusOK, h.aiSettingsResponse(aisettings.Settings{}, false))
		return
	}
	s, found, err := h.AISettings.Get(r.Context(), workspaceID)
	if err != nil {
		slog.Error("ai settings: load failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load AI settings")
		return
	}
	writeJSON(w, http.StatusOK, h.aiSettingsResponse(s, found))
}

// PutAISettings validates and stores the workspace's AI settings. An omitted
// api_key keeps the stored key.
func (h *Handler) PutAISettings(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "workspace id")
	if !ok {
		return
	}
	userID, ok := parseUUIDOrBadRequest(w, requestUserID(r), "user id")
	if !ok {
		return
	}
	if !h.aiSettingsKeyAvailable() {
		writeError(w, http.StatusServiceUnavailable, "secret_key_missing")
		return
	}
	var req aiSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Provider = strings.TrimSpace(req.Provider)
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	req.Model = strings.TrimSpace(req.Model)
	if _, known := aiSettingsProviders[req.Provider]; !known {
		writeError(w, http.StatusBadRequest, "unknown provider")
		return
	}
	if u, err := url.Parse(req.BaseURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		writeError(w, http.StatusBadRequest, "base_url must be an http(s) URL")
		return
	}
	var skillID pgtype.UUID
	if req.PromptSkillID != nil && strings.TrimSpace(*req.PromptSkillID) != "" {
		id, ok := parseUUIDOrBadRequest(w, strings.TrimSpace(*req.PromptSkillID), "prompt_skill_id")
		if !ok {
			return
		}
		if _, err := h.Queries.GetSkillInWorkspace(r.Context(), db.GetSkillInWorkspaceParams{ID: id, WorkspaceID: workspaceID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, http.StatusBadRequest, "prompt_skill_id does not belong to this workspace")
				return
			}
			slog.Error("ai settings: skill lookup failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to save AI settings")
			return
		}
		skillID = id
	}
	saved, err := h.AISettings.Save(r.Context(), workspaceID, userID, aisettings.Input{
		Provider:        req.Provider,
		BaseURL:         req.BaseURL,
		Model:           req.Model,
		Prompt:          req.Prompt,
		DisableThinking: req.DisableThinking,
		PromptSkillID:   skillID,
		APIKey:          req.APIKey,
		ClearAPIKey:     req.ClearAPIKey,
	})
	switch {
	case errors.Is(err, aisettings.ErrKeyRequired):
		writeError(w, http.StatusConflict, "api_key_required")
		return
	case errors.Is(err, aisettings.ErrConcurrentUpdate):
		writeError(w, http.StatusConflict, "ai_settings_changed")
		return
	case errors.Is(err, aisettings.ErrSecretKeyMissing):
		writeError(w, http.StatusServiceUnavailable, "secret_key_missing")
		return
	case err != nil:
		slog.Error("ai settings: save failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save AI settings")
		return
	}
	writeJSON(w, http.StatusOK, h.aiSettingsResponse(saved, true))
}

// GetAISettingsStatus tells any member whether chat polishing can be offered.
func (h *Handler) GetAISettingsStatus(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "workspace id")
	if !ok {
		return
	}
	available := false
	if h.aiSettingsKeyAvailable() {
		_, found, err := h.AISettings.Get(r.Context(), workspaceID)
		if err != nil {
			slog.Error("ai settings: status load failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to load AI settings")
			return
		}
		available = found
	}
	writeJSON(w, http.StatusOK, map[string]bool{"polish_available": available})
}

const (
	aiSettingsTestTimeout    = 20 * time.Second
	aiSettingsTestMaxMessage = 200
)

// redactAndCap hides the key inside an upstream message and truncates it to
// max runes; providers often echo the offending key back.
func redactAndCap(msg, key string, max int) string {
	if key != "" {
		msg = strings.ReplaceAll(msg, key, "***")
	}
	if r := []rune(msg); len(r) > max {
		msg = string(r[:max])
	}
	return msg
}

// CheckAISettings sends one tiny request with the unsaved values so the admin
// can verify the endpoint before saving. It never stores anything.
// resolveAIProbe reads unsaved form values and the key they may use. It writes
// the error response itself when ok is false.
func (h *Handler) resolveAIProbe(w http.ResponseWriter, r *http.Request) (in aisettings.Input, key string, ok bool) {
	workspaceID, valid := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "workspace id")
	if !valid {
		return in, "", false
	}
	if !h.aiSettingsKeyAvailable() {
		writeError(w, http.StatusServiceUnavailable, "secret_key_missing")
		return in, "", false
	}
	var req aiSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return in, "", false
	}
	req.Provider = strings.TrimSpace(req.Provider)
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	req.Model = strings.TrimSpace(req.Model)
	if _, known := aiSettingsProviders[req.Provider]; !known {
		writeError(w, http.StatusBadRequest, "unknown provider")
		return in, "", false
	}
	if u, err := url.Parse(req.BaseURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		writeError(w, http.StatusBadRequest, "base_url must be an http(s) URL")
		return in, "", false
	}
	in = aisettings.Input{
		Provider:        req.Provider,
		BaseURL:         req.BaseURL,
		Model:           req.Model,
		DisableThinking: req.DisableThinking,
		APIKey:          req.APIKey,
		ClearAPIKey:     req.ClearAPIKey,
	}
	var err error
	key, err = h.AISettings.ResolveKey(r.Context(), workspaceID, in)
	switch {
	case errors.Is(err, aisettings.ErrKeyRequired):
		writeError(w, http.StatusConflict, "api_key_required")
		return in, "", false
	case errors.Is(err, aisettings.ErrSecretKeyMissing):
		writeError(w, http.StatusServiceUnavailable, "secret_key_missing")
		return in, "", false
	case err != nil:
		slog.Error("ai settings: resolve key failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to resolve AI settings")
		return in, "", false
	}
	return in, key, true
}

// ListAISettingsModels asks the endpoint in the form which models it serves. It
// sends no prompt, so it costs no tokens.
func (h *Handler) ListAISettingsModels(w http.ResponseWriter, r *http.Request) {
	in, key, ok := h.resolveAIProbe(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), aiSettingsTestTimeout)
	defer cancel()
	models, err := aisettings.ListModels(ctx, in.Provider, in.BaseURL, key)
	if err != nil {
		var listErr *aisettings.ModelListError
		status, msg := 0, "could not reach the endpoint"
		switch {
		case errors.As(err, &listErr):
			status, msg = listErr.Status, listErr.Message
		case errors.Is(err, context.DeadlineExceeded):
			msg = "the endpoint did not answer in time"
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      false,
			"status":  status,
			"message": redactAndCap(msg, key, aiSettingsTestMaxMessage),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "models": models})
}

func (h *Handler) CheckAISettings(w http.ResponseWriter, r *http.Request) {
	in, key, ok := h.resolveAIProbe(w, r)
	if !ok {
		return
	}

	noRetries, err := llm.Retries(0)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to test AI settings")
		return
	}
	client := aisettings.ClientFromInput(in, key, noRetries)
	ctx, cancel := context.WithTimeout(r.Context(), aiSettingsTestTimeout)
	defer cancel()
	if _, err := client.GenerateText(ctx, in.Model, "", "Reply with the single word: ok"); err != nil {
		status, msg, isUpstream := llm.UpstreamError(err)
		if !isUpstream {
			// Transport failure: status 0 means the endpoint was not reachable.
			// The error text can contain the base URL, so it is not returned.
			status, msg = 0, "could not reach the endpoint"
			if errors.Is(err, context.DeadlineExceeded) {
				msg = "the endpoint did not answer in time"
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      false,
			"status":  status,
			"message": redactAndCap(msg, key, aiSettingsTestMaxMessage),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
