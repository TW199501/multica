const BROWSER_ROUTE = /^\/([^/]+)\/browser\/?$/;

// Returns the workspace slug when the url is that workspace's browser route.
export function browserScopeForUrl(url: string | null): string | null {
  if (!url) return null;
  const path = url.split(/[?#]/, 1)[0] ?? "";
  const match = BROWSER_ROUTE.exec(path);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

export function browserPath(slug: string): string {
  return `/${encodeURIComponent(slug)}/browser`;
}
