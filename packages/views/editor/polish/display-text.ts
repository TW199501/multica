/**
 * The dialog shows the draft as readable text: attachment cards and images
 * leave it and come back on confirm, mention and issue links show as their
 * label and go back to links where that label still is. The model always
 * gets the full markdown; this only shapes what the person reads and edits.
 */
export interface DisplayMap {
  /** Whole-line cards in order, re-appended after the text on confirm. */
  hidden: string[];
  /** Links in order of appearance; `label` is what the text shows instead. */
  links: { label: string; markdown: string }[];
}

export interface DisplayText {
  text: string;
  map: DisplayMap;
}

const CARD_LINE = /^!(?:file)?\[(?:\\.|[^\]\\])*\]\([^)\s]+\)[ \t]*$/gm;
const MENTION_LINK = /\[((?:\\.|[^\]\\])+)\]\(mention:\/\/[^)\s]+\)/g;

function unescapeLabel(label: string): string {
  return label.replace(/\\([\\[\]])/g, "$1");
}

export function toDisplayText(markdown: string): DisplayText {
  const hidden: string[] = [];
  const withoutCards = markdown.replace(CARD_LINE, (card) => {
    hidden.push(card.trim());
    return "";
  });
  const links: DisplayMap["links"] = [];
  const text = withoutCards
    .replace(MENTION_LINK, (link, label: string) => {
      const shown = unescapeLabel(label);
      links.push({ label: shown, markdown: link });
      return shown;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, map: { hidden, links } };
}

export function fromDisplayText(text: string, map: DisplayMap): string {
  // Each link takes the first occurrence of its label that no earlier link
  // took, wherever the edit moved it.
  const picks: { at: number; len: number; markdown: string }[] = [];
  for (const { label, markdown } of map.links) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(label, from);
      if (at < 0) break;
      const taken = picks.some((p) => at < p.at + p.len && p.at < at + label.length);
      if (!taken) {
        picks.push({ at, len: label.length, markdown });
        break;
      }
      from = at + 1;
    }
  }
  picks.sort((a, b) => a.at - b.at);
  let out = "";
  let cursor = 0;
  for (const pick of picks) {
    out += text.slice(cursor, pick.at) + pick.markdown;
    cursor = pick.at + pick.len;
  }
  out += text.slice(cursor);
  const body = out.trim();
  if (map.hidden.length === 0) return body;
  return body ? `${body}\n\n${map.hidden.join("\n\n")}` : map.hidden.join("\n\n");
}
