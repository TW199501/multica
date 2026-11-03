// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fromDisplayText, toDisplayText } from "./display-text";

const AGENT = "[@E50 驗收代理](mention://agent/419a4055-2a7f-473c-ab72-ab437b950e4d)";
const ISSUE = "[E50-1](mention://issue/01a1a1eb-3d2d-7139-afd5-e19ec6b0bffe)";
const FILE = "!file[e50-attachment.txt](http://localhost:18259/uploads/ws/01a1a1f8.txt)";
const IMAGE = "![screen](http://localhost:18259/uploads/ws/shot.png)";

describe("toDisplayText", () => {
  it("shows mention and issue links as their label", () => {
    const { text, map } = toDisplayText(`${AGENT} 麻煩看一下 ${ISSUE}，謝謝`);
    expect(text).toBe("@E50 驗收代理 麻煩看一下 E50-1，謝謝");
    expect(map.links).toEqual([
      { label: "@E50 驗收代理", markdown: AGENT },
      { label: "E50-1", markdown: ISSUE },
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
