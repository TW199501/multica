package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReleaseSourceDefaultsToGitHub(t *testing.T) {
	t.Setenv(releaseAPIBaseURLEnv, "")
	t.Setenv(releaseDownloadBaseURLEnv, "")

	if got := releaseAPIBaseURL(); got != defaultReleaseAPIBaseURL {
		t.Fatalf("release API base URL = %q, want %q", got, defaultReleaseAPIBaseURL)
	}
	if got := releaseAssetDownloadURL("archive.tar.gz", "v1.2.3", "https://github.example/archive.tar.gz"); got != "https://github.example/archive.tar.gz" {
		t.Fatalf("fallback download URL = %q", got)
	}
}

func TestReleaseSourceOverridesGitHub(t *testing.T) {
	t.Setenv(releaseAPIBaseURLEnv, "https://mirror.example/api/")
	t.Setenv(releaseDownloadBaseURLEnv, "https://mirror.example/releases/")

	if got := releaseAPIBaseURL(); got != "https://mirror.example/api" {
		t.Fatalf("release API base URL = %q", got)
	}
	if got := releaseAssetDownloadURL("multica-cli-1.2.3-linux-amd64.tar.gz", "v1.2.3", "https://github.example/archive.tar.gz"); got != "https://mirror.example/releases/v1.2.3/multica-cli-1.2.3-linux-amd64.tar.gz" {
		t.Fatalf("mirror download URL = %q", got)
	}
}

func TestFetchLatestReleaseUsesConfiguredAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/multica-ai/multica/releases/latest" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(GitHubRelease{TagName: "v9.8.7"})
	}))
	defer server.Close()
	t.Setenv(releaseAPIBaseURLEnv, server.URL)

	got, err := FetchLatestRelease()
	if err != nil {
		t.Fatalf("FetchLatestRelease() error = %v", err)
	}
	if got.TagName != "v9.8.7" {
		t.Fatalf("release tag = %q, want v9.8.7", got.TagName)
	}
}

func TestReleaseRepository(t *testing.T) {
	t.Setenv(ReleaseRepositoryEnv, "")
	if got := ReleaseRepository(); got != DefaultReleaseRepository {
		t.Fatalf("default ReleaseRepository() = %q, want %q", got, DefaultReleaseRepository)
	}
	t.Setenv(ReleaseRepositoryEnv, "  TW199501/multica  ")
	if got := ReleaseRepository(); got != "TW199501/multica" {
		t.Fatalf("override ReleaseRepository() = %q", got)
	}
	for _, bad := range []string{"multica", "a/b/c", "../x", "a/", "/b", "a b/c", "a/.."} {
		t.Setenv(ReleaseRepositoryEnv, bad)
		if got := ReleaseRepository(); got != DefaultReleaseRepository {
			t.Fatalf("ReleaseRepository() with %q = %q, want default", bad, got)
		}
	}
}

func TestFetchLatestReleaseUsesConfiguredRepository(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/TW199501/multica/releases/latest" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(GitHubRelease{TagName: "v0.7.0-tw.2"})
	}))
	defer server.Close()
	t.Setenv(releaseAPIBaseURLEnv, server.URL)
	t.Setenv(ReleaseRepositoryEnv, "TW199501/multica")

	got, err := FetchLatestRelease()
	if err != nil {
		t.Fatalf("FetchLatestRelease() error = %v", err)
	}
	if got.TagName != "v0.7.0-tw.2" {
		t.Fatalf("release tag = %q, want v0.7.0-tw.2", got.TagName)
	}
}
