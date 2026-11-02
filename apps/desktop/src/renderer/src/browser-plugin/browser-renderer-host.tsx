import { useMemo } from "react";
import { BrowserPluginProvider, type BrowserRendererHost } from "@elf-express/orca-browser/renderer";
import { useBrowserT } from "./i18n";
import { useBrowserSendStore } from "./send-to-agent-store";

// The package allows a single provider for the whole app.
export function DesktopBrowserPluginProvider({ children }: { children: React.ReactNode }) {
  const t = useBrowserT();
  const host = useMemo<BrowserRendererHost>(
    () => ({ t, onSendToAgent: (payload) => useBrowserSendStore.getState().open(payload) }),
    [t],
  );
  return <BrowserPluginProvider host={host}>{children}</BrowserPluginProvider>;
}
