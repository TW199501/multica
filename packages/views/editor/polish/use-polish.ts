"use client";

import { useQuery } from "@tanstack/react-query";
import { workspaceAISettingsStatusOptions } from "@multica/core/workspace/queries";

/** Whether this workspace can polish messages; false until the status loads. */
export function usePolishAvailable(wsId: string): boolean {
  const { data } = useQuery(workspaceAISettingsStatusOptions(wsId));
  return data?.polish_available === true;
}
