import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { useT } from "@multica/views/i18n";
import { useTabPresentation } from "@multica/views/layout";
import { useTabStore, type Tab } from "@/stores/tab-store";

/** Asks to close the leftmost unpinned tab when a new one would pass TAB_LIMIT. */
export function TabLimitDialog() {
  const { t } = useT("settings");
  const { t: tCommon } = useT("common");
  const pending = useTabStore((s) => s.pendingTabOpen);
  const leftmost = useTabStore((s) => {
    const group = s.activeWorkspaceSlug
      ? s.byWorkspace[s.activeWorkspaceSlug]
      : undefined;
    return group?.tabs.find((tab) => !tab.pinned) ?? null;
  });
  const confirm = useTabStore((s) => s.confirmPendingTabOpen);
  const cancel = useTabStore((s) => s.cancelPendingTabOpen);

  return (
    <Dialog
      open={pending !== null && leftmost !== null}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t(($) => $.desktop.tab_bar.limit_title)}</DialogTitle>
          {leftmost && <LimitBody tab={leftmost} />}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            {tCommon(($) => $.cancel)}
          </Button>
          <Button onClick={() => confirm()}>
            {t(($) => $.desktop.tab_bar.limit_confirm)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LimitBody({ tab }: { tab: Tab }) {
  const { t } = useT("settings");
  // Same live title the tab strip shows; a background tab's stored title can
  // still be the empty seed.
  const { title } = useTabPresentation(tab.url, tab.title);
  return (
    <DialogDescription>
      {t(($) => $.desktop.tab_bar.limit_body, { title })}
    </DialogDescription>
  );
}
