package aisettings

import (
	"errors"
	"strings"
	"testing"
)

func TestProtectRoundTrip(t *testing.T) {
	text := "請 [@Ann](mention://agent/1) 看 https://x.y/z 跟 `a_b`"
	masked, spans := Protect(text)
	for _, s := range []string{"[@Ann](mention://agent/1)", "https://x.y/z", "`a_b`"} {
		if strings.Contains(masked, s) {
			t.Errorf("masked %q still contains %q", masked, s)
		}
	}
	if want := "請 ⟦1⟧ 看 ⟦2⟧ 跟 ⟦3⟧"; masked != want {
		t.Errorf("masked = %q, want %q", masked, want)
	}
	if len(spans) != 3 {
		t.Fatalf("spans = %v", spans)
	}
	got, err := Restore(masked, spans)
	if err != nil {
		t.Fatal(err)
	}
	if got != text {
		t.Errorf("Restore = %q, want %q", got, text)
	}
}

func TestProtectCoversFencedCodeAndIsDeterministic(t *testing.T) {
	text := "see ```go\nx := `y` // https://a.b\n``` and ``a ` b`` then [doc](https://d.e/f) ⟦1⟧"
	masked, spans := Protect(text)
	if want := "see ⟦1⟧ and ⟦2⟧ then ⟦3⟧ ⟦4⟧"; masked != want {
		t.Fatalf("masked = %q, want %q", masked, want)
	}
	if spans[0] != "```go\nx := `y` // https://a.b\n```" || spans[3] != "⟦1⟧" {
		t.Errorf("spans = %q", spans)
	}
	again, spans2 := Protect(text)
	if again != masked || strings.Join(spans2, "\x00") != strings.Join(spans, "\x00") {
		t.Error("Protect is not deterministic")
	}
	got, err := Restore("now "+masked, spans)
	if err != nil {
		t.Fatal(err)
	}
	if got != "now "+text {
		t.Errorf("Restore = %q", got)
	}
}

func TestProtectEditorLinkForms(t *testing.T) {
	cases := []string{
		"!file[a.pdf](/api/attachments/1/download)",
		`[@A\[B\]](mention://agent/x)`,
		`!file[report\[final\].pdf](/api/attachments/2/download)`,
		"![shot.png](/api/attachments/3/download)",
	}
	for _, span := range cases {
		text := "see " + span + " now"
		masked, spans := Protect(text)
		if masked != "see ⟦1⟧ now" || len(spans) != 1 || spans[0] != span {
			t.Errorf("%s: masked %q spans %q", span, masked, spans)
			continue
		}
		if got, err := Restore(masked, spans); err != nil || got != text {
			t.Errorf("%s: Restore = %q, %v", span, got, err)
		}
	}
}

func TestProtectWithoutSpans(t *testing.T) {
	masked, spans := Protect("plain text")
	if masked != "plain text" || len(spans) != 0 {
		t.Fatalf("masked %q spans %v", masked, spans)
	}
	if got, err := Restore("Plain text.", spans); err != nil || got != "Plain text." {
		t.Fatalf("Restore = %q, %v", got, err)
	}
}

func TestRestoreFailsOnMissingOrDuplicate(t *testing.T) {
	spans := []string{"[@Ann](mention://agent/1)", "`a_b`"}
	cases := map[string]string{
		"missing":   "hello ⟦1⟧",
		"duplicate": "hello ⟦1⟧ ⟦1⟧ ⟦2⟧",
		"unknown":   "hello ⟦1⟧ ⟦2⟧ ⟦3⟧",
	}
	for name, masked := range cases {
		if _, err := Restore(masked, spans); !errors.Is(err, ErrSpanLost) {
			t.Errorf("%s: err = %v, want ErrSpanLost", name, err)
		}
	}
}

func TestProtectBareIssueIdentifiers(t *testing.T) {
	text := "修好 MUL-123 和 E-45，再看(ABC9-7)。"
	masked, spans := Protect(text)
	if want := "修好 ⟦1⟧ 和 ⟦2⟧，再看(⟦3⟧)。"; masked != want {
		t.Fatalf("masked = %q, want %q", masked, want)
	}
	if strings.Join(spans, ",") != "MUL-123,E-45,ABC9-7" {
		t.Fatalf("spans = %q", spans)
	}
	if got, err := Restore(masked, spans); err != nil || got != text {
		t.Fatalf("Restore = %q, %v", got, err)
	}
}

// Same boundaries as IDENTIFIER_RE in packages/ui/markdown/issue-identifiers.ts:
// no [A-Za-z0-9_-] on either side, and lowercase prefixes are not identifiers.
func TestProtectIgnoresNonIdentifiers(t *testing.T) {
	for _, text := range []string{"xMUL-1", "MUL-1x", "_MUL-1", "MUL-1_", "a-MUL-1", "MUL-1-2", "mul-1", "MUL-", "-1"} {
		if masked, spans := Protect(text); masked != text || len(spans) != 0 {
			t.Errorf("%q: masked %q spans %q", text, masked, spans)
		}
	}
}

func TestProtectKeepsIdentifierInsideItsSpan(t *testing.T) {
	cases := []string{
		"[MUL-1](mention://issue/MUL-1)",
		"https://app.example/acme/issues/MUL-1",
		"`MUL-1`",
		"[see MUL-1](https://en.wikipedia.org/wiki/Foo_(MUL-1))",
	}
	for _, span := range cases {
		text := "看 " + span + " 吧"
		masked, spans := Protect(text)
		if masked != "看 ⟦1⟧ 吧" || len(spans) != 1 || spans[0] != span {
			t.Errorf("%s: masked %q spans %q", span, masked, spans)
		}
	}
}

func TestProtectLinkWithBalancedParensInDestination(t *testing.T) {
	text := "see [w](https://en.wikipedia.org/wiki/Foo_(bar)) now"
	masked, spans := Protect(text)
	if masked != "see ⟦1⟧ now" || len(spans) != 1 || spans[0] != "[w](https://en.wikipedia.org/wiki/Foo_(bar))" {
		t.Fatalf("masked %q spans %q", masked, spans)
	}
	if got, err := Restore(masked, spans); err != nil || got != text {
		t.Fatalf("Restore = %q, %v", got, err)
	}
}
