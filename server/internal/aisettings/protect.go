package aisettings

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
)

// ErrSpanLost means the model dropped, duplicated or invented a placeholder,
// so the protected spans cannot be put back safely.
var ErrSpanLost = errors.New("aisettings: polished text lost a protected span")

// protectPattern is one left-to-right scan; alternation order matters so that a
// fence wins over inline code, a markdown link wins over the URL inside it, and
// an issue identifier inside a link, URL or code stays inside that span.
// Literal placeholders already in the text are protected too, so they cannot
// be confused with ours on Restore. Only the identifier alternative captures.
var protectPattern = regexp.MustCompile(
	"(?s:```.*?(?:```|\\z))" + // fenced code block (an unclosed fence runs to the end)
		"|``[^\\n]*?``" + // inline code with double backticks
		"|`[^`\\n]+`" + // inline code
		// Markdown link, image or file card (!file[...]), incl. mention://; the
		// editor backslash-escapes brackets inside labels. The destination may
		// hold one level of balanced parentheses (wiki/Foo_(bar)).
		"|(?:!file|!)?\\[(?:\\\\.|[^\\[\\]\\\\\\n])*\\]\\((?:[^()\\n]|\\([^()\\n]*\\))*\\)" +
		"|https?://\\S+" + // bare URL
		"|([A-Z][A-Z0-9]*-\\d+)" + // bare issue identifier, boundaries checked in Protect
		"|⟦\\d+⟧", // literal placeholder
)

var placeholderPattern = regexp.MustCompile(`⟦(\d+)⟧`)

func placeholder(n int) string { return "⟦" + strconv.Itoa(n) + "⟧" }

// isIdentifierNeighbour mirrors the lookarounds of IDENTIFIER_RE in
// packages/ui/markdown/issue-identifiers.ts, which RE2 cannot express.
func isIdentifierNeighbour(b byte) bool {
	return b == '_' || b == '-' || ('0' <= b && b <= '9') || ('a' <= b && b <= 'z') || ('A' <= b && b <= 'Z')
}

// Protect replaces links, mentions, URLs, issue identifiers and code with ⟦1⟧,
// ⟦2⟧… in order of appearance, returning the masked text and the original spans.
func Protect(text string) (string, []string) {
	var spans []string
	var b strings.Builder
	last := 0
	for _, loc := range protectPattern.FindAllStringSubmatchIndex(text, -1) {
		start, end := loc[0], loc[1]
		if loc[2] >= 0 && ((start > 0 && isIdentifierNeighbour(text[start-1])) ||
			(end < len(text) && isIdentifierNeighbour(text[end]))) {
			continue
		}
		spans = append(spans, text[start:end])
		b.WriteString(text[last:start])
		b.WriteString(placeholder(len(spans)))
		last = end
	}
	b.WriteString(text[last:])
	return b.String(), spans
}

// Restore puts the spans back. Every placeholder must appear exactly once and
// no unknown placeholder may appear; otherwise it returns ErrSpanLost.
func Restore(masked string, spans []string) (string, error) {
	seen := make([]int, len(spans))
	for _, m := range placeholderPattern.FindAllStringSubmatch(masked, -1) {
		n, err := strconv.Atoi(m[1])
		if err != nil || n < 1 || n > len(spans) {
			return "", ErrSpanLost
		}
		seen[n-1]++
	}
	for _, c := range seen {
		if c != 1 {
			return "", ErrSpanLost
		}
	}
	// Single pass, so a restored span that itself looks like a placeholder is
	// never substituted again.
	var b strings.Builder
	last := 0
	for _, loc := range placeholderPattern.FindAllStringSubmatchIndex(masked, -1) {
		n, _ := strconv.Atoi(masked[loc[2]:loc[3]])
		b.WriteString(masked[last:loc[0]])
		b.WriteString(spans[n-1])
		last = loc[1]
	}
	b.WriteString(masked[last:])
	return b.String(), nil
}
