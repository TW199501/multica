import { Globe } from "@multica/ui/icons";
import { TooltipHint } from "@multica/ui/components/common/tooltip-hint";
import { useWorkspaceSlug } from "@multica/core/paths";
import { RAIL_ICON_BUTTON_CLASS } from "@multica/views/layout";
import { AppLink } from "@multica/views/navigation";
import { useActiveTabUrl } from "@/stores/tab-store";
import { browserPath, browserScopeForUrl } from "./browser-scope";
import { useBrowserT } from "./i18n";

// Rendered in the app rail under the spaces.
export function BrowserSidebarEntry() {
  const slug = useWorkspaceSlug();
  const t = useBrowserT();
  const activeScope = browserScopeForUrl(useActiveTabUrl());
  if (!slug) return null;
  const label = t("multica.browser.sidebar.label", "Browser");

  return (
    <TooltipHint label={label} side="right">
      <AppLink
        href={browserPath(slug)}
        draggable={false}
        aria-label={label}
        aria-current={activeScope === slug ? "page" : undefined}
        className={RAIL_ICON_BUTTON_CLASS}
      >
        <Globe />
      </AppLink>
    </TooltipHint>
  );
}
