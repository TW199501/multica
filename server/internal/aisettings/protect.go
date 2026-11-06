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

// protectPattern is one left-to-right scan of the text between fenced blocks;
// alternation order matters so that a triple-backtick run wins over inline code,
// a markdown link wins over the URL inside it, and
// an issue identifier inside a link, URL or code stays inside that span.
// Literal placeholders already in the text are protected too, so they cannot
// be confused with ours on Restore. Only the identifier alternative captures.
var protectPattern = regexp.MustCompile(
	"(?s:```.*?(?:```|\\z))" + // fenced code block (an unclosed fence runs to the end)
		// Inline code may wrap onto the next line, but a blank line ends it.
		"|``(?:[^\\n]|\\n[^\\n])*?``" + // inline code with double backticks
		"|`(?:[^`\\n]|\\n[^`\\n])+`" + // inline code
		// Markdown link, image or file card (!file[...]), incl. mention://; the
		// editor backslash-escapes brackets inside labels. The destination may
		// hold one level of balanced parentheses (wiki/Foo_(bar)).
		"|(?:!file|!)?\\[(?:\\\\.|[^\\[\\]\\\\\\n])*\\]\\((?:[^()\\n]|\\([^()\\n]*\\))*\\)" +
		"|https?://\\S+" + // bare URL
		"|([A-Z][A-Z0-9]*-\\d+)" + // bare issue identifier, boundaries checked in Protect
		"|⟦\\d+⟧", // literal placeholder
)

var fenceOpenPattern = regexp.MustCompile("^ {0,3}(?:`{3,}|~{3,})")

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
	mask := func(start, end int) {
		spans = append(spans, text[start:end])
		b.WriteString(text[last:start])
		b.WriteString(placeholder(len(spans)))
		last = end
	}
	maskProse := func(from, to int) {
		for _, loc := range protectPattern.FindAllStringSubmatchIndex(text[from:to], -1) {
			start, end := loc[0]+from, loc[1]+from
			if loc[2] >= 0 && ((start > 0 && isIdentifierNeighbour(text[start-1])) ||
				(end < len(text) && isIdentifierNeighbour(text[end]))) {
				continue
			}
			mask(start, end)
		}
	}
	cursor := 0
	for _, fence := range fenceRanges(text) {
		maskProse(cursor, fence[0])
		mask(fence[0], fence[1])
		cursor = fence[1]
	}
	maskProse(cursor, len(text))
	b.WriteString(text[last:])
	return b.String(), spans
}

// fenceRanges finds Markdown fenced code blocks. RE2 has no backreferences, so a
// closing fence has to be matched against its opening marker and length here.
func fenceRanges(text string) [][2]int {
	var ranges [][2]int
	open := -1
	var marker byte
	var length int
	for pos := 0; pos < len(text); {
		lineEnd := len(text)
		if i := strings.IndexByte(text[pos:], '\n'); i >= 0 {
			lineEnd = pos + i
		}
		line := strings.TrimSuffix(text[pos:lineEnd], "\r")
		if open < 0 {
			if m := fenceOpenPattern.FindString(line); m != "" {
				run := strings.TrimLeft(m, " ")
				// A backtick fence's info string cannot hold a backtick: that is inline code.
				if run[0] != '`' || !strings.Contains(line[len(m):], "`") {
					open, marker, length = pos, run[0], len(run)
				}
			}
		} else if isFenceClose(line, marker, length) {
			ranges = append(ranges, [2]int{open, pos + len(line)})
			open = -1
		}
		pos = lineEnd + 1
	}
	if open >= 0 {
		ranges = append(ranges, [2]int{open, len(text)})
	}
	return ranges
}

func isFenceClose(line string, marker byte, length int) bool {
	trimmed := strings.TrimLeft(line, " ")
	if len(line)-len(trimmed) > 3 {
		return false
	}
	run := 0
	for run < len(trimmed) && trimmed[run] == marker {
		run++
	}
	return run >= length && strings.TrimRight(trimmed[run:], " \t") == ""
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
