import { useLayoutEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrowserPane } from "@elf-express/orca-browser/renderer";
import { cn } from "@multica/ui/lib/utils";
import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";
import { useWorkspaceSlug } from "@multica/core/paths";
import { workspaceListOptions } from "@multica/core/workspace";
import { useActiveTabUrl } from "@/stores/tab-store";
import { browserScopeForUrl } from "./browser-scope";
import { SendToAgentDialog } from "./send-to-agent-dialog";

type Box = Pick<CSSProperties, "left" | "top" | "width" | "height">;

/**
 * The box of `target` relative to `frame`, kept in sync as either resizes.
 * Null without a target, so the layer fills its container.
 */
function useBoxWithin(target: HTMLElement | null, frame: HTMLElement | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    if (!target || !frame) {
      setBox(null);
      return;
    }
    const measure = () => {
      const t = target.getBoundingClientRect();
      const f = frame.getBoundingClientRect();
      setBox({ left: t.left - f.left, top: t.top - f.top, width: t.width, height: t.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    observer.observe(frame);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [target, frame]);

  return box;
}

// Panes stay mounted after the first visit so pages keep their state; the package
// parks the webview itself when `active` is false. In the docked chat layout the
// panes cover only the page column, leaving the conversation visible.
export function BrowserLayer() {
  const activeScope = browserScopeForUrl(useActiveTabUrl());
  const { data: workspaces } = useQuery(workspaceListOptions());
  const slug = useWorkspaceSlug();
  const [visited, setVisited] = useState<string[]>([]);
  const pageElement = useDockedLayoutStore((s) => s.pageElement);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const box = useBoxWithin(pageElement, frame);

  if (activeScope && !visited.includes(activeScope)) {
    setVisited([...visited, activeScope]);
  }

  const known = workspaces ? new Set(workspaces.map((w) => w.slug)) : null;
  const scopes = visited.filter((scope) => !known || known.has(scope));

  if (scopes.length === 0) return null;

  return (
    <>
      {slug && <SendToAgentDialog />}
      <div
        ref={setFrame}
        data-browser-frame
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute inset-0" style={box ?? undefined}>
          {scopes.map((scope) => {
            const active = scope === activeScope;
            return (
              <div
                key={scope}
                className={cn("absolute inset-0", active ? "pointer-events-auto" : "invisible")}
                aria-hidden={!active}
              >
                <BrowserPane scopeId={scope} active={active} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
