import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { DaemonConfigStatus, DaemonSetupTarget } from "../runtimes/commands";

/** Upstream "owner/name" repository whose GitHub releases ship Multica builds. */
export const DEFAULT_RELEASE_REPOSITORY = "multica-ai/multica";

const RELEASE_REPOSITORY_PART = /^[A-Za-z0-9._-]+$/;

/** True for a GitHub "owner/name" pair. */
export function isValidReleaseRepository(value: string): boolean {
  const parts = value.split("/");
  return (
    parts.length === 2 &&
    parts.every((p) => RELEASE_REPOSITORY_PART.test(p) && p !== "." && p !== "..")
  );
}

/** The given repository when well-formed, otherwise the upstream default. */
export function resolveReleaseRepository(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  return isValidReleaseRepository(trimmed) ? trimmed : DEFAULT_RELEASE_REPOSITORY;
}

interface ConfigState {
  cdnDomain: string;
  attachmentPublicUrl: string;
  // True when cdnDomain serves private content via time-bounded signed URLs
  // (CloudFront signing enabled server-side). Renderers must not treat a raw
  // storage URL on that domain as a loadable media source (MUL-3254).
  cdnSigned: boolean;
  allowSignup: boolean;
  googleClientId: string;
  daemonServerUrl: string;
  daemonAppUrl: string;
  // "owner/name" repository whose releases the UI checks for daemon updates.
  // Older servers omit it, which keeps the upstream default.
  releaseRepository: string;
  daemonConfigStatus: DaemonConfigStatus;
  daemonSetupTarget: DaemonSetupTarget;
  // Self-host gate (#3433): when true, every "Create workspace" affordance
  // must be hidden. Defaults to false so unknown / older servers behave like
  // the managed-cloud case.
  workspaceCreationDisabled: boolean;
  // Self-host-only gate for the Git provider integration (Forgejo / Gitea /
  // GitLab). When false the whole Settings → Integrations "Git providers"
  // section is hidden. Defaults to false so unknown / older servers and the
  // managed cloud (which omits the field) keep it hidden.
  vcsIntegrationAvailable: boolean;
  featureFlags: Record<string, boolean>;
  // The running API build version, surfaced in the Help popover so
  // self-hosted operators can confirm what's deployed. Empty for dev builds
  // or servers older than this feature.
  serverVersion: string;
  // Whether the connected server validates local_directory execution_mode.
  // Defaults to false, and stays false for any server that does not declare it:
  // the dangerous ones accept worktree mode, drop the field, and run the task
  // in the user's working copy anyway (#7113). Servers that validate but
  // predate this signal are caught by the same net — indistinguishable from
  // here, and only one of the two answers is safe to guess.
  localWorktreeSupported: boolean;
  // Whether this server persists conversation_starters on agent create/update.
  // Older handlers accepted the unknown field and returned success while
  // dropping it, so absent must fail closed.
  agentConversationStartersSupported: boolean;
  // Whether POST /api/issues atomically persists custom-property values.
  // Older servers silently drop the field, so absent must fail closed.
  issueCreatePropertiesSupported: boolean;
  // Whether deleting a comment keeps its replies (#8296). Older servers
  // deleted the replies too, so absent must fail closed: the client then
  // promises nothing about replies and uses the legacy delete route.
  commentDeleteKeepRepliesSupported: boolean;
  setCdnConfig: (config: { cdnDomain: string; cdnSigned?: boolean }) => void;
  setAttachmentPublicUrl: (url?: string) => void;
  setAuthConfig: (config: {
    allowSignup: boolean;
    googleClientId?: string;
    workspaceCreationDisabled?: boolean;
    vcsIntegrationAvailable?: boolean;
  }) => void;
  setDaemonConfig: (config: {
    daemonServerUrl?: string;
    daemonAppUrl?: string;
    daemonSetupTarget?: DaemonSetupTarget;
  }) => void;
  setReleaseRepository: (repository?: string) => void;
  setDaemonConfigStatus: (status: DaemonConfigStatus) => void;
  setFeatureFlags: (flags?: Record<string, boolean>) => void;
  setServerVersion: (version?: string) => void;
  setLocalWorktreeSupported: (supported?: boolean) => void;
  setAgentConversationStartersSupported: (supported?: boolean) => void;
  setIssueCreatePropertiesSupported: (supported?: boolean) => void;
  setCommentDeleteKeepRepliesSupported: (supported?: boolean) => void;
}

export const configStore = createStore<ConfigState>((set) => ({
  cdnDomain: "",
  attachmentPublicUrl: "",
  cdnSigned: false,
  allowSignup: true,
  googleClientId: "",
  daemonServerUrl: "",
  daemonAppUrl: "",
  releaseRepository: DEFAULT_RELEASE_REPOSITORY,
  daemonConfigStatus: "loading",
  daemonSetupTarget: "unknown",
  workspaceCreationDisabled: false,
  vcsIntegrationAvailable: false,
  featureFlags: {},
  serverVersion: "",
  localWorktreeSupported: false,
  agentConversationStartersSupported: false,
  issueCreatePropertiesSupported: false,
  commentDeleteKeepRepliesSupported: false,
  setCdnConfig: ({ cdnDomain, cdnSigned = false }) => set({ cdnDomain, cdnSigned }),
  setAttachmentPublicUrl: (url = "") => set({ attachmentPublicUrl: url }),
  setAuthConfig: ({
    allowSignup,
    googleClientId = "",
    workspaceCreationDisabled = false,
    vcsIntegrationAvailable = false,
  }) => set({ allowSignup, googleClientId, workspaceCreationDisabled, vcsIntegrationAvailable }),
  setDaemonConfig: ({
    daemonServerUrl = "",
    daemonAppUrl = "",
    daemonSetupTarget = "unknown",
  }) => set({
    daemonServerUrl,
    daemonAppUrl,
    daemonSetupTarget,
    daemonConfigStatus: "ready",
  }),
  setDaemonConfigStatus: (daemonConfigStatus) => set({ daemonConfigStatus }),
  setReleaseRepository: (repository) =>
    set({ releaseRepository: resolveReleaseRepository(repository) }),
  setFeatureFlags: (flags = {}) => set({ featureFlags: { ...flags } }),
  setServerVersion: (version = "") => set({ serverVersion: version }),
  setLocalWorktreeSupported: (supported = false) =>
    set({ localWorktreeSupported: supported === true }),
  setAgentConversationStartersSupported: (supported = false) =>
    set({ agentConversationStartersSupported: supported === true }),
  setIssueCreatePropertiesSupported: (supported = false) =>
    set({ issueCreatePropertiesSupported: supported === true }),
  setCommentDeleteKeepRepliesSupported: (supported = false) =>
    set({ commentDeleteKeepRepliesSupported: supported === true }),
}));

export function useConfigStore(): ConfigState;
export function useConfigStore<T>(selector: (state: ConfigState) => T): T;
export function useConfigStore<T>(selector?: (state: ConfigState) => T) {
  return useStore(configStore, selector as (state: ConfigState) => T);
}

export function featureFlagEnabled(
  flags: Readonly<Record<string, boolean>> | undefined,
  key: string,
  defaultValue = false,
): boolean {
  return flags?.[key] ?? defaultValue;
}

export function useFeatureEnabled(key: string, defaultValue = false): boolean {
  return useConfigStore((state) =>
    featureFlagEnabled(state.featureFlags, key, defaultValue),
  );
}
