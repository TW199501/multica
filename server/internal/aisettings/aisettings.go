// Package aisettings stores a workspace's chat AI endpoint and builds the
// llm.Client for it. The API key is sealed at rest and never returned.
package aisettings

import (
	"context"
	"errors"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/util/secretbox"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/llm"
)

var (
	ErrSecretKeyMissing = errors.New("aisettings: MULTICA_AI_SECRET_KEY is not set")
	ErrNotConfigured    = errors.New("aisettings: workspace AI is not configured")
	ErrKeyRequired      = errors.New("aisettings: api key must be re-entered for a new provider or host")
)

// Settings is the stored configuration without any key material.
type Settings struct {
	Provider        string
	BaseURL         string
	Model           string
	DisableThinking bool
	Prompt          string
	PromptSkillID   pgtype.UUID
	APIKeySet       bool
	APIKeyLast4     string
	LastCalledAt    pgtype.Timestamptz
}

// Input is what an admin submits. APIKey nil = keep the stored key.
type Input struct {
	Provider, BaseURL, Model, Prompt string
	DisableThinking                  bool
	PromptSkillID                    pgtype.UUID
	APIKey                           *string
	// ClearAPIKey drops the stored key (keyless endpoints); a non-empty APIKey wins.
	ClearAPIKey bool
}

type Service struct {
	q   *db.Queries
	box *secretbox.Box
}

// NewService returns a Service. box may be nil when no master key is configured;
// reading settings still works, saving or using a stored key does not.
func NewService(q *db.Queries, box *secretbox.Box) *Service {
	return &Service{q: q, box: box}
}

func (s *Service) SecretKeyAvailable() bool { return s.box != nil }

func toSettings(r db.WorkspaceAiSetting) Settings {
	return Settings{
		Provider:        r.Provider,
		BaseURL:         r.BaseUrl,
		Model:           r.Model,
		DisableThinking: r.DisableThinking,
		Prompt:          r.Prompt,
		PromptSkillID:   r.PromptSkillID,
		APIKeySet:       len(r.ApiKeySealed) > 0,
		APIKeyLast4:     r.ApiKeyLast4,
		LastCalledAt:    r.LastCalledAt,
	}
}

// Get returns the workspace's settings; the bool reports whether a row exists.
func (s *Service) Get(ctx context.Context, workspaceID pgtype.UUID) (Settings, bool, error) {
	row, err := s.q.GetWorkspaceAISettings(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{}, false, nil
	}
	if err != nil {
		return Settings{}, false, err
	}
	return toSettings(row), true, nil
}

// hostKey normalizes a base URL to host:port for comparison, ignoring case and path.
func hostKey(raw string) string {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return strings.ToLower(raw)
	}
	return strings.ToLower(u.Hostname()) + ":" + u.Port()
}

func sameTarget(row db.WorkspaceAiSetting, in Input) bool {
	return strings.EqualFold(strings.TrimSpace(row.Provider), strings.TrimSpace(in.Provider)) &&
		hostKey(row.BaseUrl) == hostKey(in.BaseURL)
}

func newKey(in Input) (string, bool) {
	if in.APIKey == nil {
		return "", false
	}
	k := strings.TrimSpace(*in.APIKey)
	return k, k != ""
}

func last4(key string) string {
	r := []rune(key)
	if len(r) < 8 {
		return ""
	}
	return string(r[len(r)-4:])
}

func (s *Service) existing(ctx context.Context, workspaceID pgtype.UUID) (db.WorkspaceAiSetting, bool, error) {
	row, err := s.q.GetWorkspaceAISettings(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.WorkspaceAiSetting{}, false, nil
	}
	return row, err == nil, err
}

