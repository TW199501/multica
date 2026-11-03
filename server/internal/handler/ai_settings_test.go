package handler

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/multica-ai/multica/server/internal/aisettings"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/util/secretbox"
)

// aiSettingsRouter mounts the real role middleware so the admin/member split
// is exercised the way router.go wires it.
func aiSettingsRouter(t *testing.T, withKey bool) http.Handler {
	t.Helper()
	var box *secretbox.Box
	if withKey {
		key := make([]byte, secretbox.KeySize)
		if _, err := rand.Read(key); err != nil {
			t.Fatal(err)
		}
		b, err := secretbox.New(key)
		if err != nil {
			t.Fatal(err)
		}
		box = b
	}
	prev := testHandler.AISettings
	testHandler.AISettings = aisettings.NewService(testHandler.Queries, box)
	t.Cleanup(func() {
		testHandler.AISettings = prev
		_, _ = testPool.Exec(context.Background(), `DELETE FROM workspace_ai_settings WHERE workspace_id = $1`, testWorkspaceID)
	})
	_, _ = testPool.Exec(context.Background(), `DELETE FROM workspace_ai_settings WHERE workspace_id = $1`, testWorkspaceID)

	router := chi.NewRouter()
	router.Route("/api/workspaces/{id}", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireWorkspaceMemberFromURL(testHandler.Queries, "id"))
			r.Get("/ai-settings/status", testHandler.GetAISettingsStatus)
		})
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireWorkspaceRoleFromURL(testHandler.Queries, "id", "owner", "admin"))
			r.Get("/ai-settings", testHandler.GetAISettings)
			r.Put("/ai-settings", testHandler.PutAISettings)
		})
	})
	return router
}

func aiCall(t *testing.T, router http.Handler, method, suffix, userID string, body any) *httptest.ResponseRecorder {
	t.Helper()
	req := newRequest(method, "/api/workspaces/"+testWorkspaceID+"/ai-settings"+suffix, body)
	req.Header.Set("X-User-ID", userID)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func decodeAI(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return m
}

func TestAISettingsGetPutRoundTrip(t *testing.T) {
	router := aiSettingsRouter(t, true)
	put := aiCall(t, router, http.MethodPut, "", testUserID, map[string]any{
		"provider": "openai", "base_url": "https://api.openai.com/v1", "model": "gpt-x",
		"disable_thinking": true, "prompt": "be brief", "api_key": "sk-test-9876",
	})
	if put.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", put.Code, put.Body.String())
	}
	if strings.Contains(put.Body.String(), "sk-test-9876") {
		t.Fatal("PUT response leaks the key")
	}
	m := decodeAI(t, put)
	if m["api_key_last4"] != "9876" || m["api_key_set"] != true || m["configured"] != true {
		t.Fatalf("unexpected PUT body: %v", m)
	}
	get := aiCall(t, router, http.MethodGet, "", testUserID, nil)
	if get.Code != http.StatusOK {
		t.Fatalf("GET: %d", get.Code)
	}
	if strings.Contains(get.Body.String(), "sk-test-9876") {
		t.Fatal("GET response leaks the key")
	}
	g := decodeAI(t, get)
	for _, k := range []string{"provider", "base_url", "model", "disable_thinking", "prompt", "api_key_last4", "api_key_set"} {
		if g[k] != m[k] {
			t.Errorf("GET %s = %v, PUT %s = %v", k, g[k], k, m[k])
		}
	}
	if g["secret_key_available"] != true {
		t.Errorf("secret_key_available = %v", g["secret_key_available"])
	}
	if g["default_prompt"] != aisettings.DefaultPrompt() {
		t.Errorf("default_prompt missing")
	}
}

func TestAISettingsRequiresAdmin(t *testing.T) {
	router := aiSettingsRouter(t, true)
	memberID := dbfx.User(t, "AI Settings Member", "ai-settings-member@example.com")
	dbfx.Member(t, testWorkspaceID, memberID, "member")

	if rec := aiCall(t, router, http.MethodGet, "", memberID, nil); rec.Code != http.StatusForbidden {
		t.Errorf("member GET: %d", rec.Code)
	}
	if rec := aiCall(t, router, http.MethodPut, "", memberID, map[string]any{
		"provider": "llamacpp", "base_url": "http://localhost:8080/v1", "model": "m",
	}); rec.Code != http.StatusForbidden {
		t.Errorf("member PUT: %d", rec.Code)
	}
	rec := aiCall(t, router, http.MethodGet, "/status", memberID, nil)
	if rec.Code != http.StatusOK {
		t.Errorf("member status: %d", rec.Code)
	}
}

