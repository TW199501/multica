import type { BrowserAgentPayload } from "@elf-express/orca-browser/shared";
import type { ApiClient } from "@multica/core/api";
import { DRAFT_NEW_SESSION, useChatStore } from "@multica/core/chat";
import {
  startUpload,
  type DraftUpload,
  type UploadCoordinatorContext,
  type UploadOutcome,
} from "@multica/core/drafts";
import { toUploadResult } from "@multica/core/hooks/use-file-upload";
import { useCommentDraftStore } from "@multica/core/issues/stores";
import type { Attachment } from "@multica/core/types";
import { createSafeId } from "@multica/core/utils";

export function payloadImageToFile(image: BrowserAgentPayload["images"][number]): File {
  const bytes = Uint8Array.from(atob(image.dataBase64), (c) => c.charCodeAt(0));
  return new File([bytes], image.name, { type: image.mimeType });
}

// Slim copy of packages/views attachmentMarkdown (not exported); screenshots are always images.
export function browserAttachmentMarkdown(attachment: Attachment): string {
  return `![${attachment.filename}](${toUploadResult(attachment).markdownLink})`;
}

export interface DraftTarget {
  uploadCtx: UploadCoordinatorContext;
  addUpload(u: DraftUpload): void;
  settleUpload(id: string, a: Attachment): void;
  failUpload(id: string, error?: string): void;
  tracks(id: string): boolean;
  appendToBody(markdown: string): void;
}

export function issueCommentDraftTarget(issueId: string): DraftTarget {
  const key = `new:${issueId}` as const;
  const store = () => useCommentDraftStore.getState();
  return {
    uploadCtx: { issueId },
    addUpload: (u) => store().addUpload(key, u),
    settleUpload: (id, a) => store().settleUpload(key, id, a),
    failUpload: (id, error) => store().failUpload(key, id, error),
    tracks: (id) => store().getUploads(key).some((u) => u.clientUploadId === id),
    appendToBody: (markdown) => store().appendToDraftContent(key, markdown),
  };
}

export function chatDraftTarget(sessionId: string): DraftTarget {
  const store = () => useChatStore.getState();
  return {
    uploadCtx: sessionId === DRAFT_NEW_SESSION ? {} : { chatSessionId: sessionId },
    addUpload: (u) => store().addInputDraftUpload(sessionId, u),
    settleUpload: (id, a) => store().settleInputDraftUpload(sessionId, id, a),
    failUpload: (id, error) => store().failInputDraftUpload(sessionId, id, error),
    tracks: (id) =>
      (store().inputDraftAttachments[sessionId] ?? []).some((u) => u.clientUploadId === id),
    appendToBody: (markdown) => store().appendToInputDraft(sessionId, markdown),
  };
}

export async function deliverBrowserPayload(
  payload: BrowserAgentPayload,
  target: DraftTarget,
  deps: { api: Pick<ApiClient, "uploadFile">; createId?: () => string },
): Promise<{ uploaded: number; failed: number }> {
  const createId = deps.createId ?? createSafeId;

  const outcomes = await Promise.all(
    payload.images.map((image) => {
      const file = payloadImageToFile(image);
      const clientUploadId = createId();
      target.addUpload({
        clientUploadId,
        filename: file.name,
        size: file.size,
        contentType: "image/png",
        status: "uploading",
      });
      return new Promise<UploadOutcome>((resolve) => {
        startUpload({
          clientUploadId,
          file,
          api: deps.api,
          ctx: target.uploadCtx,
          onSettled: resolve,
        });
      });
    }),
  );

  const markdowns: string[] = [];
  let uploaded = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    // The draft may have been cleared or submitted while the upload was in flight.
    if (!target.tracks(outcome.clientUploadId)) continue;
    if (outcome.status === "uploaded") {
      target.settleUpload(outcome.clientUploadId, outcome.attachment);
      markdowns.push(browserAttachmentMarkdown(outcome.attachment));
      uploaded += 1;
    } else {
      target.failUpload(outcome.clientUploadId, outcome.error.message);
      failed += 1;
    }
  }

  const body = [payload.text, ...markdowns].filter((s) => s.trim()).join("\n\n");
  if (body) target.appendToBody(body);
  return { uploaded, failed };
}
