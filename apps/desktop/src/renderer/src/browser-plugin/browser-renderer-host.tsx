import { useMemo } from "react";
import { BrowserPluginProvider } from "@elf-express/orca-browser/renderer";
import { useBrowserT } from "./i18n";

// The package allows a single provider for the whole app.
export function DesktopBrowserPluginProvider({ children }: { children: React.ReactNode }) {
  const t = useBrowserT();
  const host = useMemo(() => ({ t }), [t]);
  return <BrowserPluginProvider host={host}>{children}</BrowserPluginProvider>;
}
