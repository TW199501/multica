// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fromDisplayText, fromEditedDisplay, hasPolishableText, toDisplayText } from "./display-text";

const AGENT = "[@E50 驗收代理](mention://agent/419a4055-2a7f-473c-ab72-ab437b950e4d)";
const ISSUE = "[E50-1](mention://issue/01a1a1eb-3d2d-7139-afd5-e19ec6b0bffe)";
const FILE = "!file[e50-attachment.txt](http://localhost:18259/uploads/ws/01a1a1f8.txt)";
const IMAGE = "![screen](http://localhost:18259/uploads/ws/shot.png)";

describe("toDisplayText", () => {
  it("shows mention and issue links as their label", () => {
    const { text, map } = toDisplayText(`${AGENT} 麻煩看一下 ${ISSUE}，謝謝`);
    expect(text).toBe("@E50 驗收代理 麻煩看一下 E50-1，謝謝");
    expect(map.links).toEqual([
      { label: "@E50 驗收代理", markdown: AGENT, occurrence: 0, total: 1 },
      { label: "E50-1", markdown: ISSUE, occurrence: 0, total: 1 },
    ]);
  });

  it("takes attachment cards and images out of the text", () => {
    const { text, map } = toDisplayText(`收到\n\n${FILE}\n\n${IMAGE}\n\n`);
    expect(text).toBe("收到");
    expect(map.hidden).toEqual([FILE, IMAGE]);
  });

  it("unescapes bracketed labels", () => {
    const { text } = toDisplayText("[@a \\[b\\]](mention://user/u1) hi");
    expect(text).toBe("@a [b] hi");
  });

  it("leaves ordinary links and inline images alone", () => {
    const md = "see [docs](https://example.com) and ![x](https://example.com/x.png) inline";
    expect(toDisplayText(md).text).toBe(md);
  });
});

describe("hasPolishableText", () => {
  it("is false for a draft holding only attachments", () => {
    expect(hasPolishableText(`${FILE}\n\n${IMAGE}\n\n`)).toBe(false);
    expect(hasPolishableText("   ")).toBe(false);
    expect(hasPolishableText(`hi\n\n${FILE}`)).toBe(true);
  });
});

describe("fromDisplayText", () => {
  it("restores links where their label remains and re-appends cards", () => {
    const original = `${AGENT} 麻煩看以下 ${ISSUE}\n\n${FILE}`;
    const { text, map } = toDisplayText(original);
    expect(fromDisplayText(text, map)).toBe(original);
    expect(fromDisplayText("E50-1 這個先處理，@E50 驗收代理 謝謝", map)).toBe(
      `${ISSUE} 這個先處理，${AGENT} 謝謝\n\n${FILE}`,
    );
  });

  it("drops a link whose label was edited away", () => {
    const { map } = toDisplayText(`${AGENT} hello`);
    expect(fromDisplayText("hello there", map)).toBe("hello there");
  });

  it("keeps the cards when the text is emptied", () => {
    const { map } = toDisplayText(`x\n\n${FILE}`);
    expect(fromDisplayText("   ", map)).toBe(FILE);
  });
});

const ANN = "[@Ann](mention://member/ann)";
const ANNA = "[@Anna](mention://member/anna)";

describe("link identity through an edit", () => {
  it("keeps a shorter label off the text of a longer one", () => {
    const { map } = toDisplayText(`${ANN} and ${ANNA}`);
    expect(fromDisplayText("@Anna then @Ann", map)).toBe(`${ANNA} then ${ANN}`);
  });

  it("does not link a label inside a longer word", () => {
    const { map } = toDisplayText(`${ANN} hi`);
    expect(fromDisplayText("@Annabel and @Ann", map)).toBe(`@Annabel and ${ANN}`);
  });

  it("links a label directly followed by CJK text", () => {
    const link = "[@小明](mention://member/m)";
    const { map } = toDisplayText(`${link} 你好`);
    expect(fromDisplayText("@小明請看", map)).toBe(`${link}請看`);
  });

  it("keeps a link on its own occurrence when plain text shares the label", () => {
    const { map } = toDisplayText(`@Ann said hi to ${ANN}`);
    expect(fromDisplayText("@Ann said hello to @Ann", map)).toBe(`@Ann said hello to ${ANN}`);
  });
});

describe("code stays literal", () => {
  const FENCED = `intro

\`\`\`md
${IMAGE}



${ANN}
\`\`\`

end`;

  it("leaves fenced blocks untouched, cards and blank lines included", () => {
    const { text, map } = toDisplayText(FENCED);
    expect(text).toBe(FENCED);
    expect(map).toEqual({ hidden: [], links: [] });
    expect(fromDisplayText(text, map)).toBe(FENCED);
  });

  it("leaves inline code untouched", () => {
    const md = `\`${ANN}\` and ${ANN}`;
    const { text, map } = toDisplayText(md);
    expect(text).toBe(`\`${ANN}\` and @Ann`);
    expect(map.links).toHaveLength(1);
    expect(fromDisplayText(text, map)).toBe(md);
  });

  it("does not put a link on a label inside code", () => {
    const { map } = toDisplayText(`${ANN} hi`);
    expect(fromDisplayText("`@Ann` ok @Ann", map)).toBe(`\`@Ann\` ok ${ANN}`);
  });
});

describe("fromEditedDisplay", () => {
  it("returns the markdown untouched while the text is unchanged", () => {
    const md = `@Ann ${ANN}

${FILE}

tail`;
    const view = toDisplayText(md);
    expect(fromEditedDisplay(md, view, view.text)).toBe(md);
  });

  it("converts once the text was edited", () => {
    const md = `${ANN} hi

${FILE}`;
    const view = toDisplayText(md);
    expect(fromEditedDisplay(md, view, "@Ann hello")).toBe(`${ANN} hello

${FILE}`);
  });
});
