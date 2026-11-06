package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// workspace_ai_settings carries no FK to workspace, so the teardown must remove
// the row (and its sealed key) itself.
func TestDeleteWorkspace_RemovesAISettings(t *testing.T) {
	if testPool == nil {
		t.Skip("DATABASE_URL not set; skipping live-Postgres workspace delete test")
	}
	ctx := context.Background()
	lockRollupSingleton(t)
	setWorkspaceDeleteLockTimeoutForTest(t, 500*time.Millisecond)

	const slug = "handler-tests-delete-ai-settings"
	_, _ = testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)

	var wsID string
	if err := testPool.QueryRow(ctx, `
INSERT INTO workspace (name, slug, description)
VALUES ($1, $2, $3)
RETURNING id
`, "Handler Test Delete AI Settings", slug, "DeleteWorkspace AI settings test").Scan(&wsID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM workspace WHERE id = $1`, wsID)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM workspace_ai_settings WHERE workspace_id = $1`, wsID)
	})
	if _, err := testPool.Exec(ctx, `
INSERT INTO member (workspace_id, user_id, role)
VALUES ($1, $2, 'owner')
`, wsID, testUserID); err != nil {
		t.Fatalf("create owner member: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
INSERT INTO workspace_ai_settings (workspace_id, provider, base_url, api_key_sealed, api_key_last4)
VALUES ($1, 'custom', 'https://llm.example/v1', '\x0102'::bytea, 'abcd')
`, wsID); err != nil {
		t.Fatalf("seed AI settings: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest(http.MethodDelete, "/api/workspaces/"+wsID, nil)
	req = withURLParam(req, "id", wsID)
	testHandler.DeleteWorkspace(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	var remaining int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM workspace_ai_settings WHERE workspace_id = $1`, wsID).Scan(&remaining); err != nil {
		t.Fatalf("count AI settings: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("workspace delete left %d AI settings row(s) behind", remaining)
	}
}
