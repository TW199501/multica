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
    listAISettingsModels: vi.fn(),
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
import { COLLECTION_ACTION_YIELDS_TO_SEARCH } from "../../layout/collection-page";
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

  it("steps aside for an open search in a narrow list header", () => {
    mocks.role = "owner";
    renderUi(<AISettingsEntryButton />);
    const button = screen.getByRole("button", { name: "AI settings" });
    for (const name of COLLECTION_ACTION_YIELDS_TO_SEARCH.split(" ")) {
      expect(button).toHaveClass(name);
    }
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
    mocks.api.listAISettingsModels.mockResolvedValue({ ok: true, models: ["live-model-a", "live-model-b"] });
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

  it("keeps a stored llama.cpp key when only the prompt changes", async () => {
    const user = userEvent.setup();
    mocks.api.getAISettings.mockResolvedValue(
      settings({
        provider: "llamacpp",
        base_url: "http://localhost:8080/v1",
        model: "",
      }),
    );
    renderUi(<AISettingsPage />);
    const prompt = await screen.findByLabelText("Prompt");
    await user.clear(prompt);
    await user.type(prompt, "new prompt");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.api.updateAISettings).toHaveBeenCalled());
    const [, input] = mocks.api.updateAISettings.mock.calls[0]!;
    expect(input.prompt).toBe("new prompt");
    expect(input).not.toHaveProperty("clear_api_key");
    expect(input).not.toHaveProperty("api_key");
  });

  it("clears the stored key when switching a hosted provider to custom without a key", async () => {
    const user = userEvent.setup();
    renderUi(<AISettingsPage />);
    await screen.findByLabelText(/API key/);
    await user.click(screen.getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "Custom" }));
    const endpoint = screen.getByLabelText("API endpoint");
    await user.clear(endpoint);
    await user.type(endpoint, "http://vllm.internal:8000/v1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.api.updateAISettings).toHaveBeenCalled());
    const [, input] = mocks.api.updateAISettings.mock.calls[0]!;
    expect(input).toMatchObject({
      provider: "custom",
      base_url: "http://vllm.internal:8000/v1",
      clear_api_key: true,
    });
    expect(input).not.toHaveProperty("api_key");
  });
  it("lists the models the provider reports, without narrowing to the current value", async () => {
    const user = userEvent.setup();
    mocks.api.getAISettings.mockResolvedValue(settings({ model: "live-model-a" }));
    renderUi(<AISettingsPage />);
    await waitFor(() => expect(mocks.api.listAISettingsModels).toHaveBeenCalled());
    await user.click(screen.getByLabelText("Model"));

    expect(await screen.findByRole("option", { name: "live-model-a" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "live-model-b" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "live-model-b" }));
    expect(screen.getByLabelText("Model")).toHaveValue("live-model-b");
  });

  it("narrows the model list once the person types", async () => {
    const user = userEvent.setup();
    renderUi(<AISettingsPage />);
    await waitFor(() => expect(mocks.api.listAISettingsModels).toHaveBeenCalled());
    const model = screen.getByLabelText("Model");
    await user.clear(model);
    await user.type(model, "model-b");

    expect(await screen.findByRole("option", { name: "live-model-b" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "live-model-a" })).not.toBeInTheDocument();
  });

  it("keeps the bundled suggestions and says so when the provider cannot list models", async () => {
    mocks.api.listAISettingsModels.mockResolvedValue({ ok: false, status: 401, message: "bad key" });
    renderUi(<AISettingsPage />);

    expect(await screen.findByText(/Could not load this provider's model list/)).toBeInTheDocument();
  });

  it("does not ask for models until a required key is entered", async () => {
    const user = userEvent.setup();
    mocks.api.getAISettings.mockResolvedValue(settings({ api_key_set: false, api_key_last4: "" }));
    renderUi(<AISettingsPage />);
    const key = await screen.findByLabelText(/API key/);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mocks.api.listAISettingsModels).not.toHaveBeenCalled();

    await user.type(key, "sk-new");
    await waitFor(() =>
      expect(mocks.api.listAISettingsModels).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({ api_key: "sk-new", model: "", prompt: "" }),
      ),
    );
  });

  it("shows the provider logo in the trigger and in the list", async () => {
    const user = userEvent.setup();
    renderUi(<AISettingsPage />);
    await screen.findByLabelText(/API key/);
    const trigger = screen.getByRole("combobox", { name: "Provider" });
    expect(trigger.querySelector("[data-slot='select-value'] svg")).not.toBeNull();
    expect(trigger).toHaveTextContent("OpenAI");
    await user.click(trigger);
    const option = await screen.findByRole("option", { name: "Hugging Face" });
    expect(option.querySelector("svg")).not.toBeNull();
  });

  it("lists no blank provider for an unconfigured workspace", async () => {
    const user = userEvent.setup();
    mocks.api.getAISettings.mockResolvedValue(
      settings({
        configured: false,
        provider: "",
        base_url: "",
        model: "",
        api_key_set: false,
        api_key_last4: "",
      }),
    );
    renderUi(<AISettingsPage />);
    await screen.findByLabelText(/API key/);
    await user.click(screen.getByRole("combobox", { name: "Provider" }));
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.textContent?.trim()).not.toBe("");
    }
  });

  it("shows the loaded-model placeholder only for keyless providers", async () => {
    const user = userEvent.setup();
    renderUi(<AISettingsPage />);
    const model = await screen.findByLabelText("Model");
    expect(model).not.toHaveAttribute("placeholder");
    await user.click(screen.getByRole("combobox", { name: "Provider" }));
    await user.click(
      await screen.findByRole("option", { name: "Self-hosted (llama.cpp)" }),
    );
    expect(screen.getByLabelText("Model")).toHaveAttribute(
      "placeholder",
      "Empty uses the server's loaded model",
    );
  });

  it("disables the prompt while a skill supplies it", async () => {
    mocks.api.getAISettings.mockResolvedValue(
      settings({ prompt_skill_id: "skill-1" }),
    );
    mocks.api.listSkills.mockResolvedValue([{ id: "skill-1", name: "Style guide" }]);
    renderUi(<AISettingsPage />);
    const prompt = await screen.findByLabelText("Prompt");
    expect(prompt).toBeDisabled();
    expect(
      screen.getByText("The selected skill's content is used instead of this prompt."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Model usage" }));
    expect(screen.getByRole("button", { name: "Restore default" })).toBeDisabled();
  });

  it("keeps the prompt editable without a skill", async () => {
    renderUi(<AISettingsPage />);
    const prompt = await screen.findByLabelText("Prompt");
    expect(prompt).toBeEnabled();
    expect(
      screen.queryByText("The selected skill's content is used instead of this prompt."),
    ).toBeNull();
  });
});

