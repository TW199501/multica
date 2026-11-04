"use client";

import { WorkflowsTab } from "./workflows-tab";

/** Workflows as a workspace page of its own, outside Settings. */
export function WorkflowsPage() {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 md:px-10 md:py-8">
        <WorkflowsTab />
      </div>
    </div>
  );
}
