"use client";

import { useQuery } from "@tanstack/react-query";
import { workspaceAISettingsStatusOptions } from "@multica/core/workspace/queries";

/** Whether this workspace can polish messages; false until the status loads. */
export function usePolishAvailable(wsId: string): boolean {
  return usePolishStatus(wsId).available;
}

/** The polish status, telling "not known yet" apart from "not available". */
export function usePolishStatus(wsId: string): { available: boolean; pending: boolean } {
  const { data, isPending } = useQuery(workspaceAISettingsStatusOptions(wsId));
  return { available: data?.polish_available === true, pending: isPending && wsId !== "" };
}
