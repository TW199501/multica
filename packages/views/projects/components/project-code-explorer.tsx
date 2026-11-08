"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";
import { useWorkspaceId } from "@multica/core/hooks";
import { projectCodeTreeOptions, projectResourcesOptions } from "@multica/core/projects";
import { GitBranch } from "@multica/ui/icons";
import { useT } from "../../i18n";
import { FileTree } from "../../skills/components/file-tree";

function ExplorerMessage({ children }: { children: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 text-caption text-muted-foreground">{children}</div>
  );
}

/** Files on the branch of the open project's first GitHub repository. */
export function ProjectCodeExplorer({ projectId }: { projectId: string }) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const resources = useQuery(projectResourcesOptions(wsId, projectId));
  const repo = resources.data?.find((resource) => resource.resource_type === "github_repo");
  const tree = useQuery({
    ...projectCodeTreeOptions(wsId, projectId, repo?.id ?? ""),
    enabled: !!repo,
  });
  const selection = useDockedLayoutStore((s) => s.codeSelection);
  const setSelection = useDockedLayoutStore((s) => s.setCodeSelection);
  const selectedPath = selection?.projectId === projectId ? selection.path : "";

  if (resources.isPending) return null;
  if (!repo) return <ExplorerMessage>{t(($) => $.code.no_repository)}</ExplorerMessage>;
  if (tree.isError) return <ExplorerMessage>{t(($) => $.code.load_failed)}</ExplorerMessage>;
  if (!tree.data) return null;

  const handleSelect = (path: string) => {
    const draft = useDockedLayoutStore.getState().codeDraft;
    if (draft && (draft.projectId !== projectId || draft.path !== path)) {
      toast.error(t(($) => $.code.finish_editing));
      return;
    }
    setSelection({ projectId, resourceId: repo.id, path });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="flex items-center gap-1.5 px-4 pb-1 text-caption text-muted-foreground">
        <GitBranch className="size-3 shrink-0" />
        <span className="truncate">{tree.data.ref || t(($) => $.code.default_branch)}</span>
      </p>
      {tree.data.truncated && (
        <p className="px-4 pb-1 text-caption text-muted-foreground">{t(($) => $.code.truncated)}</p>
      )}
      <div role="tablist" aria-orientation="vertical" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <FileTree
          filePaths={tree.data.files}
          selectedPath={selectedPath}
          onSelect={handleSelect}
          defaultExpanded={false}
        />
      </div>
    </div>
  );
}
