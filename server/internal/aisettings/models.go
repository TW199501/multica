package aisettings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
)

const (
	maxModelListBytes   = 8 << 20
	maxModelListEntries = 2000
)

// ModelListError is a non-2xx answer from the provider's model list.
type ModelListError struct {
	Status  int
	Message string
}

func (e *ModelListError) Error() string {
	return fmt.Sprintf("aisettings: model list returned %d: %s", e.Status, e.Message)
}

// ListModels asks the endpoint which models it serves. It sends no prompt, so
// it costs no tokens. The caller resolves the key against the same target.
func ListModels(ctx context.Context, provider, baseURL, apiKey string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+"/models", nil)
	if err != nil {
		return nil, err
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
		// Anthropic's model list reads its native headers, not the bearer token.
		if provider == "claude" {
			req.Header.Set("x-api-key", apiKey)
			req.Header.Set("anthropic-version", "2023-06-01")
		}
	}
	resp, err := guardedHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxModelListBytes))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, &ModelListError{Status: resp.StatusCode, Message: modelListErrorMessage(body)}
	}
	return parseModelList(body)
}

type modelEntry struct {
	ID    string `json:"id"`
	Model string `json:"model"`
	Name  string `json:"name"`
}

// parseModelList accepts the OpenAI shape and the `models` key some servers use.
func parseModelList(body []byte) ([]string, error) {
	var envelope struct {
		Data   []modelEntry `json:"data"`
		Models []modelEntry `json:"models"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, errors.New("aisettings: model list is not valid JSON")
	}
	seen := make(map[string]struct{})
	models := make([]string, 0, len(envelope.Data)+len(envelope.Models))
	for _, entry := range append(envelope.Data, envelope.Models...) {
		id := entry.ID
		if id == "" {
			id = entry.Model
		}
		if id == "" {
			id = entry.Name
		}
		// Gemini prefixes its ids with the resource path.
		id = strings.TrimPrefix(strings.TrimSpace(id), "models/")
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		models = append(models, id)
	}
	sort.Strings(models)
	if len(models) > maxModelListEntries {
		models = models[:maxModelListEntries]
	}
	return models, nil
}

func modelListErrorMessage(body []byte) string {
	var envelope struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil {
		if envelope.Error.Message != "" {
			return envelope.Error.Message
		}
		if envelope.Message != "" {
			return envelope.Message
		}
	}
	return ""
}
