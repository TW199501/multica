package aisettings

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/multica-ai/multica/server/internal/util/secretbox"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://multica:multica@localhost:5432/multica?sslmode=disable"
	}
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		fmt.Printf("Skipping tests: could not connect to database: %v\n", err)
		os.Exit(0)
	}
	if err := pool.Ping(ctx); err != nil {
		fmt.Printf("Skipping tests: database not reachable: %v\n", err)
		pool.Close()
		os.Exit(0)
	}
	testPool = pool
	code := m.Run()
	pool.Close()
	os.Exit(code)
}

func newBox(t *testing.T) *secretbox.Box {
	t.Helper()
	key := make([]byte, secretbox.KeySize)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	box, err := secretbox.New(key)
	if err != nil {
		t.Fatal(err)
	}
	return box
}

// newWorkspace returns a fresh workspace id; the table has no FKs, so a random
// id is enough. Its settings row is removed when the test ends.
func newWorkspace(t *testing.T) pgtype.UUID {
	t.Helper()
	id := uuid.New()
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM workspace_ai_settings WHERE workspace_id = $1`, id)
	})
	return pgtype.UUID{Bytes: id, Valid: true}
}

func newUser() pgtype.UUID { return pgtype.UUID{Bytes: uuid.New(), Valid: true} }

func strPtr(s string) *string { return &s }

func TestSaveSealsKeyAndReportsLast4(t *testing.T) {
	ctx := context.Background()
	svc := NewService(db.New(testPool), newBox(t))
	ws := newWorkspace(t)

	_, err := svc.Save(ctx, ws, newUser(), Input{
		Provider: "openai", BaseURL: "https://api.openai.com/v1", Model: "gpt-x",
		APIKey: strPtr("sk-abcdef1234"),
	})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, ok, err := svc.Get(ctx, ws)
	if err != nil || !ok {
		t.Fatalf("Get: ok=%v err=%v", ok, err)
	}
	if !got.APIKeySet || got.APIKeyLast4 != "1234" {
		t.Fatalf("APIKeySet=%v last4=%q", got.APIKeySet, got.APIKeyLast4)
	}
	var sealed []byte
	if err := testPool.QueryRow(ctx, `SELECT api_key_sealed FROM workspace_ai_settings WHERE workspace_id = $1`, ws).Scan(&sealed); err != nil {
		t.Fatal(err)
	}
	if len(sealed) == 0 || bytes.Contains(sealed, []byte("sk-abcdef1234")) {
		t.Fatalf("key is not sealed: %d bytes", len(sealed))
	}
}

func TestSaveKeepsKeyWhenOmitted(t *testing.T) {
	ctx := context.Background()
	svc := NewService(db.New(testPool), newBox(t))
	ws := newWorkspace(t)
	base := Input{Provider: "openai", BaseURL: "https://api.openai.com/v1", Model: "a"}

	first := base
	first.APIKey = strPtr("sk-abcdef1234")
	if _, err := svc.Save(ctx, ws, newUser(), first); err != nil {
		t.Fatal(err)
	}
	second := base
	second.Model = "b"
	saved, err := svc.Save(ctx, ws, newUser(), second)
	if err != nil {
		t.Fatalf("Save without key: %v", err)
	}
	if !saved.APIKeySet || saved.APIKeyLast4 != "1234" || saved.Model != "b" {
		t.Fatalf("unexpected settings: %+v", saved)
	}
	key, err := svc.ResolveKey(ctx, ws, second)
	if err != nil || key != "sk-abcdef1234" {
		t.Fatalf("ResolveKey = %q, %v", key, err)
	}
}

func TestSaveRequiresKeyOnProviderOrHostChange(t *testing.T) {
	ctx := context.Background()
	svc := NewService(db.New(testPool), newBox(t))
	ws := newWorkspace(t)
	if _, err := svc.Save(ctx, ws, newUser(), Input{
		Provider: "openai", BaseURL: "https://api.openai.com/v1", APIKey: strPtr("sk-abcdef1234"),
	}); err != nil {
		t.Fatal(err)
	}

	cases := map[string]Input{
		"provider": {Provider: "custom", BaseURL: "https://api.openai.com/v1"},
		"host":     {Provider: "openai", BaseURL: "https://evil.example/v1"},
	}
	for name, in := range cases {
		if _, err := svc.Save(ctx, ws, newUser(), in); !errors.Is(err, ErrKeyRequired) {
			t.Errorf("%s change: Save err = %v, want ErrKeyRequired", name, err)
		}
		if _, err := svc.ResolveKey(ctx, ws, in); !errors.Is(err, ErrKeyRequired) {
			t.Errorf("%s change: ResolveKey err = %v, want ErrKeyRequired", name, err)
		}
	}

	if _, err := svc.Save(ctx, ws, newUser(), Input{Provider: "openai", BaseURL: "https://API.openai.com/v2"}); err != nil {
		t.Fatalf("path-only change must be allowed: %v", err)
	}
}

func TestSaveWithoutBoxFails(t *testing.T) {
	svc := NewService(db.New(testPool), nil)
	if svc.SecretKeyAvailable() {
		t.Fatal("SecretKeyAvailable should be false")
	}
	_, err := svc.Save(context.Background(), newWorkspace(t), newUser(), Input{
		Provider: "openai", BaseURL: "https://api.openai.com/v1", APIKey: strPtr("sk-abcdef1234"),
	})
	if !errors.Is(err, ErrSecretKeyMissing) {
		t.Fatalf("err = %v, want ErrSecretKeyMissing", err)
	}
}

func TestClientForUnconfigured(t *testing.T) {
	svc := NewService(db.New(testPool), newBox(t))
	_, _, err := svc.ClientFor(context.Background(), newWorkspace(t))
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
}

func TestSelfHostedKeylessIsConfigured(t *testing.T) {
	ctx := context.Background()
	svc := NewService(db.New(testPool), newBox(t))
	ws := newWorkspace(t)
	if _, err := svc.Save(ctx, ws, newUser(), Input{Provider: "llamacpp", BaseURL: "http://localhost:8080/v1"}); err != nil {
		t.Fatal(err)
	}
	client, settings, err := svc.ClientFor(ctx, ws)
	if err != nil {
		t.Fatalf("ClientFor: %v", err)
	}
	if !client.Enabled() || settings.APIKeySet {
		t.Fatalf("enabled=%v keySet=%v", client.Enabled(), settings.APIKeySet)
	}
	if err := svc.TouchCalled(ctx, ws); err != nil {
		t.Fatal(err)
	}
	got, _, _ := svc.Get(ctx, ws)
	if !got.LastCalledAt.Valid {
		t.Fatal("LastCalledAt not set")
	}
}

func TestDefaultPromptKeepsPlaceholders(t *testing.T) {
	if p := DefaultPrompt(); p == "" || !bytes.Contains([]byte(p), []byte("⟦n⟧")) {
		t.Fatalf("DefaultPrompt missing placeholder rule: %q", p)
	}
}

func TestSaveClearsKeyForKeylessProvider(t *testing.T) {
	ctx := context.Background()
	svc := NewService(db.New(testPool), newBox(t))
	ws := newWorkspace(t)
	if _, err := svc.Save(ctx, ws, newUser(), Input{
		Provider: "openai", BaseURL: "https://api.openai.com/v1", APIKey: strPtr("sk-abcdef1234"),
	}); err != nil {
		t.Fatal(err)
	}
	self := Input{Provider: "llamacpp", BaseURL: "http://localhost:8080/v1"}
	if _, err := svc.Save(ctx, ws, newUser(), self); !errors.Is(err, ErrKeyRequired) {
		t.Fatalf("without ClearAPIKey err = %v, want ErrKeyRequired", err)
	}
	self.ClearAPIKey = true
	if key, err := svc.ResolveKey(ctx, ws, self); err != nil || key != "" {
		t.Fatalf("ResolveKey = %q, %v", key, err)
	}
	if _, err := svc.Save(ctx, ws, newUser(), self); err != nil {
		t.Fatalf("Save with ClearAPIKey: %v", err)
	}
	got, _, err := svc.Get(ctx, ws)
	if err != nil || got.APIKeySet || got.APIKeyLast4 != "" {
		t.Fatalf("after clear: %+v, %v", got, err)
	}
	client, _, err := svc.ClientFor(ctx, ws)
	if err != nil || !client.Enabled() {
		t.Fatalf("ClientFor: %v", err)
	}
}

func TestNewKeyWinsOverClear(t *testing.T) {
	ctx := context.Background()
	svc := NewService(db.New(testPool), newBox(t))
	ws := newWorkspace(t)
	in := Input{Provider: "openai", BaseURL: "https://api.openai.com/v1", APIKey: strPtr("sk-abcdef1234"), ClearAPIKey: true}
	got, err := svc.Save(ctx, ws, newUser(), in)
	if err != nil || !got.APIKeySet || got.APIKeyLast4 != "1234" {
		t.Fatalf("Save: %+v, %v", got, err)
	}
	if key, err := svc.ResolveKey(ctx, ws, in); err != nil || key != "sk-abcdef1234" {
		t.Fatalf("ResolveKey = %q, %v", key, err)
	}
}

func TestShortKeyIsNotExposedAsLast4(t *testing.T) {
	for _, k := range []string{"abcd", "abcdefg"} {
		if got := last4(k); got != "" {
			t.Errorf("last4(%q) = %q, want empty", k, got)
		}
	}
	if got := last4("abcdefgh"); got != "efgh" {
		t.Errorf("last4 = %q", got)
	}
}

// operatorEnvHost records the headers of the one request a workspace client makes.
func operatorEnvHost(t *testing.T) (*httptest.Server, *http.Header) {
	t.Helper()
	t.Setenv("OPENAI_API_KEY", "sk-operator-secret")
	t.Setenv("OPENAI_ORG_ID", "org-x")
	t.Setenv("OPENAI_PROJECT_ID", "proj-x")
	var got http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"c","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`)
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func callWorkspaceClient(t *testing.T, svc *Service, ws pgtype.UUID) {
	t.Helper()
	client, _, err := svc.ClientFor(context.Background(), ws)
	if err != nil {
		t.Fatalf("ClientFor: %v", err)
	}
	if _, err := client.GenerateText(context.Background(), "", "", "hi"); err != nil {
		t.Fatalf("GenerateText: %v", err)
	}
}

