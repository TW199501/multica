export type WebContentsLike = {
  on(
    event: "will-attach-webview",
    listener: (event: { preventDefault(): void }) => void,
  ): unknown;
};

export interface BlockWebviewsDeps {
  onWebContentsCreated(listener: (contents: WebContentsLike) => void): void;
  getAllWebContents(): WebContentsLike[];
}

// Denies every <webview> attachment on all current and future web contents.
export function blockAllWebviews(deps: BlockWebviewsDeps): void {
  const block = (contents: WebContentsLike): void => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  };
  deps.onWebContentsCreated(block);
  deps.getAllWebContents().forEach(block);
}
