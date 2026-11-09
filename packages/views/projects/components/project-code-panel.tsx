"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@multica/core/api";
import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";
import { useWorkspaceId } from "@multica/core/hooks";
import { projectCodeFileOptions, useSaveProjectCodeFile } from "@multica/core/projects";
import { IconButton } from "@multica/ui/components/common/icon-button";
import { Button } from "@multica/ui/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@multica/ui/components/ui/tabs";
import { Pencil, X } from "@multica/ui/icons";
import { CodeBlockStatic } from "../../editor/code-block-static";
import { extensionToLanguage } from "../../editor/utils/preview";
import { useT } from "../../i18n";
import { FileViewer } from "../../skills/components/file-viewer";

function PanelMessage({ children }: { children: string }) {
  return <p className="px-4 py-4 text-caption text-muted-foreground">{children}</p>;
}

/** One file: read-only until the pen is pressed, then saved to the branch. */
function ProjectCodeFileView({
  projectId,
  resourceId,
  path,
  onClose,
}: {
  projectId: string;
  resourceId: string;
  path: string;
  onClose?: () => void;
}) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const file = useQuery(projectCodeFileOptions(wsId, projectId, resourceId, path));
  const save = useSaveProjectCodeFile(wsId, projectId, resourceId);
  const storedDraft = useDockedLayoutStore((s) => s.codeDraft);
  const setDraft = useDockedLayoutStore((s) => s.setCodeDraft);
  const draft = storedDraft?.projectId === projectId && storedDraft.path === path ? storedDraft : null;
  const data = file.data;
  const editable = !!data && !data.binary && !data.too_large && !!data.sha;

  const handleSave = () => {
    if (!data || !draft) return;
    save.mutate(
      { path, sha: data.sha, content: draft.content },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success(t(($) => $.code.saved));
        },
        onError: (error) => {
          const status = error instanceof ApiError ? error.status : 0;
          toast.error(
            status === 409
              ? t(($) => $.code.save_conflict)
              : status === 403
                ? t(($) => $.code.save_denied)
                : t(($) => $.code.save_failed),
          );
        },
      },
    );
  };

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-caption text-muted-foreground" title={path}>
          {path}
        </span>
        {draft ? (
          <>
            <Button variant="outline" size="xs" disabled={save.isPending} onClick={() => setDraft(null)}>
              {t(($) => $.code.cancel)}
            </Button>
            <Button
              size="xs"
              disabled={save.isPending || draft.content === data?.content}
              aria-busy={save.isPending}
              onClick={handleSave}
            >
              {t(($) => $.code.save)}
            </Button>
          </>
        ) : (
          <>
            <IconButton
              label={t(($) => $.code.edit)}
              tooltipSide="bottom"
              className="text-muted-foreground"
              disabled={!editable}
              onClick={() => data && setDraft({ projectId, path, content: data.content })}
            >
              <Pencil />
            </IconButton>
            {onClose ? (
              <IconButton
                label={t(($) => $.code.close)}
                tooltipSide="bottom"
                className="text-muted-foreground"
                onClick={onClose}
              >
                <X />
              </IconButton>
            ) : null}
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {file.isError ? (
          <PanelMessage>{t(($) => $.code.file_load_failed)}</PanelMessage>
        ) : !data ? null : data.too_large ? (
          <PanelMessage>{t(($) => $.code.too_large)}</PanelMessage>
        ) : data.binary ? (
          <PanelMessage>{t(($) => $.code.binary)}</PanelMessage>
        ) : draft ? (
          <FileViewer
            path={path}
            content={draft.content}
            mode="raw"
            readOnly={save.isPending}
            onChange={(content) => setDraft({ projectId, path, content })}
          />
        ) : (
          <CodeBlockStatic language={extensionToLanguage(path)} body={data.content} lineNumbers className="min-h-full" />
        )}
      </div>
    </>
  );
}

/**
 * Right column of an open project while the project tree tab is open. Choosing
 * a file in the tree switches it to the code tab.
 */
export function ProjectDockedAside({ projectId, properties }: { projectId: string; properties: ReactNode }) {
  const { t } = useT("projects");
  const [tab, setTab] = useState<"properties" | "code">("properties");
  const selection = useDockedLayoutStore((s) => s.codeSelection);
  const selected = selection?.projectId === projectId ? selection : null;

  useEffect(() => {
    if (selected) setTab("code");
  }, [selected]);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as "properties" | "code")}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="flex h-12 shrink-0 items-center border-b px-3">
        <TabsList>
          <TabsTrigger value="properties">{t(($) => $.detail.section_properties)}</TabsTrigger>
          <TabsTrigger value="code">{t(($) => $.code.tab)}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent
        keepMounted
        value="properties"
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] px-4 py-4 data-hidden:hidden"
      >
        {properties}
      </TabsContent>
      <TabsContent keepMounted value="code" className="flex min-h-0 flex-1 flex-col data-hidden:hidden">
        {selected ? (
          <ProjectCodeFileView
            key={`${selected.resourceId}:${selected.path}`}
            projectId={projectId}
            resourceId={selected.resourceId}
            path={selected.path}
          />
        ) : (
          <PanelMessage>{t(($) => $.code.select_file)}</PanelMessage>
        )}
      </TabsContent>
    </Tabs>
  );
}

/**
 * Right column of an open issue while the project tree tab is open: its
 * properties, replaced by the file chosen in the tree until that file is closed.
 */
export function IssueDockedAside({
  projectId,
  properties,
}: {
  projectId: string | null | undefined;
  properties: ReactNode;
}) {
  const selection = useDockedLayoutStore((s) => s.codeSelection);
  const setSelection = useDockedLayoutStore((s) => s.setCodeSelection);
  const selected = projectId && selection?.projectId === projectId ? selection : null;

  return (
    <>
      {/* Stays mounted: closing a file must not reset the properties' open sections. */}
      <div
        hidden={!!selected}
        className="h-full min-h-0 overflow-y-auto [scrollbar-gutter:stable] px-2 py-4"
      >
        {properties}
      </div>
      {selected ? (
        <div className="flex h-full min-h-0 flex-col">
          <ProjectCodeFileView
            key={`${selected.resourceId}:${selected.path}`}
            projectId={selected.projectId}
            resourceId={selected.resourceId}
            path={selected.path}
            onClose={() => setSelection(null)}
          />
        </div>
      ) : null}
    </>
  );
}
