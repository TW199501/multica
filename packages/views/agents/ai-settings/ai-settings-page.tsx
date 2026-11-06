"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "@multica/ui/icons";
import { Badge } from "@multica/ui/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@multica/ui/components/ui/tabs";
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
import {
  catalogModelsFor,
  detectModelType,
  lookupModel,
  useModelCatalog,
} from "./model-catalog";
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
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<AISettingsTestResult | null>(
    null,
  );

  const preset = PROVIDER_PRESETS.find((p) => p.key === provider);
  const keyless = KEYLESS_PROVIDERS.has(provider);
  const targetChanged =
    provider !== settings.provider ||
    hostOf(baseUrl) !== hostOf(settings.base_url);
  const keyRequired = !keyless && (!settings.api_key_set || targetChanged);
  const blocked = !settings.secret_key_available;
  const promptFromSkill = skillId !== null;
  const catalog = useModelCatalog();
  const modelType = detectModelType(model, catalog);
  const modelInfo = lookupModel(model, catalog);
  const modelOptions = useMemo(
    () => [...new Set([...(preset?.models ?? []), ...catalogModelsFor(provider, catalog)])],
    [preset, provider, catalog],
  );
  const compact = useMemo(() => new Intl.NumberFormat(undefined, { notation: "compact" }), []);

  const providerItems = useMemo(() => {
    const items = PROVIDER_PRESETS.map((p) => ({
      value: p.key,
      label: t(($) => $.ai_settings.providers[p.key as ProviderKey]),
    }));
    // A provider id added by a newer server still has to render; an
    // unconfigured workspace has no provider yet.
    if (
      settings.provider &&
      !items.some((i) => i.value === settings.provider)
    ) {
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
    // Same target with an empty field keeps the stored key; only moving a
    // stored key's owner to a keyless-capable endpoint drops it.
    else if (keyless && targetChanged && settings.api_key_set)
      input.clear_api_key = true;
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
      // The mutation cache would otherwise keep the typed key in its variables.
      update.reset();
      setApiKey("");
      setShowKey(false);
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
      test.reset();
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

      <Tabs defaultValue="providers" className="gap-5">
        <TabsList>
          <TabsTrigger value="providers">{t(($) => $.ai_settings.tab_providers)}</TabsTrigger>
          <TabsTrigger value="usage">{t(($) => $.ai_settings.tab_usage)}</TabsTrigger>
        </TabsList>

        {/* Both stay mounted: switching tabs must not drop unsaved edits. */}
        <TabsContent keepMounted value="providers" className="space-y-5 data-hidden:hidden">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled>
              <Plus className="size-3.5" />
              {t(($) => $.ai_settings.new_config)}
            </Button>
            <Button type="button" variant="outline" disabled>
              <Copy className="size-3.5" />
              {t(($) => $.ai_settings.duplicate_config)}
            </Button>
            <Button type="button" variant="outline" disabled>
              <Trash2 className="size-3.5" />
              {t(($) => $.ai_settings.delete_config)}
            </Button>
            <NextRoundBadge />
          </div>

          <Field id="ai-provider" label={t(($) => $.ai_settings.provider)}>
            <Select items={providerItems} value={provider} onValueChange={onProviderChange}>
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

          <Field id="ai-endpoint" label={t(($) => $.ai_settings.endpoint)}>
            <Input id="ai-endpoint" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>

          <Field
            id="ai-api-key"
            label={
              keyRequired
                ? t(($) => $.ai_settings.api_key_required)
                : t(($) => $.ai_settings.api_key)
            }
          >
            <div className="flex items-center gap-2">
              <Input
                id="ai-api-key"
                type={showKey ? "text" : "password"}
                autoComplete="off"
                value={apiKey}
                placeholder={settings.api_key_set ? `••••${settings.api_key_last4}` : undefined}
                aria-invalid={keyError || undefined}
                aria-describedby={keyError ? "ai-api-key-error" : undefined}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={
                  showKey ? t(($) => $.ai_settings.hide_key) : t(($) => $.ai_settings.show_key)
                }
                onClick={() => setShowKey((shown) => !shown)}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
            {keyError ? (
              <p id="ai-api-key-error" className="text-caption text-destructive">
                {t(($) => $.ai_settings.api_key_error)}
              </p>
            ) : null}
          </Field>

          <div className="space-y-1.5">
            <p className="text-body font-medium">{t(($) => $.ai_settings.custom_headers)}</p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled>
                <Plus className="size-3.5" />
                {t(($) => $.ai_settings.add_header)}
              </Button>
              <NextRoundBadge />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-body font-medium">{t(($) => $.ai_settings.model_list)}</p>
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-medium">
                  {model.trim() || t(($) => $.ai_settings.model_placeholder)}
                </span>
                {modelType ? (
                  <Badge variant="secondary" data-testid="ai-model-type">
                    {t(($) => $.ai_settings.model_types[modelType])}
                  </Badge>
                ) : null}
                {modelInfo?.vision ? (
                  <Badge variant="secondary" data-testid="ai-model-vision">
                    {t(($) => $.ai_settings.vision)}
                  </Badge>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  disabled={blocked || test.isPending}
                  onClick={handleTest}
                >
                  {test.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {t(($) => $.ai_settings.test)}
                </Button>
              </div>

              <Field id="ai-model" label={t(($) => $.ai_settings.model)}>
                <Input
                  id="ai-model"
                  list="ai-model-options"
                  placeholder={keyless ? t(($) => $.ai_settings.model_placeholder) : undefined}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
                <datalist id="ai-model-options">
                  {modelOptions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>

              {modelInfo?.context ? (
                <p data-testid="ai-model-limits" className="text-caption text-muted-foreground">
                  {t(($) => $.ai_settings.context_window, { value: compact.format(modelInfo.context) })}
                  {modelInfo.output
                    ? ` · ${t(($) => $.ai_settings.output_limit, { value: compact.format(modelInfo.output) })}`
                    : null}
                </p>
              ) : null}

              {modelType && modelType !== "chat" ? (
                <p role="alert" className="text-caption text-warning">
                  {t(($) => $.ai_settings.needs_chat_model)}
                </p>
              ) : null}

              {testResult ? (
                <p
                  role="status"
                  className={
                    testResult.ok ? "text-caption text-success" : "text-caption text-destructive"
                  }
                >
                  {testResult.ok
                    ? t(($) => $.ai_settings.test_ok)
                    : t(($) => $.ai_settings.test_failed, {
                        status: testResult.status,
                        message: testResult.message,
                      })}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled>
                <Plus className="size-3.5" />
                {t(($) => $.ai_settings.add_model)}
              </Button>
              <NextRoundBadge />
            </div>
          </div>
        </TabsContent>

        <TabsContent keepMounted value="usage" className="space-y-5 data-hidden:hidden">
          <div className="space-y-5 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t(($) => $.ai_settings.usage_chat)}</span>
              <span className="min-w-0 truncate text-caption text-muted-foreground">
                {model.trim() || t(($) => $.ai_settings.model_placeholder)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="ai-disable-thinking"
                aria-label={t(($) => $.ai_settings.disable_thinking)}
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
                disabled={promptFromSkill}
                aria-describedby={promptFromSkill ? "ai-prompt-from-skill" : undefined}
                onChange={(e) => setPrompt(e.target.value)}
              />
              {promptFromSkill ? (
                <p id="ai-prompt-from-skill" className="text-caption text-muted-foreground">
                  {t(($) => $.ai_settings.prompt_from_skill)}
                </p>
              ) : null}
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={promptFromSkill}
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
          </div>

          <PlannedUsage id="ai-usage-embedding" label={t(($) => $.ai_settings.usage_embedding)} />
          <PlannedUsage id="ai-usage-rerank" label={t(($) => $.ai_settings.usage_rerank)} />
          <PlannedUsage id="ai-usage-decision" label={t(($) => $.ai_settings.usage_decision)} />
        </TabsContent>
      </Tabs>

      <div className="border-t pt-4">
        <Button type="button" disabled={blocked || update.isPending} onClick={handleSave}>
          {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {t(($) => $.ai_settings.save)}
        </Button>
      </div>
    </>
  );
}

function NextRoundBadge() {
  const { t } = useT("agents");
  return <Badge variant="outline">{t(($) => $.ai_settings.next_round)}</Badge>;
}

/** A model usage the server cannot store or test yet. */
function PlannedUsage({ id, label }: { id: string; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        <NextRoundBadge />
      </div>
      <Select disabled items={[]} value={null}>
        <SelectTrigger id={id} className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent />
      </Select>
    </div>
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
