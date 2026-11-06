package llm

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIgnoreEnvironmentKeepsJSONWhenCustomHeadersNameContentType(t *testing.T) {
	t.Setenv("OPENAI_CUSTOM_HEADERS", "Content-Type: text/plain\nX-Operator-Secret: hidden")
	var contentType, operatorHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentType = r.Header.Get("Content-Type")
		operatorHeader = r.Header.Get("X-Operator-Secret")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"x","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`)
	}))
	defer server.Close()

	client := New(Config{BaseURL: server.URL, DefaultModel: "m", IgnoreEnvironment: true})
	if _, err := client.GenerateText(context.Background(), "", "system", "user"); err != nil {
		t.Fatalf("GenerateText: %v", err)
	}

	if contentType != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", contentType)
	}
	if operatorHeader != "" {
		t.Fatalf("operator header reached the workspace host: %q", operatorHeader)
	}
}
