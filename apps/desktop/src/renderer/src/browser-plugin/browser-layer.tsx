import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrowserPane } from "@elf-express/orca-browser/renderer";
import { cn } from "@multica/ui/lib/utils";
import { workspaceListOptions } from "@multica/core/workspace";
import { useActiveTabUrl } from "@/stores/tab-store";
import { browserScopeForUrl } from "./browser-scope";

// Panes stay mounted after the first visit so pages keep their state; the package
// parks the webview itself when `active` is false.
export function BrowserLayer() {
  const activeScope = browserScopeForUrl(useActiveTabUrl());
  const { data: workspaces } = useQuery(workspaceListOptions());
  const [visited, setVisited] = useState<string[]>([]);

  if (activeScope && !visited.includes(activeScope)) {
    setVisited([...visited, activeScope]);
  }

  const known = workspaces ? new Set(workspaces.map((w) => w.slug)) : null;
  const scopes = visited.filter((scope) => !known || known.has(scope));

  if (scopes.length === 0) return null;

  return (
    <>
      {scopes.map((scope) => {
        const active = scope === activeScope;
        return (
          <div
            key={scope}
            className={cn("absolute inset-0", !active && "invisible pointer-events-none")}
            aria-hidden={!active}
          >
            <BrowserPane scopeId={scope} active={active} />
          </div>
        );
      })}
    </>
  );
}
