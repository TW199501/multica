package llm

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/openai/openai-go/v3/option"
)

// maxUpstreamErrorBody bounds how much of an error response is read before it
// is reshaped; anything longer is cut, never buffered whole.
const maxUpstreamErrorBody = 64 << 10

// normalizeUpstreamError reshapes every non-2xx response body into the
// {"error":{"message":...}} form the SDK decodes. OpenAI-compatible gateways
// answer errors in other shapes ({"error":"text"}, {"message":"text"}, plain
// text), and the SDK then surfaces its own decode failure instead of an
// *openai.Error, which loses the HTTP status for UpstreamError.
func normalizeUpstreamError(req *http.Request, next option.MiddlewareNext) (*http.Response, error) {
	res, err := next(req)
	if err != nil || res == nil || res.StatusCode < 400 || res.Body == nil {
		return res, err
	}
	raw, readErr := io.ReadAll(io.LimitReader(res.Body, maxUpstreamErrorBody))
	_ = res.Body.Close()
	if readErr != nil {
		return nil, readErr
	}
	body := raw
	if message, reshape := upstreamErrorMessage(raw); reshape {
		if message == "" {
			message = http.StatusText(res.StatusCode)
		}
		body, _ = json.Marshal(map[string]any{"error": map[string]any{"message": message}})
		res.Header.Set("Content-Type", "application/json")
		res.Header.Del("Content-Encoding")
	}
	res.Body = io.NopCloser(bytes.NewReader(body))
	res.ContentLength = int64(len(body))
	return res, nil
}

// upstreamErrorMessage extracts the human-readable message from an error body
// that is not already {"error":{...}}. reshape is false when the body is in
// the SDK's own shape and must be passed through unchanged.
func upstreamErrorMessage(raw []byte) (message string, reshape bool) {
	var top struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
	}
	if err := json.Unmarshal(raw, &top); err != nil {
		return strings.TrimSpace(string(raw)), true
	}
	trimmed := bytes.TrimSpace(top.Error)
	if len(trimmed) > 0 && trimmed[0] == '{' {
		return "", false
	}
	var text string
	if len(trimmed) > 0 && json.Unmarshal(trimmed, &text) == nil && text != "" {
		return strings.TrimSpace(text), true
	}
	if top.Message != "" {
		return strings.TrimSpace(top.Message), true
	}
	return strings.TrimSpace(string(raw)), true
}
