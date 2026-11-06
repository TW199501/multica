package aisettings

import (
	"strings"
	"testing"
)

func TestProtectMasksCompleteFences(t *testing.T) {
	cases := map[string]string{
		"tilde":                 "~~~\nkeep FOO_BAR exactly\n~~~",
		"tilde with info":       "~~~go\nfunc main() {}\n~~~",
		"four backticks":        "````md\n```\ninner\n```\nstill code\n````",
		"longer closing fence":  "```\ncode\n`````",
		"indented fence":        "  ```\ncode\n  ```",
		"tilde holds backticks": "~~~\n```\nnot a close\n~~~",
		"closing with crlf":     "~~~\r\ncode\r\n~~~\r",
	}
	for name, fence := range cases {
		t.Run(name, func(t *testing.T) {
			masked, spans := Protect("before\n" + fence + "\nafter")

			if strings.Contains(masked, "code") || strings.Contains(masked, "inner") || strings.Contains(masked, "FOO_BAR") || strings.Contains(masked, "func main") {
				t.Fatalf("code left in the masked text: %q", masked)
			}
			if !strings.Contains(masked, "before") || !strings.Contains(masked, "after") {
				t.Fatalf("prose was masked: %q", masked)
			}
			restored, err := Restore(masked, spans)
			if err != nil {
				t.Fatalf("Restore: %v", err)
			}
			if restored != "before\n"+fence+"\nafter" {
				t.Fatalf("round trip changed the text: %q", restored)
			}
		})
	}
}

func TestProtectDoesNotCloseAFenceWithAShorterOrOtherMarker(t *testing.T) {
	text := "````\n```\nstill inside\n~~~~\nstill inside too\n"

	masked, spans := Protect(text)

	if len(spans) != 1 || spans[0] != text {
		t.Fatalf("an unclosed fence should run to the end as one span: masked %q, spans %q", masked, spans)
	}
}

func TestProtectKeepsMaskingAroundFencesInOrder(t *testing.T) {
	text := "see ABC-12 then\n~~~\ncode\n~~~\nand [a](https://x.test)"

	masked, spans := Protect(text)

	want := "see ⟦1⟧ then\n⟦2⟧\nand ⟦3⟧"
	if masked != want {
		t.Fatalf("masked = %q, want %q", masked, want)
	}
	if len(spans) != 3 || spans[0] != "ABC-12" {
		t.Fatalf("spans = %q", spans)
	}
}

func TestProtectChecksIdentifierNeighboursAcrossAFenceBoundary(t *testing.T) {
	masked, spans := Protect("~~~\nx\n~~~\nxABC-12 ABC-34x")

	if len(spans) != 1 {
		t.Fatalf("only the fence should be masked: masked %q, spans %q", masked, spans)
	}
}
