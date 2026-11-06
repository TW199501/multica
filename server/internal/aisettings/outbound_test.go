package aisettings

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeChatEndpoint answers one chat completion and records the request body.
func fakeChatEndpoint(t *testing.T) (*httptest.Server, *[]map[string]any) {
	t.Helper()
	var bodies []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		bodies = append(bodies, body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"x","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`)
	}))
	t.Cleanup(server.Close)
	return server, &bodies
}

func withAllowedPrefixes(t *testing.T, cidrs ...string) {
	t.Helper()
	previous := allowedPrefixes.Load()
	if errs := SetAllowedPrefixes(cidrs); len(errs) > 0 {
		t.Fatalf("SetAllowedPrefixes: %v", errs)
	}
	t.Cleanup(func() { allowedPrefixes.Store(previous) })
}

func TestClientRefusesPrivateAddressesByDefault(t *testing.T) {
	withAllowedPrefixes(t)
	server, bodies := fakeChatEndpoint(t)

	client := ClientFromInput(Input{BaseURL: server.URL, Model: "m"}, "", nil)
	_, err := client.GenerateText(context.Background(), "", "system", "user")

	if err == nil {
		t.Fatal("GenerateText reached a loopback address")
	}
	if !strings.Contains(err.Error(), allowCIDRsEnv) {
		t.Fatalf("error should name %s, got: %v", allowCIDRsEnv, err)
	}
	if len(*bodies) != 0 {
		t.Fatalf("request reached the server: %v", *bodies)
	}
}

func TestClientReachesAnOperatorAllowedRange(t *testing.T) {
	withAllowedPrefixes(t, "127.0.0.0/8")
	server, bodies := fakeChatEndpoint(t)

	client := ClientFromInput(Input{BaseURL: server.URL, Model: "m"}, "", nil)
	if _, err := client.GenerateText(context.Background(), "", "system", "user"); err != nil {
		t.Fatalf("GenerateText: %v", err)
	}
	if len(*bodies) != 1 {
		t.Fatalf("requests = %d, want 1", len(*bodies))
	}
}

func TestClientRefusesARedirectToAPrivateAddress(t *testing.T) {
	withAllowedPrefixes(t, "192.0.2.0/24")
	redirector := &guardedDialCheck{}
	if err := redirector.check("127.0.0.1:80"); err == nil {
		t.Fatal("a loopback dial target must be refused, wherever a redirect points")
	}
	if err := redirector.check("169.254.169.254:80"); err == nil {
		t.Fatal("the metadata address must be refused")
	}
	if err := redirector.check("192.0.2.10:80"); err != nil {
		t.Fatalf("an allowed range must pass: %v", err)
	}
	if err := redirector.check("93.184.216.34:443"); err != nil {
		t.Fatalf("a public address must pass: %v", err)
	}
}

func TestSetAllowedPrefixesReportsBadEntriesAndKeepsGoodOnes(t *testing.T) {
	previous := allowedPrefixes.Load()
	t.Cleanup(func() { allowedPrefixes.Store(previous) })

	errs := SetAllowedPrefixes([]string{" 10.0.0.0/8 ", "nonsense", ""})

	if len(errs) != 1 {
		t.Fatalf("errs = %v, want one", errs)
	}
	if err := (&guardedDialCheck{}).check("10.1.2.3:80"); err != nil {
		t.Fatalf("10.0.0.0/8 should be allowed: %v", err)
	}
}

func TestEmptyModelIsNotReplacedByAHostedModelName(t *testing.T) {
	withAllowedPrefixes(t, "127.0.0.0/8")
	server, bodies := fakeChatEndpoint(t)

	client := ClientFromInput(Input{BaseURL: server.URL}, "", nil)
	if _, err := client.GenerateText(context.Background(), "", "system", "user"); err != nil {
		t.Fatalf("GenerateText: %v", err)
	}

	if got, _ := (*bodies)[0]["model"].(string); got != "" {
		t.Fatalf("model = %q, want the server's loaded model (empty)", got)
	}
}
