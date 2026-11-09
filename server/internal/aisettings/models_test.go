package aisettings

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func modelEndpoint(t *testing.T, status int, body string) (*httptest.Server, *http.Request) {
	t.Helper()
	withAllowedPrefixes(t, "127.0.0.0/8", "::1/128")
	seen := &http.Request{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = *r
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(server.Close)
	return server, seen
}

func TestListModelsReadsOpenAIShape(t *testing.T) {
	server, seen := modelEndpoint(t, 200, `{"data":[{"id":"b"},{"id":"a"},{"id":"a"},{"id":""}]}`)
	got, err := ListModels(context.Background(), "openai", server.URL+"/v1/", "sk-1")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"a", "b"}; !reflect.DeepEqual(got, want) {
		t.Errorf("models = %v, want %v", got, want)
	}
	if seen.URL.Path != "/v1/models" || seen.Method != http.MethodGet {
		t.Errorf("request %s %s", seen.Method, seen.URL.Path)
	}
	if seen.Header.Get("Authorization") != "Bearer sk-1" {
		t.Errorf("authorization %q", seen.Header.Get("Authorization"))
	}
	if seen.Header.Get("x-api-key") != "" {
		t.Error("x-api-key must only go to Anthropic")
	}
}

func TestListModelsAcceptsOtherShapes(t *testing.T) {
	server, _ := modelEndpoint(t, 200, `{"models":[{"name":"models/gemini-x"},{"model":"local"}]}`)
	got, err := ListModels(context.Background(), "gemini", server.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"gemini-x", "local"}; !reflect.DeepEqual(got, want) {
		t.Errorf("models = %v, want %v", got, want)
	}
}

func TestListModelsSendsAnthropicHeaders(t *testing.T) {
	server, seen := modelEndpoint(t, 200, `{"data":[]}`)
	if _, err := ListModels(context.Background(), "claude", server.URL, "sk-a"); err != nil {
		t.Fatal(err)
	}
	if seen.Header.Get("x-api-key") != "sk-a" || seen.Header.Get("anthropic-version") == "" {
		t.Errorf("headers %v", seen.Header)
	}
}

func TestListModelsOmitsAuthWithoutKey(t *testing.T) {
	server, seen := modelEndpoint(t, 200, `{"data":[]}`)
	if _, err := ListModels(context.Background(), "llamacpp", server.URL, ""); err != nil {
		t.Fatal(err)
	}
	if seen.Header.Get("Authorization") != "" {
		t.Errorf("authorization %q", seen.Header.Get("Authorization"))
	}
}

func TestListModelsReportsUpstreamError(t *testing.T) {
	server, _ := modelEndpoint(t, 401, `{"error":{"message":"bad key"}}`)
	_, err := ListModels(context.Background(), "openai", server.URL, "sk-1")
	var listErr *ModelListError
	if !errors.As(err, &listErr) || listErr.Status != 401 || listErr.Message != "bad key" {
		t.Fatalf("err = %v", err)
	}
}

func TestListModelsRejectsNonJSON(t *testing.T) {
	server, _ := modelEndpoint(t, 200, `<html>`)
	if _, err := ListModels(context.Background(), "openai", server.URL, "sk-1"); err == nil {
		t.Fatal("want an error")
	}
}

func TestListModelsRefusesPrivateAddressByDefault(t *testing.T) {
	withAllowedPrefixes(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("the guarded client must not reach a private address")
	}))
	t.Cleanup(server.Close)
	if _, err := ListModels(context.Background(), "custom", server.URL, ""); err == nil {
		t.Fatal("want an error")
	}
}