func TestAISettingsSaveRequiresKeyWhenHostChanges(t *testing.T) {
	router := aiSettingsRouter(t, true)
	body := map[string]any{"provider": "openai", "base_url": "https://api.openai.com/v1", "model": "m", "api_key": "sk-test-9876"}
	if rec := aiCall(t, router, http.MethodPut, "", testUserID, body); rec.Code != http.StatusOK {
		t.Fatalf("seed: %d %s", rec.Code, rec.Body.String())
	}
	delete(body, "api_key")
	body["base_url"] = "https://evil.example/v1"
	rec := aiCall(t, router, http.MethodPut, "", testUserID, body)
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d %s", rec.Code, rec.Body.String())
	}
	if decodeAI(t, rec)["error"] != "api_key_required" {
		t.Errorf("body: %s", rec.Body.String())
	}
	var stored string
	dbfx.QueryRow(t, `SELECT base_url FROM workspace_ai_settings WHERE workspace_id = $1`, testWorkspaceID).Scan(&stored)
	if stored != "https://api.openai.com/v1" {
		t.Errorf("base_url changed to %q", stored)
	}
}

func TestAISettingsWithoutSecretKey(t *testing.T) {
	router := aiSettingsRouter(t, false)
	get := aiCall(t, router, http.MethodGet, "", testUserID, nil)
	if get.Code != http.StatusOK || decodeAI(t, get)["secret_key_available"] != false {
		t.Fatalf("GET: %d %s", get.Code, get.Body.String())
	}
	put := aiCall(t, router, http.MethodPut, "", testUserID, map[string]any{
		"provider": "openai", "base_url": "https://api.openai.com/v1", "model": "m", "api_key": "sk-test-9876",
	})
	if put.Code != http.StatusServiceUnavailable || decodeAI(t, put)["error"] != "secret_key_missing" {
		t.Fatalf("PUT: %d %s", put.Code, put.Body.String())
	}
	st := aiCall(t, router, http.MethodGet, "/status", testUserID, nil)
	if st.Code != http.StatusOK || decodeAI(t, st)["polish_available"] != false {
		t.Fatalf("status: %d %s", st.Code, st.Body.String())
	}
}

func TestAISettingsStatusWithKeyAndConfig(t *testing.T) {
	router := aiSettingsRouter(t, true)
	if decodeAI(t, aiCall(t, router, http.MethodGet, "/status", testUserID, nil))["polish_available"] != false {
		t.Fatal("unconfigured workspace must not be available")
	}
	aiCall(t, router, http.MethodPut, "", testUserID, map[string]any{
		"provider": "openai", "base_url": "https://api.openai.com/v1", "model": "m", "api_key": "sk-test-9876",
	})
	if decodeAI(t, aiCall(t, router, http.MethodGet, "/status", testUserID, nil))["polish_available"] != true {
		t.Fatal("configured workspace must be available")
	}
}

func TestAISettingsRejectsForeignSkill(t *testing.T) {
	router := aiSettingsRouter(t, true)
	otherWS := dbfx.Workspace(t, "AI Settings Other", "ai-settings-other")
	var skillID string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO skill (workspace_id, name, description, content, config, created_by)
		VALUES ($1, 'Foreign Skill', '', '# x', '{}'::jsonb, $2) RETURNING id
	`, otherWS, testUserID).Scan(&skillID); err != nil {
		t.Fatalf("skill fixture: %v", err)
	}
	t.Cleanup(func() { _, _ = testPool.Exec(context.Background(), `DELETE FROM skill WHERE id = $1`, skillID) })
	rec := aiCall(t, router, http.MethodPut, "", testUserID, map[string]any{
		"provider": "llamacpp", "base_url": "http://localhost:8080/v1", "model": "m", "prompt_skill_id": skillID,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestAISettingsRejectsBadInput(t *testing.T) {
	router := aiSettingsRouter(t, true)
	cases := map[string]map[string]any{
		"non-http url":   {"provider": "custom", "base_url": "ftp://x.example/v1", "model": "m"},
		"bad skill uuid": {"provider": "custom", "base_url": "https://x.example/v1", "model": "m", "prompt_skill_id": "nope"},
	}
	for name, body := range cases {
		if rec := aiCall(t, router, http.MethodPut, "", testUserID, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: want 400, got %d %s", name, rec.Code, rec.Body.String())
		}
	}
}

func TestAISettingsRejectsUnknownProvider(t *testing.T) {
	router := aiSettingsRouter(t, true)
	rec := aiCall(t, router, http.MethodPut, "", testUserID, map[string]any{
		"provider": "foo", "base_url": "https://api.openai.com/v1", "model": "m",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestAISettingsClearKeyForSelfHosted(t *testing.T) {
	router := aiSettingsRouter(t, true)
	if rec := aiCall(t, router, http.MethodPut, "", testUserID, map[string]any{
		"provider": "openai", "base_url": "https://api.openai.com/v1", "model": "m", "api_key": "sk-test-9876",
	}); rec.Code != http.StatusOK {
		t.Fatalf("seed: %d", rec.Code)
	}
	rec := aiCall(t, router, http.MethodPut, "", testUserID, map[string]any{
		"provider": "llamacpp", "base_url": "http://localhost:8080/v1", "model": "m", "clear_api_key": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d %s", rec.Code, rec.Body.String())
	}
	if m := decodeAI(t, rec); m["api_key_set"] != false {
		t.Errorf("api_key_set = %v", m["api_key_set"])
	}
}
