"use client";

import { Sparkles } from "@multica/ui/icons";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { useCurrentMember } from "@multica/core/permissions";
import { CollectionPageHeaderAction } from "../../layout/collection-page";
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
    <CollectionPageHeaderAction
      icon={Sparkles}
      label={t(($) => $.ai_settings.entry)}
      onClick={() => navigation.push(paths.agentAISettings())}
    />
  );
}
