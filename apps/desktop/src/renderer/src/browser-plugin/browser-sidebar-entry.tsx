import { Globe } from "@multica/ui/icons";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@multica/ui/components/ui/sidebar";
import { useWorkspaceSlug } from "@multica/core/paths";
import { NAV_ITEM_CLASS_NAME } from "@multica/views/layout";
import { AppLink } from "@multica/views/navigation";
import { useActiveTabUrl } from "@/stores/tab-store";
import { browserPath, browserScopeForUrl } from "./browser-scope";
import { useBrowserT } from "./i18n";

// Rendered inside AppSidebar's personal nav menu, so it is a bare menu item.
export function BrowserSidebarEntry() {
  const slug = useWorkspaceSlug();
  const t = useBrowserT();
  const activeScope = browserScopeForUrl(useActiveTabUrl());
  if (!slug) return null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={activeScope === slug}
        render={<AppLink href={browserPath(slug)} draggable={false} />}
        className={NAV_ITEM_CLASS_NAME}
      >
        <Globe />
        <span>{t("multica.browser.sidebar.label", "Browser")}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
