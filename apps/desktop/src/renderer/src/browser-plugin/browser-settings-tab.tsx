import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrowserSettingsPanel } from "@elf-express/orca-browser/renderer";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspaceSlug } from "@multica/core/paths";
import { runtimeDisplayLabel, runtimeListOptions } from "@multica/core/runtimes";
import { agentListOptions } from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { Copy, RotateCw } from "@multica/ui/icons";
import { useLocalDaemonStatus } from "@multica/views/platform";
import { SettingsCard, SettingsRow, SettingsSection, SettingsTab } from "@multica/views/settings";
import { useBrowserT } from "./i18n";
import { selectLocalBrowserAgents } from "./local-agents";
import {
  browserMcpEndpointKey,
  browserMcpStatusKey,
  rewriteEnabledAgents,
  useOrcaBrowserAgentSync,
} from "./use-orca-browser-agent-sync";

export function BrowserSettingsTab() {
  const t = useBrowserT();
  const wsId = useWorkspaceId();
  const slug = useWorkspaceSlug();
  const { daemonId } = useLocalDaemonStatus();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);

  const { data: status } = useQuery({
    queryKey: browserMcpStatusKey,
    queryFn: async () => (await window.browserAPI?.mcp.getStatus()) ?? null,
    refetchInterval: (q) => (q.state.data?.state === "starting" ? 1000 : false),
  });
  const listening = status?.state === "listening";
  const { data: endpoint, refetch: refetchEndpoint } = useQuery({
    queryKey: browserMcpEndpointKey,
    queryFn: async () => (await window.browserAPI?.mcp.getEndpoint()) ?? null,
    enabled: listening,
  });

  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const rows = selectLocalBrowserAgents(agents, runtimes, daemonId);
  const sync = useOrcaBrowserAgentSync(wsId);

  const toggle = (agentId: string, checked: boolean) => {
    if (checked && !endpoint) return;
    sync.mutate(
      { agentId, endpoint: checked ? endpoint! : null },
      {
        onError: () => {
          const name = rows.find((r) => r.agent.id === agentId)?.agent.name ?? agentId;
          toast.error(t("multica.browser.settings.update_failed_toast", "Couldn't update {{name}}", { name }));
        },
      },
    );
  };

  const rotate = async () => {
    setConfirmRotate(false);
    setRotating(true);
    try {
      await window.browserAPI?.mcp.rotateToken();
      const next = (await refetchEndpoint()).data;
      if (!next) return;
      const enabledIds = rows.filter((r) => r.enabled && r.editable).map((r) => r.agent.id);
      const { failed } = await rewriteEnabledAgents(enabledIds, next, sync.mutateAsync);
      for (const id of failed) {
        const name = rows.find((r) => r.agent.id === id)?.agent.name ?? id;
        toast.error(t("multica.browser.settings.update_failed_toast", "Couldn't update {{name}}", { name }));
      }
    } finally {
      setRotating(false);
    }
  };

  let statusMessage: string | null = null;
  if (status?.state === "starting") {
    statusMessage = t("multica.browser.settings.status_starting", "MCP server is starting");
  } else if (status?.state === "port_in_use") {
    statusMessage = t(
      "multica.browser.settings.status_port_in_use",
      "Port {{port}} is already in use. Close the program using it, then restart Multica.",
      { port: status.port },
    );
  } else if (status?.state === "error") {
    statusMessage = t(
      "multica.browser.settings.status_error",
      "MCP server failed to start: {{message}}",
      { message: status.message ?? "" },
    );
  }

  const controlsLocked = !listening || !endpoint || sync.isPending || rotating;

  return (
    <SettingsTab title={t("multica.browser.settings.tab", "Browser")}>
      <SettingsSection title={t("multica.browser.settings.mcp_title", "MCP server")}>
        <SettingsCard>
          {statusMessage ? (
            <p className="px-4 py-3 text-body text-muted-foreground">{statusMessage}</p>
          ) : (
            <SettingsRow label={t("multica.browser.settings.endpoint", "Endpoint")}>
              <span className="font-mono text-caption text-muted-foreground">
                {endpoint?.url ?? ""}
              </span>
            </SettingsRow>
          )}
          <div className="flex items-center gap-2 px-4 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!listening || !endpoint}
              onClick={() => {
                if (endpoint) void navigator.clipboard.writeText(endpoint.token);
              }}
            >
              <Copy />
              {t("multica.browser.settings.copy_token", "Copy token")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={controlsLocked}
              onClick={() => setConfirmRotate(true)}
            >
              <RotateCw />
              {t("multica.browser.settings.rotate", "Rotate token")}
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t("multica.browser.settings.agents_title", "Agents on this machine")}
        description={t("multica.browser.settings.verified", "Verified: Claude Code")}
      >
        {!daemonId ? (
          <p className="text-body text-muted-foreground">
            {t(
              "multica.browser.settings.daemon_offline",
              "Start the local daemon to see agents on this machine",
            )}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-body text-muted-foreground">
            {t("multica.browser.settings.no_local_agents", "No agents on this machine support MCP")}
          </p>
        ) : (
          <SettingsCard>
            {rows.map(({ agent, runtime, enabled, editable }) => (
              <div key={agent.id} className="flex items-center gap-3 px-4 py-3">
                <Checkbox
                  aria-label={agent.name}
                  checked={enabled}
                  disabled={controlsLocked || !editable}
                  onCheckedChange={(checked) => toggle(agent.id, checked === true)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">{agent.name}</p>
                  <p className="truncate text-caption text-muted-foreground">
                    {runtimeDisplayLabel(runtime)}
                  </p>
                  {!editable ? (
                    <p className="text-caption text-muted-foreground">
                      {t(
                        "multica.browser.settings.owner_only",
                        "Only the agent owner or a workspace admin can change this",
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      <SettingsSection title={t("multica.browser.settings.profiles_title", "Profiles & cookies")}>
        <BrowserSettingsPanel scopeId={slug ?? undefined} />
      </SettingsSection>

      <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("multica.browser.settings.rotate", "Rotate token")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "multica.browser.settings.rotate_confirm",
                "Agents configured outside this page will lose access until you update them.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("auto.components.browser-pane.markup.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void rotate()}>
              {t("multica.browser.settings.rotate", "Rotate token")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsTab>
  );
}
