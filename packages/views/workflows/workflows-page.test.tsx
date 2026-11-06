// @vitest-environment jsdom

import { cleanup, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@multica/ui/components/ui/sidebar";
import { buildIssueStatusCatalog } from "@multica/core/issue-statuses";
import { projectListOptions } from "@multica/core/projects/queries";
import { memberListOptions } from "@multica/core/workspace/queries";
import type { IssueWorkflow } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { WorkflowsPage } from "./workflows-page";

const { workflows, params } = vi.hoisted(() => ({
  workflows: [] as IssueWorkflow[],
  params: { search: "" },
}));

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/auth", () => ({
  useAuthStore: (select: (s: { user: { id: string } }) => unknown) => select({ user: { id: "user-1" } }),
}));
vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({ projectDetail: (id: string) => `/acme/projects/${id}` }),
}));
vi.mock("@multica/core/issue-statuses/hooks", () => ({ useIssueStatuses: () => buildIssueStatusCatalog([]) }));
vi.mock("@multica/core/workspace/hooks", () => ({ useActorName: () => ({ getActorName: () => "Lambda" }) }));
vi.mock("@multica/core/issue-workflows", () => ({ useIssueWorkflows: () => ({ workflows, isLoaded: true }) }));
vi.mock("../navigation", () => ({
  AppLink: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useNavigation: () => ({
    searchParams: new URLSearchParams(params.search),
    pathname: "/acme/workflows",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));
vi.mock("../common/actor-avatar", () => ({
  ActorAvatar: ({ actorId }: { actorId: string }) => <span data-testid={`avatar-${actorId}`} />,
}));
vi.mock("../settings/components/issue-statuses-tab", () => ({ IssueStatusesTab: () => null }));
vi.mock("./workflow-editor-page", () => ({ WorkflowEditorPage: () => <div data-testid="workflow-editor" /> }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(projectListOptions("ws-1").queryKey, { projects: [] } as never);
  qc.setQueryData(memberListOptions("ws-1").queryKey, [{ user_id: "user-1", role: "owner" }] as never);
  return renderWithI18n(
    <QueryClientProvider client={qc}>
      <SidebarProvider>
        <WorkflowsPage />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  workflows.length = 0;
  params.search = "";
});

describe("WorkflowsPage", () => {
  it("gives the page a header with its title, the nav trigger and the New action", () => {
    renderPage();

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { level: 1, name: "Workflows" })).toBeTruthy();
    expect(header.querySelector("[data-slot='sidebar-trigger']")).not.toBeNull();
    expect(within(header).getByRole("button", { name: /New/ })).toBeTruthy();
    // The header carries the title; the body does not repeat it.
    expect(screen.getAllByRole("heading", { name: "Workflows" })).toHaveLength(1);
  });

  it("keeps the header and nav trigger while a workflow is open in the editor", () => {
    params.search = "workflow=wf-1";
    renderPage();

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { level: 1, name: "Workflows" })).toBeTruthy();
    expect(header.querySelector("[data-slot='sidebar-trigger']")).not.toBeNull();
    expect(screen.getByTestId("workflow-editor")).toBeTruthy();
  });
});
