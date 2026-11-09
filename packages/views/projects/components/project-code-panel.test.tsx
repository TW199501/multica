// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";
import { renderWithI18n } from "../../test/i18n";
import en from "../../locales/en/projects.json";

const api = vi.hoisted(() => ({
  listProjectResources: vi.fn(),
  getProjectCodeTree: vi.fn(),
  getProjectCodeFile: vi.fn(),
  saveProjectCodeFile: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@multica/core/api")>()),
  api,
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError } }));

const { IssueDockedAside, ProjectDockedAside } = await import("./project-code-panel");
const { ProjectCodeExplorer } = await import("./project-code-explorer");

const GITHUB = {
  id: "res-1",
  project_id: "p1",
  workspace_id: "ws-1",
  resource_type: "github_repo",
  resource_ref: { url: "https://github.com/acme/widget", ref: "dev" },
  label: null,
  position: 0,
  created_at: "",
  created_by: null,
};
const FILE = { path: "a.go", ref: "dev", sha: "blob-1", content: "package a", binary: false, too_large: false };

function renderBoth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={client}>
      <ProjectCodeExplorer projectId="p1" />
      <ProjectDockedAside projectId="p1" properties={<div>project properties</div>} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useDockedLayoutStore.setState({ codeSelection: null, codeDraft: null });
  api.listProjectResources.mockResolvedValue({ resources: [GITHUB], total: 1 });
  api.getProjectCodeTree.mockResolvedValue({ ref: "dev", truncated: false, files: ["a.go", "b.go"] });
  api.getProjectCodeFile.mockResolvedValue(FILE);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function openFile(name: string) {
  fireEvent.click(await screen.findByRole("tab", { name }));
}

describe("project code browser", () => {
  it("shows the branch and starts on the properties tab", async () => {
    renderBoth();
    expect(await screen.findByText("dev")).toBeTruthy();
    expect(screen.getByRole("tab", { name: en.detail.section_properties }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("project properties")).toBeTruthy();
  });

  it("says so when the project has no GitHub repository", async () => {
    api.listProjectResources.mockResolvedValue({
      resources: [{ ...GITHUB, resource_type: "local_directory" }],
      total: 1,
    });
    renderBoth();
    expect(await screen.findByText(en.code.no_repository)).toBeTruthy();
    expect(api.getProjectCodeTree).not.toHaveBeenCalled();
  });

  it("explains a repository it cannot read", async () => {
    api.getProjectCodeTree.mockRejectedValue(new Error("502"));
    renderBoth();
    expect(await screen.findByText(en.code.load_failed)).toBeTruthy();
  });

  it("switches to the code tab, read-only, when a file is chosen", async () => {
    renderBoth();
    await openFile("a.go");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: en.code.tab }).getAttribute("aria-selected")).toBe("true"),
    );
    expect(api.getProjectCodeFile).toHaveBeenCalledWith("p1", "res-1", "a.go");
    await screen.findByRole("button", { name: en.code.edit });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("edits only after the pen and saves to the branch from the loaded blob", async () => {
    api.saveProjectCodeFile.mockResolvedValue({ ...FILE, sha: "blob-2", content: "package b" });
    renderBoth();
    await openFile("a.go");
    await waitFor(() => expect(screen.getByRole("button", { name: en.code.edit }).hasAttribute("disabled")).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: en.code.edit }));
    const editor = await screen.findByRole("textbox");
    expect((screen.getByRole("button", { name: en.code.save }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(editor, { target: { value: "package b" } });
    fireEvent.click(screen.getByRole("button", { name: en.code.save }));

    await waitFor(() =>
      expect(api.saveProjectCodeFile).toHaveBeenCalledWith("p1", "res-1", {
        path: "a.go",
        sha: "blob-1",
        content: "package b",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("keeps the edit open and explains a refused save", async () => {
    const { ApiError } = await import("@multica/core/api");
    api.saveProjectCodeFile.mockRejectedValue(new ApiError("conflict", 409, "Conflict"));
    renderBoth();
    await openFile("a.go");
    await waitFor(() => expect(screen.getByRole("button", { name: en.code.edit }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: en.code.edit }));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "package b" } });
    fireEvent.click(screen.getByRole("button", { name: en.code.save }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(en.code.save_conflict));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("package b");
  });

  it("will not open another file over an edit in progress", async () => {
    renderBoth();
    await openFile("a.go");
    await waitFor(() => expect(screen.getByRole("button", { name: en.code.edit }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: en.code.edit }));

    await openFile("b.go");
    expect(toastError).toHaveBeenCalledWith(en.code.finish_editing);
    expect(useDockedLayoutStore.getState().codeSelection?.path).toBe("a.go");
  });

  it("offers no pen for a binary file", async () => {
    api.getProjectCodeFile.mockResolvedValue({ ...FILE, content: "", binary: true });
    renderBoth();
    await openFile("a.go");
    expect(await screen.findByText(en.code.binary)).toBeTruthy();
    expect(screen.getByRole("button", { name: en.code.edit }).hasAttribute("disabled")).toBe(true);
  });

  it("ignores a selection from another project", async () => {
    renderBoth();
    await screen.findByText("dev");
    act(() => {
      useDockedLayoutStore.getState().setCodeSelection({ projectId: "p2", resourceId: "res-9", path: "z.go" });
    });
    expect(screen.getByRole("tab", { name: en.detail.section_properties }).getAttribute("aria-selected")).toBe("true");
    expect(api.getProjectCodeFile).not.toHaveBeenCalled();
  });
});

describe("issue docked aside", () => {
  function renderAside(projectId: string | null = "p1") {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderWithI18n(
      <QueryClientProvider client={client}>
        <IssueDockedAside projectId={projectId} properties={<div>issue properties</div>} />
      </QueryClientProvider>,
    );
  }
  const select = (projectId: string) =>
    act(() => useDockedLayoutStore.getState().setCodeSelection({ projectId, resourceId: "res-1", path: "a.go" }));

  it("shows the properties with no tabs until a file is chosen", () => {
    renderAside();

    expect(screen.getByText("issue properties")).toBeVisible();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("replaces the properties with the file and returns when it is closed", async () => {
    renderAside();
    select("p1");

    expect(await screen.findByText("a.go")).toBeInTheDocument();
    expect(screen.getByText("issue properties")).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: en.code.close }));

    expect(screen.getByText("issue properties")).toBeVisible();
    expect(useDockedLayoutStore.getState().codeSelection).toBeNull();
  });

  it("hides the close button while a file is being edited", async () => {
    renderAside();
    select("p1");
    await waitFor(() => expect(screen.getByRole("button", { name: en.code.edit })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: en.code.edit }));

    await screen.findByRole("button", { name: en.code.save });
    expect(screen.queryByRole("button", { name: en.code.close })).not.toBeInTheDocument();
  });

  it("ignores a file from another project, and any file on an issue with no project", () => {
    const { unmount } = renderAside();
    select("p2");
    expect(screen.getByText("issue properties")).toBeVisible();
    unmount();

    renderAside(null);
    expect(screen.getByText("issue properties")).toBeVisible();
  });
});
