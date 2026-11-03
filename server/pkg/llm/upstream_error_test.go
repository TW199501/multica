package llm

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUpstreamErrorExtractsStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"message":"bad key from upstream","type":"invalid_request_error"}}`)
	}))
	defer srv.Close()

	retries, err := Retries(0)
	if err != nil {
		t.Fatal(err)
	}
	c := New(Config{APIKey: "k", BaseURL: srv.URL, DefaultModel: "m", MaxRetries: retries})
	_, err = c.GenerateText(context.Background(), "m", "", "hi")
	if err == nil {
		t.Fatal("expected an error")
	}
	status, msg, ok := UpstreamError(err)
	if !ok || status != http.StatusUnauthorized || msg != "bad key from upstream" {
		t.Fatalf("got (%d, %q, %v)", status, msg, ok)
	}

	if _, _, ok := UpstreamError(context.Canceled); ok {
		t.Error("context.Canceled must not be an upstream error")
	}
	if _, _, ok := UpstreamError(nil); ok {
		t.Error("nil must not be an upstream error")
	}
}
