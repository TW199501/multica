// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserAgentPayload } from "@elf-express/orca-browser/shared";
import { createChatStore, DRAFT_NEW_SESSION, registerChatStore, useChatStore } from "@multica/core/chat";
import { useCommentDraftStore } from "@multica/core/issues/stores";
import type { Attachment, StorageAdapter } from "@multica/core/types";
import {
  browserAttachmentMarkdown,
  chatDraftTarget,
  deliverBrowserPayload,
  issueCommentDraftTarget,
  payloadImageToFile,
} from "./send-to-agent";

const P: BrowserAgentPayload = {
  kind: "grab",
  pageUrl: "https://a.test",
  pageTitle: "A",
  text: "## Grab\n<div>",
  images: [{ name: "shot.png", mimeType: "image/png", dataBase64: btoa("abc") }],
};
const NO_IMAGES: BrowserAgentPayload = { ...P, images: [] };
const ATT = {
  id: "att1",
  filename: "shot.png",
  content_type: "image/png",
  markdown_url: "https://m/x",
} as unknown as Attachment;

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

beforeEach(() => {
  useCommentDraftStore.getState().clearDraft("new:i1");
  registerChatStore(createChatStore({ storage: memoryStorage() }));
});

describe("send-to-agent", () => {
  it("decodes base64 into a PNG file", () => {
    const f = payloadImageToFile(P.images[0]);
    expect(f.name).toBe("shot.png");
    expect(f.type).toBe("image/png");
    expect(f.size).toBe(3);
  });

  it("formats screenshots as image markdown", () => {
    expect(browserAttachmentMarkdown(ATT)).toBe("![shot.png](https://m/x)");
  });

  it("writes text and uploaded screenshots into the issue draft", async () => {
    const uploadFile = vi.fn().mockResolvedValue(ATT);
    const r = await deliverBrowserPayload(P, issueCommentDraftTarget("i1"), {
      api: { uploadFile },
      createId: () => "u1",
    });
    expect(r).toEqual({ uploaded: 1, failed: 0 });
    const s = useCommentDraftStore.getState();
    expect(s.getDraft("new:i1")).toBe("## Grab\n<div>\n\n![shot.png](https://m/x)");
    expect(s.getAttachments("new:i1").map((a) => a.id)).toEqual(["att1"]);
    expect(uploadFile).toHaveBeenCalledWith(
      expect.any(File),
      { issueId: "i1", commentId: undefined, chatSessionId: undefined },
      expect.any(AbortSignal),
    );
  });

  it("keeps the text and marks the upload failed when the upload rejects", async () => {
    const uploadFile = vi.fn().mockRejectedValue(new Error("boom"));
    const r = await deliverBrowserPayload(P, issueCommentDraftTarget("i1"), {
      api: { uploadFile },
      createId: () => "u1",
    });
    expect(r).toEqual({ uploaded: 0, failed: 1 });
    const s = useCommentDraftStore.getState();
    expect(s.getDraft("new:i1")).toBe("## Grab\n<div>");
    expect(s.getUploads("new:i1")[0]).toMatchObject({
      clientUploadId: "u1",
      status: "failed",
      error: "boom",
    });
  });

  it("appends after existing draft text", async () => {
    useCommentDraftStore.getState().setDraft("new:i1", "hello");
    const uploadFile = vi.fn();
    await deliverBrowserPayload(NO_IMAGES, issueCommentDraftTarget("i1"), {
      api: { uploadFile },
    });
    expect(useCommentDraftStore.getState().getDraft("new:i1")).toBe("hello\n\n## Grab\n<div>");
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("registers the upload with the screenshot's own content type", async () => {
    // The package types screenshots as PNG today; the upload must still follow the payload.
    const jpeg = {
      ...P,
      images: [{ name: "shot.jpg", mimeType: "image/jpeg", dataBase64: btoa("abc") }],
    } as unknown as BrowserAgentPayload;
    const target = issueCommentDraftTarget("i1");
    const addUpload = vi.spyOn(target, "addUpload");
    await deliverBrowserPayload(jpeg, target, {
      api: { uploadFile: vi.fn().mockResolvedValue({ ...ATT, content_type: "image/jpeg" }) },
      createId: () => "u1",
    });
    expect(addUpload).toHaveBeenCalledWith(
      expect.objectContaining({ clientUploadId: "u1", contentType: "image/jpeg" }),
    );
  });

  it("writes into the new chat draft slot", async () => {
    await deliverBrowserPayload(NO_IMAGES, chatDraftTarget(DRAFT_NEW_SESSION), {
      api: { uploadFile: vi.fn() },
    });
    expect(useChatStore.getState().inputDrafts["__new__"]).toBe("## Grab\n<div>");
  });
});
