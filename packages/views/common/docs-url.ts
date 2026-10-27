import { DEFAULT_RELEASE_REPOSITORY, useConfigStore } from "@multica/core/config";

export const UPSTREAM_DOCS_URL = "https://multica.ai/docs";

// A deployment that ships its own builds (MULTICA_RELEASE_REPOSITORY) also
// serves its own docs site at `<app URL>/docs`; everyone else reads upstream's.
// Absolute so the desktop renderer, which has no web origin, reaches it too.
export function resolveDocsUrl(config: {
  releaseRepository: string;
  daemonAppUrl: string;
}): string {
  const appUrl = config.daemonAppUrl.endsWith("/")
    ? config.daemonAppUrl.slice(0, -1)
    : config.daemonAppUrl;
  if (config.releaseRepository === DEFAULT_RELEASE_REPOSITORY || !appUrl) {
    return UPSTREAM_DOCS_URL;
  }
  return `${appUrl}/docs`;
}

export function useDocsUrl(): string {
  const releaseRepository = useConfigStore((state) => state.releaseRepository);
  const daemonAppUrl = useConfigStore((state) => state.daemonAppUrl);
  return resolveDocsUrl({ releaseRepository, daemonAppUrl });
}
