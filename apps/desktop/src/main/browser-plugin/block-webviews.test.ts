// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { blockAllWebviews, type WebContentsLike } from "./block-webviews";

type Listener = (event: { preventDefault(): void }) => void;

function makeContents() {
  const listeners: Listener[] = [];
  const contents: WebContentsLike = {
    on: (_event, listener) => {
      listeners.push(listener);
      return contents;
    },
  };
  return { contents, listeners };
}

describe("blockAllWebviews", () => {
  it("blocks webviews on existing web contents", () => {
    const existing = makeContents();
    blockAllWebviews({
      onWebContentsCreated: () => {},
      getAllWebContents: () => [existing.contents],
    });

    expect(existing.listeners).toHaveLength(1);
    const preventDefault = vi.fn();
    existing.listeners[0]({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("blocks webviews on web contents created later", () => {
    let onCreated: (contents: WebContentsLike) => void = () => {};
    blockAllWebviews({
      onWebContentsCreated: (listener) => {
        onCreated = listener;
      },
      getAllWebContents: () => [],
    });

    const later = makeContents();
    onCreated(later.contents);

    expect(later.listeners).toHaveLength(1);
    const preventDefault = vi.fn();
    later.listeners[0]({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
