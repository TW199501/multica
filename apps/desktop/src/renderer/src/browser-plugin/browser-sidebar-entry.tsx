import { Globe } from "@multica/ui/icons";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@multica/ui/components/ui/sidebar";
import { useWorkspaceSlug } from "@multica/core/paths";
import { AppLink } from "@multica/views/navigation";
import { useActiveTabUrl } from "@/stores/tab-store";
import { browserPath, browserScopeForUrl } from "./browser-scope";
import { useBrowserT } from "./i18n";

export function BrowserSidebarEntry() {
  const slug = useWorkspaceSlug();
  const t = useBrowserT();
  const activeScope = browserScopeForUrl(useActiveTabUrl());
  if (!slug) return null;

  return (
    <SidebarMenu className="px-2">
      <SidebarMenuItem>
        <SidebarMenuButton
          size="sm"
          isActive={activeScope === slug}
          render={<AppLink href={browserPath(slug)} draggable={false} />}
          className="text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
        >
          <Globe />
          <span>{t("multica.browser.sidebar.label", "Browser")}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
