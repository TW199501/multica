// @vitest-environment jsdom

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithI18n } from "../../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";

const mocks = vi.hoisted(() => ({
  role: "owner" as "owner" | "admin" | "member",
  settings: null as Record<string, unknown> | null,
  api: {
    getAISettings: vi.fn(),
    updateAISettings: vi.fn(),
    testAISettings: vi.fn(),
    getAISettingsStatus: vi.fn(),
    listSkills: vi.fn(),
  },
}));

vi.mock("@multica/core/api", async () => {
  const actual = await vi.importActual<typeof import("@multica/core/api")>(
    "@multica/core/api",
  );
  return { ...actual, api: mocks.api };
});

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    agentAISettings: () => "/acme/agents/ai-settings",
  }),
}));

vi.mock("@multica/core/permissions", () => ({
  useCurrentMember: () => ({ role: mocks.role, isLoading: false }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AISettingsPage } from "./ai-settings-page";
import { AISettingsEntryButton } from "./ai-settings-entry";
import { ApiError } from "@multica/core/api";

function settings(over: Record<string, unknown> = {}) {
  return {
    secret_key_available: true,
    configured: true,
    provider: "openai",
    base_url: "https://api.openai.com/v1",
    model: "gpt-6.1-terra",
    disable_thinking: false,
    prompt: "",
    default_prompt: "DEFAULT PROMPT",
    prompt_skill_id: null,
    api_key_set: true,
    api_key_last4: "1234",
    last_called_at: null,
    ...over,
  };
}

function adapter(): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/agents/ai-settings",
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (p) => p,
  };
}

function renderUi(ui: ReactNode, nav: NavigationAdapter = adapter()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderWithI18n(
    <QueryClientProvider client={client}>
      <NavigationProvider value={nav}>{ui}</NavigationProvider>
    </QueryClientProvider>,
  );
}

describe("AI settings entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the entry for members", () => {
    mocks.role = "member";
    renderUi(<AISettingsEntryButton />);
    expect(screen.queryByRole("button", { name: "AI settings" })).toBeNull();
  });

  it("shows the entry to owners and opens the page", async () => {
    mocks.role = "owner";
    const nav = adapter();
    renderUi(<AISettingsEntryButton />, nav);
    await userEvent.click(screen.getByRole("button", { name: "AI settings" }));
    expect(nav.push).toHaveBeenCalledWith("/acme/agents/ai-settings");
  });
});

describe("AISettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "owner";
    mocks.api.getAISettings.mockResolvedValue(settings());
    mocks.api.listSkills.mockResolvedValue([]);
    mocks.api.updateAISettings.mockResolvedValue(settings());
    mocks.api.testAISettings.mockResolvedValue({ ok: true });
  });

  it("does not call the settings API for members", async () => {
    mocks.role = "member";
    renderUi(<AISettingsPage />);
    expect(await screen.findByRole("note")).toBeInTheDocument();
    expect(mocks.api.getAISettings).not.toHaveBeenCalled();
  });

  it("shows last four digits and never the key", async () => {
    renderUi(<AISettingsPage />);
    const key = await screen.findByLabelText(/API key/);
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute("placeholder", "••••1234");
    expect(key).toHaveAttribute("type", "password");
  });

  it("switching provider fills the endpoint", async () => {
    const user = userEvent.setup();
    renderUi(<AISettingsPage />);
    await screen.findByLabelText(/API key/);
    await user.click(screen.getByRole("combobox", { name: "Provider" }));
    await user.click(
      await screen.findByRole("option", { name: "Self-hosted (llama.cpp)" }),
    );
    expect(screen.getByLabelText("API endpoint")).toHaveValue(
      "http://localhost:8080/v1",
    );
  });

  it("sends clear_api_key when switching to a keyless provider without a key", async () => {
    const user = userEvent.setup();
    renderUi(<AISettingsPage />);
    await screen.findByLabelText(/API key/);
    await user.click(screen.getByRole("combobox", { name: "Provider" }));
    await user.click(
      await screen.findByRole("option", { name: "Self-hosted (llama.cpp)" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.api.updateAISettings).toHaveBeenCalled());
    const [, input] = mocks.api.updateAISettings.mock.calls[0]!;
    expect(input).toMatchObject({
      provider: "llamacpp",
      base_url: "http://localhost:8080/v1",
      model: "",
      clear_api_key: true,
    });
    expect(input.api_key).toBeUndefined();
  });

  it("requires the key after a host change", async () => {
    const user = userEvent.setup();
    mocks.api.updateAISettings.mockRejectedValue(
      new ApiError("key required", 409, "Conflict", { error: "api_key_required" }),
    );
    renderUi(<AISettingsPage />);
    const endpoint = await screen.findByLabelText("API endpoint");
    await user.clear(endpoint);
    await user.type(endpoint, "https://other.example.com/v1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const key = screen.getByLabelText(/API key/);
    await waitFor(() => expect(key).toHaveAttribute("aria-invalid", "true"));
    expect(
      screen.getByText("Enter the API key again after changing the provider or host."),
    ).toBeInTheDocument();
  });

  it("shows the secret-key notice and disables save", async () => {
    mocks.api.getAISettings.mockResolvedValue(
      settings({ secret_key_available: false }),
    );
    renderUi(<AISettingsPage />);
    expect(
      await screen.findByText("The server has no encryption key configured"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();
  });

  it("test shows status and message on failure", async () => {
    const user = userEvent.setup();
    mocks.api.testAISettings.mockResolvedValue({
      ok: false,
      status: 401,
      message: "Incorrect API key",
    });
    renderUi(<AISettingsPage />);
    await screen.findByLabelText(/API key/);
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("401 · Incorrect API key")).toBeInTheDocument();
  });

  it("test reports success", async () => {
    const user = userEvent.setup();
    renderUi(<AISettingsPage />);
    await screen.findByLabelText(/API key/);
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Connection succeeded")).toBeInTheDocument();
  });

  it("shows an error with retry when settings fail to load", async () => {
    const user = userEvent.setup();
    mocks.api.getAISettings.mockRejectedValueOnce(new Error("boom"));
    renderUi(<AISettingsPage />);
    expect(await screen.findByText("Couldn't load AI settings")).toBeInTheDocument();
    expect(mocks.api.getAISettings).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText(/API key/)).toBeInTheDocument();
    expect(mocks.api.getAISettings).toHaveBeenCalledTimes(2);
  });
});
