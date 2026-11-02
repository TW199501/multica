import { useEffect, useMemo } from "react";
import { BrowserPluginProvider, type BrowserRendererHost } from "@elf-express/orca-browser/renderer";
import { useWorkspaceSlug } from "@multica/core/paths";
import { useBrowserT } from "./i18n";
import { useBrowserSendStore } from "./send-to-agent-store";

// The package allows a single provider for the whole app.
export function DesktopBrowserPluginProvider({ children }: { children: React.ReactNode }) {
  const t = useBrowserT();
  const slug = useWorkspaceSlug();
  const host = useMemo<BrowserRendererHost>(
    () => ({ t, onSendToAgent: (payload) => useBrowserSendStore.getState().open(payload) }),
    [t],
  );
  // The send menu targets the active workspace, so a capture still waiting for a
  // target is dropped when the workspace changes rather than carried across.
  useEffect(() => () => useBrowserSendStore.getState().cancel(), [slug]);
  return <BrowserPluginProvider host={host}>{children}</BrowserPluginProvider>;
}