describe("AI settings layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "owner";
    mocks.api.getAISettings.mockResolvedValue(settings());
    mocks.api.listSkills.mockResolvedValue([]);
  });

  it("splits providers and model usage into two tabs", async () => {
    const user = userEvent.setup();
    renderUi(<AISettingsPage />);

    const providers = await screen.findByRole("tab", { name: "Providers" });
    expect(providers).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Model usage" }));

    expect(screen.getByLabelText("Prompt")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Disable thinking" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
  });

  it("offers embedding, rerank and decision as usages that are not open yet", async () => {
    const user = userEvent.setup();
    renderUi(<AISettingsPage />);
    await user.click(await screen.findByRole("tab", { name: "Model usage" }));

    for (const name of ["Embedding", "Rerank", "Decision"]) {
      const select = screen.getByRole("combobox", { name });
      expect(select).toHaveAttribute("data-disabled");
    }
  });

  it("keeps configuration management visible but closed for now", async () => {
    renderUi(<AISettingsPage />);
    await screen.findByRole("tab", { name: "Providers" });

    for (const name of ["New configuration", "Duplicate", "Delete", "Add header", "Add model"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("shows a rejected key beside Save, whichever tab is open", async () => {
    const user = userEvent.setup();
    mocks.api.updateAISettings.mockRejectedValue(
      new ApiError("key required", 409, "Conflict", { error: "api_key_required" }),
    );
    renderUi(<AISettingsPage />);
    const key = await screen.findByLabelText(/API key/);
    await user.click(screen.getByRole("tab", { name: "Model usage" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    const error = await screen.findByRole("alert");
    expect(error).toBeVisible();
    expect(error).toHaveAttribute("id", "ai-api-key-error");
    expect(key).toHaveAttribute("aria-describedby", "ai-api-key-error");
  });

  it("never asks people for the model type", async () => {
    renderUi(<AISettingsPage />);
    await screen.findByRole("tab", { name: "Providers" });

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("tags the type and vision from the catalog as the model changes", async () => {
    const user = userEvent.setup();
    mocks.api.getAISettings.mockResolvedValue(settings({ model: "plain-text-model" }));
    renderUi(<AISettingsPage />);
    const model = await screen.findByLabelText("Model");
    const params = screen.getByRole("button", { name: "Model parameters" });
    await user.click(params);
    expect(await screen.findByTestId("ai-model-type")).toHaveTextContent("Chat");
    expect(screen.queryByTestId("ai-model-vision")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.clear(model);
    await user.type(model, "qwen/qwen3-embedding-8b");
    await user.click(params);
    expect(await screen.findByTestId("ai-model-type")).toHaveTextContent("Embedding");
  });

  it("shows vision and limits for a listed vision model", async () => {
    const user = userEvent.setup();
    mocks.api.getAISettings.mockResolvedValue(settings({ model: "claude-fable-5-1" }));
    renderUi(<AISettingsPage />);
    await screen.findByLabelText("Model");
    await user.click(screen.getByRole("button", { name: "Model parameters" }));

    expect(await screen.findByTestId("ai-model-vision")).toHaveTextContent("Vision");
    expect(screen.getByTestId("ai-model-limits")).toHaveTextContent(/Context/);
  });

  it("says so when the catalog has no parameters for the model", async () => {
    const user = userEvent.setup();
    mocks.api.getAISettings.mockResolvedValue(settings({ model: "plain-text-model" }));
    renderUi(<AISettingsPage />);
    await screen.findByLabelText("Model");
    await user.click(screen.getByRole("button", { name: "Model parameters" }));

    expect(
      await screen.findByText("No parameters on file for this model."),
    ).toBeInTheDocument();
  });

  it("disables the parameters button until a model is entered", async () => {
    mocks.api.getAISettings.mockResolvedValue(settings({ model: "" }));
    renderUi(<AISettingsPage />);
    await screen.findByLabelText("Model");

    expect(screen.getByRole("button", { name: "Model parameters" })).toBeDisabled();
  });

  it("warns when the chat AI is given a model that cannot chat", async () => {
    mocks.api.getAISettings.mockResolvedValue(settings({ model: "qwen3-embedding-8b" }));
    renderUi(<AISettingsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("chat model");
  });

  it("reveals only what was typed, never the stored key", async () => {
    const user = userEvent.setup();
    renderUi(<AISettingsPage />);
    const key = await screen.findByLabelText(/API key/);

    await user.type(key, "sk-typed");
    await user.click(screen.getByRole("button", { name: "Show key" }));

    expect(key).toHaveAttribute("type", "text");
    expect(key).toHaveValue("sk-typed");
    await user.click(screen.getByRole("button", { name: "Hide key" }));
    expect(key).toHaveAttribute("type", "password");
  });

  it("hides the key again after saving", async () => {
    const user = userEvent.setup();
    mocks.api.updateAISettings.mockResolvedValue(settings());
    renderUi(<AISettingsPage />);
    const key = await screen.findByLabelText(/API key/);
    await user.type(key, "sk-typed");
    await user.click(screen.getByRole("button", { name: "Show key" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(key).toHaveAttribute("type", "password"));
  });
});