func assertNoOrgOrProject(t *testing.T, h http.Header) {
	t.Helper()
	for _, name := range []string{"OpenAI-Organization", "OpenAI-Project"} {
		if _, ok := h[name]; ok {
			t.Fatalf("%s leaked to the workspace host: %q", name, h.Get(name))
		}
	}
}

func TestKeylessWorkspaceClientSendsNoOperatorCredentials(t *testing.T) {
	srv, got := operatorEnvHost(t)
	svc := NewService(db.New(testPool), newBox(t))
	ws := newWorkspace(t)
	if _, err := svc.Save(context.Background(), ws, newUser(), Input{Provider: "llamacpp", BaseURL: srv.URL}); err != nil {
		t.Fatal(err)
	}
	callWorkspaceClient(t, svc, ws)
	if auth := got.Get("Authorization"); auth != "" {
		t.Fatalf("keyless workspace client sent Authorization %q", auth)
	}
	assertNoOrgOrProject(t, *got)
}

func TestKeyedWorkspaceClientSendsOnlyItsOwnKey(t *testing.T) {
	srv, got := operatorEnvHost(t)
	svc := NewService(db.New(testPool), newBox(t))
	ws := newWorkspace(t)
	if _, err := svc.Save(context.Background(), ws, newUser(), Input{Provider: "custom", BaseURL: srv.URL, APIKey: strPtr("sk-workspace-key")}); err != nil {
		t.Fatal(err)
	}
	callWorkspaceClient(t, svc, ws)
	if auth := got.Get("Authorization"); auth != "Bearer sk-workspace-key" {
		t.Fatalf("Authorization = %q, want only the workspace key", auth)
	}
	assertNoOrgOrProject(t, *got)
}
