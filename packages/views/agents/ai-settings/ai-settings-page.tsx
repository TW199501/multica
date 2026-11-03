"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Loader2, Sparkles } from "@multica/ui/icons";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { Switch } from "@multica/ui/components/ui/switch";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { aiErrorCode } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentMember } from "@multica/core/permissions";
import type {
  AISettingsInput,
  AISettingsTestResult,
  WorkspaceAISettings,
} from "@multica/core/types";
import {
  skillListOptions,
  workspaceAISettingsOptions,
} from "@multica/core/workspace/queries";
import {
  useTestAISettings,
  useUpdateAISettings,
} from "@multica/core/workspace/mutations";
import {
  CollectionPageHeader,
  CollectionPageState,
} from "../../layout/collection-page";
import { PAGE_GUTTER, PAGE_RAIL } from "../../layout/page-header";
import { SettingsReadOnlyNotice } from "../../settings/components/settings-layout";
import { useT, useTimeAgo } from "../../i18n";
import { KEYLESS_PROVIDERS, PROVIDER_PRESETS } from "./provider-presets";

const NO_SKILL = "__none__";

type ProviderKey =
  | "claude"
  | "openai"
  | "gemini"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "grok"
  | "openrouter"
  | "huggingface"
  | "llamacpp"
  | "custom";

// A stored key must not follow the user to another host, so a host change is
// compared by host only (a path or scheme tweak keeps the key).
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.trim();
  }
}

export function AISettingsPage() {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const { role, isLoading: memberLoading } = useCurrentMember(wsId);
  const canManage = role === "owner" || role === "admin";

  const settingsQuery = useQuery({
    ...workspaceAISettingsOptions(wsId),
    enabled: canManage && wsId !== "",
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Sparkles}
        title={t(($) => $.ai_settings.title)}
      />
      <div className={`${PAGE_GUTTER} min-h-0 flex-1 overflow-y-auto py-6`}>
        <div className={`${PAGE_RAIL} max-w-2xl space-y-5`}>
          {!canManage ? (
            memberLoading ? null : <SettingsReadOnlyNotice wsId={wsId} />
          ) : settingsQuery.data ? (
            <AISettingsForm wsId={wsId} settings={settingsQuery.data} />
          ) : settingsQuery.isError ? (
            <CollectionPageState
              role="alert"
              tone="destructive"
              icon={AlertCircle}
              title={t(($) => $.ai_settings.load_failed)}
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void settingsQuery.refetch()}
                >
                  {t(($) => $.ai_settings.retry)}
                </Button>
              }
            />
          ) : (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>
    </div>
  );
}

