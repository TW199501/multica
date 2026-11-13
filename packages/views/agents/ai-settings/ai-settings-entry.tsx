"use client";

import { IconButton } from "@multica/ui/components/common/icon-button";
import { Sparkles } from "@multica/ui/icons";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { useCurrentMember } from "@multica/core/permissions";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";

/** Agents-list header button; only owners and admins can manage AI settings. */
export function AISettingsEntryButton() {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const { role } = useCurrentMember(wsId);
  if (role !== "owner" && role !== "admin") return null;
  return (
    <IconButton
      tooltipSide="bottom"
      label={t(($) => $.ai_settings.entry)}
      className="shrink-0 text-muted-foreground"
      onClick={() => navigation.push(paths.agentAISettings())}
    >
      <Sparkles />
    </IconButton>
  );
}
