package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	// GitHub's contents API inlines file bodies up to 1 MB.
	maxProjectCodeFileBytes = 1 << 20
	// Base64 plus the JSON envelope around a 1 MB file.
	maxProjectCodeResponseBytes = 4 << 20
)

var projectCodeHTTPClient = &http.Client{Timeout: 20 * time.Second}

var (
	errProjectCodeNotFound = errors.New("file not found on the branch")
	errProjectCodeConflict = errors.New("file changed on the branch or the branch is protected")
	errProjectCodeDenied   = errors.New("the server's GitHub token cannot write to this repository")
)

// ProjectCodeTreeResponse lists the files on a project repository's branch.
type ProjectCodeTreeResponse struct {
	Ref       string   `json:"ref"`
	Truncated bool     `json:"truncated"`
	Files     []string `json:"files"`
}

// ProjectCodeFileResponse is one file on a project repository's branch. Content
// is empty when Binary or TooLarge is set.
type ProjectCodeFileResponse struct {
	Path     string `json:"path"`
	Ref      string `json:"ref"`
	SHA      string `json:"sha"`
	Content  string `json:"content"`
	Binary   bool   `json:"binary"`
	TooLarge bool   `json:"too_large"`
}

// SaveProjectCodeFileRequest commits one file to the resource's branch. SHA is
// the blob the edit started from, so a newer commit is refused, not overwritten.
type SaveProjectCodeFileRequest struct {
	Path    string `json:"path"`
	SHA     string `json:"sha"`
	Content string `json:"content"`
}

type projectCodeRepo struct {
	owner string
	name  string
	ref   string
}

func (r projectCodeRepo) contentsURL(path string) string {
	segments := strings.Split(path, "/")
	for i, segment := range segments {
		segments[i] = url.PathEscape(segment)
	}
	return fmt.Sprintf("%s/repos/%s/%s/contents/%s",
		strings.TrimRight(githubAPIBase, "/"),
		url.PathEscape(r.owner), url.PathEscape(r.name), strings.Join(segments, "/"))
}