function AISettingsForm({
  wsId,
  settings,
}: {
  wsId: string;
  settings: WorkspaceAISettings;
}) {
  const { t } = useT("agents");
  const timeAgo = useTimeAgo();
  const update = useUpdateAISettings(wsId);
  const test = useTestAISettings(wsId);
  const { data: skills = [] } = useQuery(skillListOptions(wsId));

  const [provider, setProvider] = useState(settings.provider);
  const [baseUrl, setBaseUrl] = useState(settings.base_url);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [disableThinking, setDisableThinking] = useState(
    settings.disable_thinking,
  );
  const [prompt, setPrompt] = useState(
    settings.prompt || settings.default_prompt,
  );
  const [skillId, setSkillId] = useState<string | null>(
    settings.prompt_skill_id,
  );
  const [keyError, setKeyError] = useState(false);
  const [testResult, setTestResult] = useState<AISettingsTestResult | null>(
    null,
  );

  const preset = PROVIDER_PRESETS.find((p) => p.key === provider);
  const keyless = KEYLESS_PROVIDERS.has(provider);
  const keyRequired =
    !keyless &&
    (!settings.api_key_set ||
      provider !== settings.provider ||
      hostOf(baseUrl) !== hostOf(settings.base_url));
  const blocked = !settings.secret_key_available;

  const providerItems = useMemo(() => {
    const items = PROVIDER_PRESETS.map((p) => ({
      value: p.key,
      label: t(($) => $.ai_settings.providers[p.key as ProviderKey]),
    }));
    // A provider id added by a newer server still has to render.
    if (!items.some((i) => i.value === settings.provider)) {
      items.push({ value: settings.provider, label: settings.provider });
    }
    return items;
  }, [t, settings.provider]);

  const skillItems = useMemo(
    () => [
      { value: NO_SKILL, label: t(($) => $.ai_settings.no_skill) },
      ...skills.map((s) => ({ value: s.id, label: s.name })),
    ],
    [skills, t],
  );

  const buildInput = (): AISettingsInput => {
    const input: AISettingsInput = {
      provider,
      base_url: baseUrl.trim(),
      model: model.trim(),
      disable_thinking: disableThinking,
      // The default text is stored as empty so later default updates still apply.
      prompt: prompt === settings.default_prompt ? "" : prompt,
      prompt_skill_id: skillId,
    };
    const key = apiKey.trim();
    if (key) input.api_key = key;
    else if (keyless) input.clear_api_key = true;
    return input;
  };

  const onProviderChange = (next: string | null) => {
    if (!next) return;
    setProvider(next);
    setKeyError(false);
    const p = PROVIDER_PRESETS.find((x) => x.key === next);
    if (p && next !== "custom") {
      setBaseUrl(p.baseUrl);
      setModel(p.models[0] ?? "");
    }
  };

  const handleSave = async () => {
    setKeyError(false);
    try {
      await update.mutateAsync(buildInput());
      setApiKey("");
      toast.success(t(($) => $.ai_settings.saved_toast));
    } catch (err) {
      const code = aiErrorCode(err);
      if (code === "api_key_required") setKeyError(true);
      else if (code === "secret_key_missing")
        toast.error(t(($) => $.ai_settings.no_secret_key));
      else toast.error(t(($) => $.ai_settings.save_failed_toast));
    }
  };

  const handleTest = async () => {
    setKeyError(false);
    setTestResult(null);
    try {
      setTestResult(await test.mutateAsync(buildInput()));
    } catch (err) {
      if (aiErrorCode(err) === "api_key_required") setKeyError(true);
      else toast.error(t(($) => $.ai_settings.test_request_failed));
    }
  };

  const status = !settings.configured
    ? t(($) => $.ai_settings.status_not_configured)
    : settings.last_called_at
      ? t(($) => $.ai_settings.status_connected, {
          when: timeAgo(settings.last_called_at),
        })
      : t(($) => $.ai_settings.status_connected_idle);

  return (
    <>
      <p className="text-caption text-muted-foreground">{status}</p>

      {blocked ? (
        <div
          role="alert"
          className="rounded-xl border border-warning/40 bg-surface px-4 py-3 text-body text-warning"
        >
          {t(($) => $.ai_settings.no_secret_key)}
        </div>
      ) : null}

      <Field id="ai-provider" label={t(($) => $.ai_settings.provider)}>
        <Select
          items={providerItems}
          value={provider}
          onValueChange={onProviderChange}
        >
          <SelectTrigger id="ai-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providerItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field id="ai-model" label={t(($) => $.ai_settings.model)}>
        <Input
          id="ai-model"
          list="ai-model-options"
          placeholder={t(($) => $.ai_settings.model_placeholder)}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <datalist id="ai-model-options">
          {(preset?.models ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>

      <Field id="ai-endpoint" label={t(($) => $.ai_settings.endpoint)}>
        <Input
          id="ai-endpoint"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </Field>

      <Field
        id="ai-api-key"
        label={
          keyRequired
            ? t(($) => $.ai_settings.api_key_required)
            : t(($) => $.ai_settings.api_key)
        }
      >
        <Input
          id="ai-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          placeholder={
            settings.api_key_set ? `••••${settings.api_key_last4}` : undefined
          }
          aria-invalid={keyError || undefined}
          aria-describedby={keyError ? "ai-api-key-error" : undefined}
          onChange={(e) => setApiKey(e.target.value)}
        />
        {keyError ? (
          <p id="ai-api-key-error" className="text-caption text-destructive">
            {t(($) => $.ai_settings.api_key_error)}
          </p>
        ) : null}
      </Field>

      <div className="flex items-center gap-2">
        <Switch
          id="ai-disable-thinking"
          checked={disableThinking}
          onCheckedChange={setDisableThinking}
        />
        <Label htmlFor="ai-disable-thinking">
          {t(($) => $.ai_settings.disable_thinking)}
        </Label>
      </div>

      <Field id="ai-prompt" label={t(($) => $.ai_settings.prompt)}>
        <Textarea
          id="ai-prompt"
          rows={8}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPrompt(settings.default_prompt)}
          >
            {t(($) => $.ai_settings.restore_default)}
          </Button>
        </div>
      </Field>

      <Field id="ai-skill" label={t(($) => $.ai_settings.load_from_skill)}>
        <Select
          items={skillItems}
          value={skillId ?? NO_SKILL}
          onValueChange={(v) => setSkillId(!v || v === NO_SKILL ? null : v)}
        >
          <SelectTrigger id="ai-skill" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {skillItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={blocked || test.isPending}
          onClick={handleTest}
        >
          {test.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {t(($) => $.ai_settings.test)}
        </Button>
        <Button
          type="button"
          disabled={blocked || update.isPending}
          onClick={handleSave}
        >
          {update.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {t(($) => $.ai_settings.save)}
        </Button>
        {testResult ? (
          <span
            role="status"
            className={
              testResult.ok
                ? "text-caption text-success"
                : "text-caption text-destructive"
            }
          >
            {testResult.ok
              ? t(($) => $.ai_settings.test_ok)
              : t(($) => $.ai_settings.test_failed, {
                  status: testResult.status,
                  message: testResult.message,
                })}
          </span>
        ) : null}
      </div>
    </>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
