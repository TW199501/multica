/**
 * The dialog shows the draft as readable text: attachment cards and images
 * leave it and come back on confirm, mention and issue links show as their
 * label and go back to links where that label still is. Code stays literal.
 * The model always gets the full markdown; this only shapes what the person
 * reads and edits.
 */
export interface DisplayLink {
  /** What the text shows instead of the link. */
  label: string;
  markdown: string;
  /** Which occurrence of the label this link is, or -1 when none is its own. */
  occurrence: number;
  /** How many occurrences of the label the text had. */
  total: number;
}

export interface DisplayMap {
  /** Whole-line cards in order, re-appended after the text on confirm. */
  hidden: string[];
  /** Links in order of appearance. */
  links: DisplayLink[];
}

export interface DisplayText {
  text: string;
  map: DisplayMap;
}

interface Range {
  start: number;
  end: number;
}

const CARD_LINE = /^!(?:file)?\[(?:\\.|[^\]\\])*\]\([^)\s]+\)[ \t]*$/gm;
const MENTION_LINK = /\[((?:\\.|[^\]\\])+)\]\(mention:\/\/[^)\s]+\)/g;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[^\n]*$/gm;
// Private-use markers hold each link's place while blank lines collapse.
const LINK_MARKER = /(\d+)/g;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
// These scripts run words together, so a label may be followed by more text.
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function unescapeLabel(label: string): string {
  return label.replace(/\\([\\[\]])/g, "$1");
}

function fenceRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const open = new RegExp(FENCE_OPEN);
  for (let match = open.exec(text); match; match = open.exec(text)) {
    const marker = match[1]!;
    const close = new RegExp(`^ {0,3}\\${marker[0]}{${marker.length},}[ \\t]*$`, "gm");
    close.lastIndex = match.index + match[0].length;
    const closing = close.exec(text);
    const end = closing ? closing.index + closing[0].length : text.length;
    ranges.push({ start: match.index, end });
    open.lastIndex = end;
  }
  return ranges;
}

function inlineCodeRanges(text: string, start: number, end: number): Range[] {
  const ranges: Range[] = [];
  const ticks = /`+/g;
  ticks.lastIndex = start;
  for (let open = ticks.exec(text); open && open.index < end; open = ticks.exec(text)) {
    const closing = /`+/g;
    closing.lastIndex = ticks.lastIndex;
    for (let run = closing.exec(text); run && run.index < end; run = closing.exec(text)) {
      if (run[0].length === open[0].length) {
        ranges.push({ start: open.index, end: closing.lastIndex });
        ticks.lastIndex = closing.lastIndex;
        break;
      }
    }
  }
  return ranges;
}

/** Fenced blocks and inline code spans, in order. */
function codeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let cursor = 0;
  for (const fence of fenceRanges(text)) {
    ranges.push(...inlineCodeRanges(text, cursor, fence.start), fence);
    cursor = fence.end;
  }
  ranges.push(...inlineCodeRanges(text, cursor, text.length));
  return ranges;
}

function overlaps(ranges: Range[], start: number, end: number): boolean {
  return ranges.some((range) => start < range.end && range.start < end);
}

function runsIntoWord(outer: string | undefined, inner: string | undefined): boolean {
  if (!outer || !inner) return false;
  return (
    WORD_CHAR.test(outer) &&
    WORD_CHAR.test(inner) &&
    !UNSPACED_SCRIPT.test(outer) &&
    !UNSPACED_SCRIPT.test(inner)
  );
}

/**
 * Where each label stands in the text, outside code and not inside a longer
 * label or word, so `@Ann` never claims the start of `@Anna`.
 */
function findLabels(text: string, labels: string[]): Map<string, number[]> {
  const code = codeRanges(text);
  const claimed: Range[] = [];
  const found = new Map<string, number[]>();
  const longestFirst = [...new Set(labels)].sort((a, b) => b.length - a.length);
  for (const label of longestFirst) {
    const positions: number[] = [];
    for (let at = text.indexOf(label); at >= 0; at = text.indexOf(label, at + 1)) {
      const end = at + label.length;
      if (overlaps(code, at, end) || overlaps(claimed, at, end)) continue;
      if (
        runsIntoWord(text[end], label[label.length - 1]) ||
        runsIntoWord(text[at - 1], label[0])
      ) {
        continue;
      }
      positions.push(at);
      claimed.push({ start: at, end });
    }
    found.set(label, positions);
  }
  return found;
}

export function toDisplayText(markdown: string): DisplayText {
  const hidden: string[] = [];
  const parsed: { label: string; markdown: string }[] = [];

  const prose = (start: number, end: number): string =>
    markdown
      .slice(start, end)
      .replace(CARD_LINE, (card: string, offset: number) => {
        const from = start + offset;
        const to = from + card.length;
        // A segment edge next to inline code is not a line edge.
        if ((from > 0 && markdown[from - 1] !== "\n") || (to < markdown.length && markdown[to] !== "\n")) {
          return card;
        }
        hidden.push(card.trim());
        return "";
      })
      .replace(MENTION_LINK, (link: string, label: string) => {
        parsed.push({ label: unescapeLabel(label), markdown: link });
        return `${parsed.length - 1}`;
      })
      .replace(/\n{3,}/g, "\n\n");

  let marked = "";
  let cursor = 0;
  for (const range of codeRanges(markdown)) {
    marked += prose(cursor, range.start) + markdown.slice(range.start, range.end);
    cursor = range.end;
  }
  marked = (marked + prose(cursor, markdown.length)).trim();

  const offsets = new Map<number, number>();
  let text = "";
  let last = 0;
  for (const match of marked.matchAll(LINK_MARKER)) {
    const index = Number(match[1]);
    text += marked.slice(last, match.index);
    offsets.set(index, text.length);
    text += parsed[index]?.label ?? "";
    last = match.index + match[0].length;
  }
  text += marked.slice(last);

  const found = findLabels(text, parsed.map((link) => link.label));
  const links = parsed.map((link, index) => {
    const positions = found.get(link.label) ?? [];
    return {
      ...link,
      occurrence: positions.indexOf(offsets.get(index) ?? -1),
      total: positions.length,
    };
  });
  return { text, map: { hidden, links } };
}

/** True when the draft has words to polish, not only attachments. */
export function hasPolishableText(markdown: string): boolean {
  return toDisplayText(markdown).text.length > 0;
}

export function fromDisplayText(text: string, map: DisplayMap): string {
  const found = findLabels(text, map.links.map((link) => link.label));
  const byLabel = new Map<string, DisplayLink[]>();
  for (const link of map.links) {
    byLabel.set(link.label, [...(byLabel.get(link.label) ?? []), link]);
  }

  const picks: { at: number; len: number; markdown: string }[] = [];
  for (const [label, links] of byLabel) {
    const positions = found.get(label) ?? [];
    // With the same number of occurrences, each link keeps its own; once the
    // edit added or removed some, the links take them in order.
    const sameShape = links.every(
      (link) => link.occurrence >= 0 && link.total === positions.length,
    );
    links.forEach((link, index) => {
      const at = positions[sameShape ? link.occurrence : index];
      if (at !== undefined) picks.push({ at, len: label.length, markdown: link.markdown });
    });
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

/** The markdown for what the right column holds; untouched text needs no conversion. */
export function fromEditedDisplay(markdown: string, view: DisplayText, edited: string): string {
  return edited === view.text ? markdown : fromDisplayText(edited, view.map);
}