// parseGitHubRepoURL accepts the URL forms a github_repo resource can hold and
// rejects every other host, so the server's token only ever reaches GitHub.
func parseGitHubRepoURL(raw string) (owner, name string, ok bool) {
	raw = strings.TrimSpace(raw)
	var host, path string
	if u, err := url.Parse(raw); err == nil && u.Host != "" {
		host, path = u.Hostname(), u.Path
	} else {
		colon := strings.Index(raw, ":")
		if colon <= 0 {
			return "", "", false
		}
		host, path = raw[strings.Index(raw, "@")+1:colon], raw[colon+1:]
	}
	if !strings.EqualFold(host, "github.com") {
		return "", "", false
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 2 {
		return "", "", false
	}
	owner, name = parts[0], strings.TrimSuffix(parts[1], ".git")
	return owner, name, owner != "" && name != ""
}

// validateProjectCodePath requires a clean repository-relative file path.
func validateProjectCodePath(path string) bool {
	if path == "" || strings.ContainsAny(path, "\\\x00") {
		return false
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

func decodeProjectCodeFile(path, ref string, body io.Reader) (ProjectCodeFileResponse, error) {
	var file struct {
		Type     string `json:"type"`
		SHA      string `json:"sha"`
		Encoding string `json:"encoding"`
		Content  string `json:"content"`
	}
	if err := json.NewDecoder(io.LimitReader(body, maxProjectCodeResponseBytes)).Decode(&file); err != nil {
		return ProjectCodeFileResponse{}, fmt.Errorf("decode contents: %w", err)
	}
	out := ProjectCodeFileResponse{Path: path, Ref: ref, SHA: file.SHA}
	// Symlinks and submodules have no text body to show.
	if file.Type != "file" {
		out.Binary = true
		return out, nil
	}
	if file.Encoding != "base64" {
		out.TooLarge = true
		return out, nil
	}
	raw, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(file.Content, "\n", ""))
	if err != nil {
		return ProjectCodeFileResponse{}, fmt.Errorf("decode file body: %w", err)
	}
	if bytes.IndexByte(raw, 0) >= 0 || !utf8.Valid(raw) {
		out.Binary = true
		return out, nil
	}
	out.Content = string(raw)
	return out, nil
}

func fetchProjectCodeFile(ctx context.Context, repo projectCodeRepo, path string) (ProjectCodeFileResponse, error) {
	endpoint := repo.contentsURL(path)
	if repo.ref != "" {
		endpoint += "?ref=" + url.QueryEscape(repo.ref)
	}
	resp, err := doGitHubAPIGet(ctx, projectCodeHTTPClient, endpoint)
	if err != nil {
		return ProjectCodeFileResponse{}, err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
		return decodeProjectCodeFile(path, repo.ref, resp.Body)
	case http.StatusNotFound:
		return ProjectCodeFileResponse{}, errProjectCodeNotFound
	default:
		return ProjectCodeFileResponse{}, fmt.Errorf("github status %d", resp.StatusCode)
	}
}

func commitProjectCodeFile(ctx context.Context, repo projectCodeRepo, token string, input SaveProjectCodeFileRequest) (string, error) {
	payload := map[string]string{
		"message": "Update " + input.Path,
		"content": base64.StdEncoding.EncodeToString([]byte(input.Content)),
		"sha":     input.SHA,
	}
	if repo.ref != "" {
		payload["branch"] = repo.ref
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, repo.contentsURL(input.Path), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	setGitHubAPIHeaders(req, token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := projectCodeHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK, http.StatusCreated:
	case http.StatusConflict, http.StatusUnprocessableEntity:
		return "", errProjectCodeConflict
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound:
		return "", errProjectCodeDenied
	default:
		return "", fmt.Errorf("github status %d", resp.StatusCode)
	}
	var result struct {
		Content struct {
			SHA string `json:"sha"`
		} `json:"content"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxProjectCodeResponseBytes)).Decode(&result); err != nil {
		return "", fmt.Errorf("decode commit: %w", err)
	}
	return result.Content.SHA, nil
}

// loadProjectCodeRepo resolves the route's resource to a GitHub repository in
// the caller's workspace.
func (h *Handler) loadProjectCodeRepo(w http.ResponseWriter, r *http.Request) (projectCodeRepo, bool) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return projectCodeRepo{}, false
	}
	resourceUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "resourceId"), "resource id")
	if !ok {
		return projectCodeRepo{}, false
	}
	resource, err := h.Queries.GetProjectResourceInWorkspace(r.Context(), db.GetProjectResourceInWorkspaceParams{
		ID: resourceUUID, WorkspaceID: project.WorkspaceID,
	})
	if err != nil || uuidToString(resource.ProjectID) != uuidToString(project.ID) {
		writeError(w, http.StatusNotFound, "project resource not found")
		return projectCodeRepo{}, false
	}
	if resource.ResourceType != "github_repo" {
		writeError(w, http.StatusBadRequest, "resource is not a GitHub repository")
		return projectCodeRepo{}, false
	}
	var ref struct {
		URL string `json:"url"`
		Ref string `json:"ref"`
	}
	if err := json.Unmarshal(resource.ResourceRef, &ref); err != nil {
		writeError(w, http.StatusBadRequest, "resource has an invalid repository reference")
		return projectCodeRepo{}, false
	}
	owner, name, ok := parseGitHubRepoURL(ref.URL)
	if !ok {
		writeError(w, http.StatusBadRequest, "only github.com repositories can be browsed")
		return projectCodeRepo{}, false
	}
	return projectCodeRepo{owner: owner, name: name, ref: ref.Ref}, true
}

// GetProjectCodeTree lists the files on the resource's branch.
func (h *Handler) GetProjectCodeTree(w http.ResponseWriter, r *http.Request) {
	repo, ok := h.loadProjectCodeRepo(w, r)
	if !ok {
		return
	}
	// GitHub resolves HEAD to the default branch when the resource pins none.
	treeRef := repo.ref
	if treeRef == "" {
		treeRef = "HEAD"
	}
	entries, truncated, err := fetchGitHubTree(r.Context(), projectCodeHTTPClient, repo.owner, repo.name, treeRef)
	if err != nil {
		slog.Warn("project code: tree fetch failed", "owner", repo.owner, "repo", repo.name, "error", err)
		writeError(w, http.StatusBadGateway, "could not read the repository from GitHub")
		return
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Type == "blob" {
			files = append(files, entry.Path)
		}
	}
	writeJSON(w, http.StatusOK, ProjectCodeTreeResponse{Ref: repo.ref, Truncated: truncated, Files: files})
}

// GetProjectCodeFile reads one file on the resource's branch.
func (h *Handler) GetProjectCodeFile(w http.ResponseWriter, r *http.Request) {
	repo, ok := h.loadProjectCodeRepo(w, r)
	if !ok {
		return
	}
	path := r.URL.Query().Get("path")
	if !validateProjectCodePath(path) {
		writeError(w, http.StatusBadRequest, "invalid file path")
		return
	}
	file, err := fetchProjectCodeFile(r.Context(), repo, path)
	if errors.Is(err, errProjectCodeNotFound) {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		slog.Warn("project code: file fetch failed", "owner", repo.owner, "repo", repo.name, "error", err)
		writeError(w, http.StatusBadGateway, "could not read the file from GitHub")
		return
	}
	writeJSON(w, http.StatusOK, file)
}

// SaveProjectCodeFile commits one file directly to the resource's branch.
func (h *Handler) SaveProjectCodeFile(w http.ResponseWriter, r *http.Request) {
	repo, ok := h.loadProjectCodeRepo(w, r)
	if !ok {
		return
	}
	if _, ok := requireUserID(w, r); !ok {
		return
	}
	var input SaveProjectCodeFileRequest
	r.Body = http.MaxBytesReader(w, r.Body, 2*maxProjectCodeFileBytes)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !validateProjectCodePath(input.Path) || input.SHA == "" {
		writeError(w, http.StatusBadRequest, "path and sha are required")
		return
	}
	if len(input.Content) > maxProjectCodeFileBytes {
		writeError(w, http.StatusBadRequest, "file is too large to save")
		return
	}
	token := strings.TrimSpace(os.Getenv("GITHUB_TOKEN"))
	if token == "" {
		writeError(w, http.StatusForbidden, "GITHUB_TOKEN is not configured on the server")
		return
	}
	sha, err := commitProjectCodeFile(r.Context(), repo, token, input)
	switch {
	case errors.Is(err, errProjectCodeConflict):
		writeError(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, errProjectCodeDenied):
		writeError(w, http.StatusForbidden, err.Error())
		return
	case err != nil:
		slog.Warn("project code: commit failed", "owner", repo.owner, "repo", repo.name, "error", err)
		writeError(w, http.StatusBadGateway, "could not save the file to GitHub")
		return
	}
	writeJSON(w, http.StatusOK, ProjectCodeFileResponse{
		Path: input.Path, Ref: repo.ref, SHA: sha, Content: input.Content,
	})
}
