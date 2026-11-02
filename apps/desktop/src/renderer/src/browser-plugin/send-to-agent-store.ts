import { create } from "zustand";
import type { BrowserAgentPayload } from "@elf-express/orca-browser/shared";

export type PendingBrowserSend = {
  payload: BrowserAgentPayload;
  resolve(): void;
  reject(error: Error): void;
};

interface BrowserSendState {
  pending: PendingBrowserSend | null;
  open(payload: BrowserAgentPayload): Promise<void>;
  take(): PendingBrowserSend | null;
  cancel(): void;
}

const canceled = () => new DOMException("Send canceled", "AbortError");

// Transient menu state only; deliberately not persisted.
export const useBrowserSendStore = create<BrowserSendState>()((set, get) => ({
  pending: null,
  open: (payload) => {
    get().pending?.reject(canceled());
    return new Promise<void>((resolve, reject) => {
      set({ pending: { payload, resolve, reject } });
    });
  },
  take: () => {
    const { pending } = get();
    set({ pending: null });
    return pending;
  },
  cancel: () => {
    const { pending } = get();
    set({ pending: null });
    pending?.reject(canceled());
  },
}));
