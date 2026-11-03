package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/testutil"
)

// polishStub answers every completion with reply and keeps the last user
// message it received.
func polishStub(t *testing.T, reply string) (*httptest.Server, *int32, func() string) {
	t.Helper()
	var (
		hits int32
		mu   sync.Mutex
		last string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		raw, _ := io.ReadAll(r.Body)
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.Unmarshal(raw, &body)
		mu.Lock()
		for _, m := range body.Messages {
			if m.Role == "user" {
				last = m.Content
			}
		}
		mu.Unlock()
		out, _ := json.Marshal(map[string]any{
			"id": "c", "object": "chat.completion",
			"choices": []any{map[string]any{
				"index": 0, "finish_reason": "stop",
				"message": map[string]any{"role": "assistant", "content": reply},
			}},
		})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(out)
	}))
	t.Cleanup(srv.Close)
	return srv, &hits, func() string {
		mu.Lock()
		defer mu.Unlock()
		return last
	}
}

func seedPolishSettings(t *testing.T, router http.Handler, baseURL string) {
	t.Helper()
	rec := aiCall(t, router, http.MethodPut, "", testUserID, map[string]any{
		"provider": "custom", "base_url": baseURL, "model": "m", "api_key": "sk-test-1234",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("seed settings: %d %s", rec.Code, rec.Body.String())
	}
}

func polishCall(t *testing.T, router http.Handler, userID string, body any) *httptest.ResponseRecorder {
	t.Helper()
	req := newRequest(http.MethodPost, "/api/workspaces/"+testWorkspaceID+"/ai/polish", body)
	req.Header.Set("X-User-ID", userID)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestPolishRestoresProtectedSpans(t *testing.T) {
	router := aiSettingsRouter(t, true)
	srv, hits, lastUser := polishStub(t, "請⟦1⟧幫忙看一下。")
	seedPolishSettings(t, router, srv.URL)

	rec := polishCall(t, router, testUserID, map[string]any{
		"text":    "請 [@Ann](mention://agent/1) 幫忙看",
		"context": map[string]any{"kind": "none"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d %s", rec.Code, rec.Body.String())
	}
	if got := decodeAI(t, rec)["text"]; got != "請[@Ann](mention://agent/1)幫忙看一下。" {
		t.Errorf("text = %v", got)
	}
	if strings.Contains(lastUser(), "mention://") {
		t.Errorf("upstream received the raw mention: %q", lastUser())
	}
	if got := atomic.LoadInt32(hits); got != 1 {
		t.Errorf("upstream hits = %d", got)
	}
	var last *time.Time
	dbfx.QueryRow(t, `SELECT last_called_at FROM workspace_ai_settings WHERE workspace_id = $1`, testWorkspaceID).Scan(&last)
	if last == nil {
		t.Error("last_called_at was not touched")
	}
}

func TestPolishFailsWhenModelDropsPlaceholder(t *testing.T) {
	router := aiSettingsRouter(t, true)
	srv, _, _ := polishStub(t, "請幫忙看一下。")
	seedPolishSettings(t, router, srv.URL)

	rec := polishCall(t, router, testUserID, map[string]any{
		"text":    "請 [@Ann](mention://agent/1) 幫忙看",
		"context": map[string]any{"kind": "none"},
	})
	if rec.Code != http.StatusUnprocessableEntity || decodeAI(t, rec)["error"] != "polish_lost_spans" {
		t.Fatalf("want 422 polish_lost_spans, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPolishUnavailableMakesNoUpstreamRequest(t *testing.T) {
	body := map[string]any{"text": "hello", "context": map[string]any{"kind": "none"}}

	t.Run("not configured", func(t *testing.T) {
		router := aiSettingsRouter(t, true)
		_, hits, _ := polishStub(t, "Hello.")
		rec := polishCall(t, router, testUserID, body)
		if rec.Code != http.StatusConflict || decodeAI(t, rec)["error"] != "ai_not_configured" {
			t.Fatalf("want 409 ai_not_configured, got %d %s", rec.Code, rec.Body.String())
		}
		if got := atomic.LoadInt32(hits); got != 0 {
			t.Errorf("upstream hits = %d", got)
		}
	})

	t.Run("no master key", func(t *testing.T) {
		router := aiSettingsRouter(t, false)
		srv, hits, _ := polishStub(t, "Hello.")
		// A keyless row written directly: without a master key the API cannot save.
		dbfx.Exec(t, `INSERT INTO workspace_ai_settings (workspace_id, provider, base_url, model, updated_by)
			VALUES ($1, 'llamacpp', $2, 'm', $3)`, testWorkspaceID, srv.URL, testUserID)
		rec := polishCall(t, router, testUserID, body)
		if rec.Code != http.StatusConflict || decodeAI(t, rec)["error"] != "ai_not_configured" {
			t.Fatalf("want 409 ai_not_configured, got %d %s", rec.Code, rec.Body.String())
		}
		if got := atomic.LoadInt32(hits); got != 0 {
			t.Errorf("upstream hits = %d", got)
		}
	})
}

func TestPolishRejectsBadInput(t *testing.T) {
	router := aiSettingsRouter(t, true)
	srv, hits, _ := polishStub(t, "x")
	seedPolishSettings(t, router, srv.URL)
	cases := map[string]map[string]any{
		"empty":        {"text": "  ", "context": map[string]any{"kind": "none"}},
		"too long":     {"text": strings.Repeat("字", 8001), "context": map[string]any{"kind": "none"}},
		"unknown kind": {"text": "hi", "context": map[string]any{"kind": "email"}},
	}
	for name, body := range cases {
		if rec := polishCall(t, router, testUserID, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: want 400, got %d %s", name, rec.Code, rec.Body.String())
		}
	}
	if got := atomic.LoadInt32(hits); got != 0 {
		t.Errorf("upstream hits = %d", got)
	}
}

func TestPolishRejectsForeignChatSession(t *testing.T) {
	router := aiSettingsRouter(t, true)
	srv, hits, _ := polishStub(t, "Hello.")
	seedPolishSettings(t, router, srv.URL)

	otherID := dbfx.User(t, "Polish Other", "polish-other@example.com")
	dbfx.Member(t, testWorkspaceID, otherID, "member")
	agentID := dbfx.Agent(t, "Polish chat agent", "")
	chatID := dbfx.ChatSession(t, agentID, testutil.Cols{"creator_id": otherID})
	dbfx.Insert(t, "chat_message", testutil.Cols{"chat_session_id": chatID, "role": "user", "content": "private words"})

	rec := polishCall(t, router, testUserID, map[string]any{
		"text":    "hello",
		"context": map[string]any{"kind": "chat", "chat_session_id": chatID},
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d %s", rec.Code, rec.Body.String())
	}
	if got := atomic.LoadInt32(hits); got != 0 {
		t.Errorf("upstream hits = %d", got)
	}
}

func TestPolishChatContextUsesOwnSession(t *testing.T) {
	router := aiSettingsRouter(t, true)
	srv, _, lastUser := polishStub(t, "Hello.")
	seedPolishSettings(t, router, srv.URL)

	agentID := dbfx.Agent(t, "Polish own chat agent", "")
	chatID := dbfx.ChatSession(t, agentID)
	dbfx.Insert(t, "chat_message", testutil.Cols{"chat_session_id": chatID, "role": "user", "content": "chat-earlier-question"})
	dbfx.Insert(t, "chat_message", testutil.Cols{"chat_session_id": chatID, "role": "assistant", "content": "chat-agent-answer"})

	rec := polishCall(t, router, testUserID, map[string]any{
		"text":    "hello",
		"context": map[string]any{"kind": "chat", "chat_session_id": chatID},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d %s", rec.Code, rec.Body.String())
	}
	got := lastUser()
	for _, want := range []string{"chat-earlier-question", "chat-agent-answer", "hello"} {
		if !strings.Contains(got, want) {
			t.Errorf("user message missing %q: %q", want, got)
		}
	}
}

func TestPolishIssueContextUsesThread(t *testing.T) {
	router := aiSettingsRouter(t, true)
	srv, _, lastUser := polishStub(t, "Sounds good.")
	seedPolishSettings(t, router, srv.URL)

	issueID := dbfx.Issue(t, "polish-issue-title", testutil.Cols{"description": "polish-issue-description"})
	alpha := dbfx.Comment(t, issueID, "thread-alpha-root")
	dbfx.Comment(t, issueID, "thread-alpha-reply", testutil.Cols{"parent_id": alpha})
	dbfx.Comment(t, issueID, "thread-beta-root")

	rec := polishCall(t, router, testUserID, map[string]any{
		"text":    "sounds good",
		"context": map[string]any{"kind": "issue", "issue_id": issueID, "thread_comment_id": alpha},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d %s", rec.Code, rec.Body.String())
	}
	got := lastUser()
	for _, want := range []string{"polish-issue-title", "polish-issue-description", "thread-alpha-root", "thread-alpha-reply"} {
		if !strings.Contains(got, want) {
			t.Errorf("user message missing %q: %q", want, got)
		}
	}
	if strings.Contains(got, "thread-beta-root") {
		t.Errorf("user message contains another thread: %q", got)
	}
}

func TestPolishRejectsForeignIssue(t *testing.T) {
	router := aiSettingsRouter(t, true)
	srv, hits, _ := polishStub(t, "Hello.")
	seedPolishSettings(t, router, srv.URL)
	otherWS := dbfx.Workspace(t, "Polish Other WS", "polish-other-ws")
	issueID := dbfx.Issue(t, "foreign", testutil.Cols{"workspace_id": otherWS})

	rec := polishCall(t, router, testUserID, map[string]any{
		"text":    "hello",
		"context": map[string]any{"kind": "issue", "issue_id": issueID},
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d %s", rec.Code, rec.Body.String())
	}
	if got := atomic.LoadInt32(hits); got != 0 {
		t.Errorf("upstream hits = %d", got)
	}
}

func TestPolishUpstreamErrorReturnsStatusOnly(t *testing.T) {
	router := aiSettingsRouter(t, true)
	srv, _ := aiUpstreamStub(t, http.StatusUnauthorized, "Incorrect API key provided: sk-test-1234")
	seedPolishSettings(t, router, srv.URL)

	rec := polishCall(t, router, testUserID, map[string]any{"text": "hello", "context": map[string]any{"kind": "none"}})
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d %s", rec.Code, rec.Body.String())
	}
	m := decodeAI(t, rec)
	if m["error"] != "upstream_failed" || m["status"] != float64(401) {
		t.Errorf("body: %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "sk-test-1234") || strings.Contains(rec.Body.String(), "Incorrect") {
		t.Errorf("upstream message leaked: %s", rec.Body.String())
	}
}

func TestPolishRejectsChatWhenCreatorLostAgentAccess(t *testing.T) {
	router := aiSettingsRouter(t, true)
	srv, hits, _ := polishStub(t, "Hello.")
	seedPolishSettings(t, router, srv.URL)

	memberID := dbfx.User(t, "Polish Lost Access", "polish-lost-access@example.com")
	dbfx.Member(t, testWorkspaceID, memberID, "member")
	// Private agent owned by someone else: the member may no longer read it.
	agentID := dbfx.Agent(t, "Polish private agent", "")
	chatID := dbfx.ChatSession(t, agentID, testutil.Cols{"creator_id": memberID})
	dbfx.Insert(t, "chat_message", testutil.Cols{"chat_session_id": chatID, "role": "user", "content": "earlier words"})

	rec := polishCall(t, router, memberID, map[string]any{
		"text":    "hello",
		"context": map[string]any{"kind": "chat", "chat_session_id": chatID},
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d %s", rec.Code, rec.Body.String())
	}
	if got := atomic.LoadInt32(hits); got != 0 {
		t.Errorf("upstream hits = %d", got)
	}
}

func TestPolishChatContextSkipsHiddenMessages(t *testing.T) {
	router := aiSettingsRouter(t, true)
	srv, _, lastUser := polishStub(t, "Hello.")
	seedPolishSettings(t, router, srv.URL)

	agentID := dbfx.Agent(t, "Polish hidden chat agent", "")
	chatID := dbfx.ChatSession(t, agentID)
	dbfx.Insert(t, "chat_message", testutil.Cols{"chat_session_id": chatID, "role": "user", "content": "hidden-kickoff", "message_kind": "onboarding_kickoff"})
	dbfx.Insert(t, "chat_message", testutil.Cols{"chat_session_id": chatID, "role": "user", "content": "hidden-command", "message_kind": "channel_command"})
	dbfx.Insert(t, "chat_message", testutil.Cols{"chat_session_id": chatID, "role": "assistant", "content": "visible-answer"})

	rec := polishCall(t, router, testUserID, map[string]any{
		"text":    "hello",
		"context": map[string]any{"kind": "chat", "chat_session_id": chatID},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d %s", rec.Code, rec.Body.String())
	}
	got := lastUser()
	if !strings.Contains(got, "visible-answer") {
		t.Errorf("visible message missing: %q", got)
	}
	for _, hidden := range []string{"hidden-kickoff", "hidden-command"} {
		if strings.Contains(got, hidden) {
			t.Errorf("hidden message %q sent: %q", hidden, got)
		}
	}
}

func TestPolishCapsIssueTitle(t *testing.T) {
	router := aiSettingsRouter(t, true)
	srv, _, lastUser := polishStub(t, "Hello.")
	seedPolishSettings(t, router, srv.URL)
	title := strings.Repeat("t", 200) + "TITLE-TAIL"
	issueID := dbfx.Issue(t, title)

	rec := polishCall(t, router, testUserID, map[string]any{
		"text":    "hello",
		"context": map[string]any{"kind": "issue", "issue_id": issueID},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d %s", rec.Code, rec.Body.String())
	}
	got := lastUser()
	if strings.Contains(got, "TITLE-TAIL") || !strings.Contains(got, strings.Repeat("t", 200)) {
		t.Errorf("title not capped at 200 runes: %q", got)
	}
}
