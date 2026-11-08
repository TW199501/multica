package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

type projectCodeRoundTrip func(*http.Request) (*http.Response, error)

func (f projectCodeRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func fakeProjectCodeGitHub(t *testing.T, fn projectCodeRoundTrip) {
	t.Helper()
	old := projectCodeHTTPClient
	projectCodeHTTPClient = &http.Client{Transport: fn}
	t.Cleanup(func() { projectCodeHTTPClient = old })
}

func githubJSON(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": {"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func githubFileBody(content string) string {
	return `{"type":"file","sha":"blob-1","encoding":"base64","content":"` +
		base64.StdEncoding.EncodeToString([]byte(content)) + `\n"}`
}

func TestParseGitHubRepoURL(t *testing.T) {
	cases := []struct {
		raw         string
		owner, name string
		ok          bool
	}{
		{"https://github.com/elf-express/ELF.Studio.git", "elf-express", "ELF.Studio", true},
		{"https://github.com/TW199501/multica", "TW199501", "multica", true},
		{"git@github.com:elf-express/skillshare-source.git", "elf-express", "skillshare-source", true},
		{"ssh://git@github.com/acme/widget.git", "acme", "widget", true},
		{"https://gitlab.com/acme/widget", "", "", false},
		{"https://github.com.evil.test/acme/widget", "", "", false},
		{"https://github.com/acme", "", "", false},
		{"https://github.com/acme/widget/tree/main", "", "", false},
		{"not a url", "", "", false},
	}
	for _, c := range cases {
		owner, name, ok := parseGitHubRepoURL(c.raw)
		if ok != c.ok || owner != c.owner || name != c.name {
			t.Errorf("parseGitHubRepoURL(%q) = %q, %q, %v", c.raw, owner, name, ok)
		}
	}
}

func TestValidateProjectCodePath(t *testing.T) {
	for path, want := range map[string]bool{
		"README.md":          true,
		"src/app/main.go":    true,
		"":                   false,
		"/etc/passwd":        false,
		"src/../secret":      false,
		"./README.md":        false,
		"src//main.go":       false,
		"src/":               false,
		`src\main.go`:        false,
		"src/main.go\x00.md": false,
	} {
		if got := validateProjectCodePath(path); got != want {
			t.Errorf("validateProjectCodePath(%q) = %v, want %v", path, got, want)
		}
	}
}

func TestDecodeProjectCodeFile(t *testing.T) {
	text, err := decodeProjectCodeFile("a.txt", "dev", strings.NewReader(githubFileBody("héllo\n")))
	if err != nil || text.Content != "héllo\n" || text.SHA != "blob-1" || text.Binary || text.TooLarge {
		t.Fatalf("text file = %+v, err %v", text, err)
	}

	binary, err := decodeProjectCodeFile("a.png", "dev", strings.NewReader(githubFileBody("\x89PNG\x00")))
	if err != nil || !binary.Binary || binary.Content != "" {
		t.Fatalf("binary file = %+v, err %v", binary, err)
	}

	large, err := decodeProjectCodeFile("a.bin", "dev", strings.NewReader(`{"type":"file","sha":"s","encoding":"none","content":""}`))
	if err != nil || !large.TooLarge || large.Content != "" {
		t.Fatalf("large file = %+v, err %v", large, err)
	}

	link, err := decodeProjectCodeFile("link", "dev", strings.NewReader(`{"type":"symlink","sha":"s"}`))
	if err != nil || !link.Binary {
		t.Fatalf("symlink = %+v, err %v", link, err)
	}
}

func TestCommitProjectCodeFile(t *testing.T) {
	repo := projectCodeRepo{owner: "acme", name: "widget", ref: "feature/x"}
	input := SaveProjectCodeFileRequest{Path: "src/a b.go", SHA: "blob-1", Content: "package a\n"}

	t.Run("commits to the branch from the edited blob", func(t *testing.T) {
		fakeProjectCodeGitHub(t, func(r *http.Request) (*http.Response, error) {
			if r.Method != http.MethodPut || !strings.HasSuffix(r.URL.EscapedPath(), "/repos/acme/widget/contents/src/a%20b.go") {
				t.Errorf("request = %s %s", r.Method, r.URL.EscapedPath())
			}
			if got := r.Header.Get("Authorization"); got != "Bearer secret" {
				t.Errorf("Authorization = %q", got)
			}
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["branch"] != "feature/x" || body["sha"] != "blob-1" ||
				body["content"] != base64.StdEncoding.EncodeToString([]byte(input.Content)) {
				t.Errorf("payload = %+v", body)
			}
			return githubJSON(http.StatusOK, `{"content":{"sha":"blob-2"}}`), nil
		})
		sha, err := commitProjectCodeFile(context.Background(), repo, "secret", input)
		if err != nil || sha != "blob-2" {
			t.Fatalf("sha = %q, err %v", sha, err)
		}
	})

	for status, want := range map[int]error{
		http.StatusConflict:            errProjectCodeConflict,
		http.StatusUnprocessableEntity: errProjectCodeConflict,
		http.StatusForbidden:           errProjectCodeDenied,
		http.StatusNotFound:            errProjectCodeDenied,
	} {
		fakeProjectCodeGitHub(t, func(*http.Request) (*http.Response, error) {
			return githubJSON(status, `{}`), nil
		})
		if _, err := commitProjectCodeFile(context.Background(), repo, "secret", input); !errors.Is(err, want) {
			t.Errorf("status %d: err = %v, want %v", status, err, want)
		}
	}
}

func projectCodeRequest(method, path, projectID, resourceID string, body any) *http.Request {
	return withURLParams(newRequest(method, path, body), "id", projectID, "resourceId", resourceID)
}

func TestProjectCodeHandlers(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Fatal("database-backed handler test fixture is required")
	}
	projectID := dbfx.Project(t, "code browser project")
	otherProjectID := dbfx.Project(t, "other code browser project")
	resourceID := dbfx.Insert(t, "project_resource", testutil.Cols{
		"project_id":    projectID,
		"workspace_id":  testWorkspaceID,
		"resource_type": "github_repo",
		"resource_ref":  `{"url":"https://github.com/acme/widget.git","ref":"dev"}`,
		"position":      1,
	})
	localID := dbfx.Insert(t, "project_resource", testutil.Cols{
		"project_id":    projectID,
		"workspace_id":  testWorkspaceID,
		"resource_type": "local_directory",
		"resource_ref":  `{"local_path":"/repo","daemon_id":"daemon-1"}`,
		"position":      2,
	})
	base := "/api/projects/" + projectID + "/resources/" + resourceID + "/code"

	fakeProjectCodeGitHub(t, func(r *http.Request) (*http.Response, error) {
		switch {
		case strings.Contains(r.URL.Path, "/git/trees/dev"):
			return githubJSON(http.StatusOK, `{"truncated":false,"tree":[
				{"path":"src","type":"tree"},{"path":"src/main.go","type":"blob","size":9}]}`), nil
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/contents/src/main.go") && r.URL.Query().Get("ref") == "dev":
			return githubJSON(http.StatusOK, githubFileBody("package a")), nil
		case r.Method == http.MethodPut:
			return githubJSON(http.StatusOK, `{"content":{"sha":"blob-2"}}`), nil
		}
		return githubJSON(http.StatusNotFound, `{}`), nil
	})

	t.Run("lists only files on the resource's branch", func(t *testing.T) {
		var out ProjectCodeTreeResponse
		testutil.Call(t, testHandler.GetProjectCodeTree,
			projectCodeRequest("GET", base+"/tree", projectID, resourceID, nil)).Want(http.StatusOK).JSON(&out)
		if out.Ref != "dev" || len(out.Files) != 1 || out.Files[0] != "src/main.go" {
			t.Fatalf("tree = %+v", out)
		}
	})

	t.Run("reads a file", func(t *testing.T) {
		var out ProjectCodeFileResponse
		testutil.Call(t, testHandler.GetProjectCodeFile,
			projectCodeRequest("GET", base+"/file?path=src/main.go", projectID, resourceID, nil)).Want(http.StatusOK).JSON(&out)
		if out.Content != "package a" || out.SHA != "blob-1" {
			t.Fatalf("file = %+v", out)
		}
	})

	t.Run("a missing file is a 404", func(t *testing.T) {
		testutil.Call(t, testHandler.GetProjectCodeFile,
			projectCodeRequest("GET", base+"/file?path=nope.go", projectID, resourceID, nil)).Want(http.StatusNotFound)
	})

	t.Run("refuses a path outside the repository", func(t *testing.T) {
		testutil.Call(t, testHandler.GetProjectCodeFile,
			projectCodeRequest("GET", base+"/file?path=../secret", projectID, resourceID, nil)).Want(http.StatusBadRequest)
	})

	t.Run("refuses a resource from another project", func(t *testing.T) {
		testutil.Call(t, testHandler.GetProjectCodeTree,
			projectCodeRequest("GET", base+"/tree", otherProjectID, resourceID, nil)).Want(http.StatusNotFound)
	})

	t.Run("refuses a local directory", func(t *testing.T) {
		testutil.Call(t, testHandler.GetProjectCodeTree,
			projectCodeRequest("GET", base+"/tree", projectID, localID, nil)).Want(http.StatusBadRequest)
	})

	save := map[string]any{"path": "src/main.go", "sha": "blob-1", "content": "package b"}

	t.Run("refuses to save without a server token", func(t *testing.T) {
		t.Setenv("GITHUB_TOKEN", "")
		testutil.Call(t, testHandler.SaveProjectCodeFile,
			projectCodeRequest("PUT", base+"/file", projectID, resourceID, save)).Want(http.StatusForbidden)
	})

	t.Run("saves to the branch and returns the new blob", func(t *testing.T) {
		t.Setenv("GITHUB_TOKEN", "secret")
		var out ProjectCodeFileResponse
		testutil.Call(t, testHandler.SaveProjectCodeFile,
			projectCodeRequest("PUT", base+"/file", projectID, resourceID, save)).Want(http.StatusOK).JSON(&out)
		if out.SHA != "blob-2" || out.Content != "package b" {
			t.Fatalf("saved = %+v", out)
		}
	})
}