// Save upserts the settings. A stored key is kept when in.APIKey is nil, but only
// while provider and host are unchanged, so a saved key is never sent elsewhere.
func (s *Service) Save(ctx context.Context, workspaceID, userID pgtype.UUID, in Input) (Settings, error) {
	if s.box == nil {
		return Settings{}, ErrSecretKeyMissing
	}
	row, found, err := s.existing(ctx, workspaceID)
	if err != nil {
		return Settings{}, err
	}
	params := db.UpsertWorkspaceAISettingsParams{
		WorkspaceID:     workspaceID,
		Provider:        in.Provider,
		BaseUrl:         in.BaseURL,
		Model:           in.Model,
		DisableThinking: in.DisableThinking,
		Prompt:          in.Prompt,
		PromptSkillID:   in.PromptSkillID,
		UpdatedBy:       userID,
	}
	if key, ok := newKey(in); ok {
		sealed, err := s.box.Seal([]byte(key))
		if err != nil {
			return Settings{}, err
		}
		params.ApiKeySealed = sealed
		params.ApiKeyLast4 = last4(key)
	} else if in.ClearAPIKey {
		params.ClearKey = true
	} else if found && len(row.ApiKeySealed) > 0 && !sameTarget(row, in) {
		return Settings{}, ErrKeyRequired
	}
	saved, err := s.q.UpsertWorkspaceAISettings(ctx, params)
	if err != nil {
		return Settings{}, err
	}
	return toSettings(saved), nil
}

// ResolveKey returns the key to use for in: the new one, or the stored one when
// provider and host are unchanged. ErrKeyRequired otherwise (when a key was stored).
func (s *Service) ResolveKey(ctx context.Context, workspaceID pgtype.UUID, in Input) (string, error) {
	if key, ok := newKey(in); ok {
		return key, nil
	}
	row, found, err := s.existing(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	if in.ClearAPIKey {
		return "", nil
	}
	if !found || len(row.ApiKeySealed) == 0 {
		return "", nil
	}
	if !sameTarget(row, in) {
		return "", ErrKeyRequired
	}
	return s.open(row)
}

func (s *Service) open(row db.WorkspaceAiSetting) (string, error) {
	if len(row.ApiKeySealed) == 0 {
		return "", nil
	}
	if s.box == nil {
		return "", ErrSecretKeyMissing
	}
	plain, err := s.box.Open(row.ApiKeySealed)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// ClientFor builds the LLM client for the workspace's stored settings.
func (s *Service) ClientFor(ctx context.Context, workspaceID pgtype.UUID) (*llm.Client, Settings, error) {
	row, found, err := s.existing(ctx, workspaceID)
	if err != nil {
		return nil, Settings{}, err
	}
	if !found {
		return nil, Settings{}, ErrNotConfigured
	}
	key, err := s.open(row)
	if err != nil {
		return nil, Settings{}, err
	}
	client := ClientFromInput(Input{
		BaseURL:         row.BaseUrl,
		Model:           row.Model,
		DisableThinking: row.DisableThinking,
	}, key, nil)
	if !client.Enabled() {
		return nil, Settings{}, ErrNotConfigured
	}
	return client, toSettings(row), nil
}

func (s *Service) TouchCalled(ctx context.Context, workspaceID pgtype.UUID) error {
	return s.q.TouchWorkspaceAISettingsCalledAt(ctx, workspaceID)
}

// ClientFromInput is the single place a workspace client is built, from stored
// or unsaved input. retries nil keeps the llm default.
func ClientFromInput(in Input, apiKey string, retries *llm.RetryOverride) *llm.Client {
	return llm.New(llm.Config{
		MaxRetries:      retries,
		APIKey:          apiKey,
		BaseURL:         in.BaseURL,
		DefaultModel:    in.Model,
		DisableThinking: in.DisableThinking,
		// The host is admin-chosen, so the server's OPENAI_* credentials must not follow.
		IgnoreEnvironment: true,
	})
}

// DefaultPrompt is the system prompt used when the workspace sets none.
func DefaultPrompt() string {
	return "You polish a short message written by a user. " +
		"Fix typos and make the meaning clearer. " +
		"Do not change the original meaning and do not add any content. " +
		"Reply in the same language and writing system as the original text: " +
		"Traditional Chinese stays Traditional Chinese, never converted to Simplified. " +
		"Output only the polished text, with no preface, quotes or explanation. " +
		"Keep every placeholder of the form ⟦n⟧ exactly as written."
}
