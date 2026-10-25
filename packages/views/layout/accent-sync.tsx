"use client";

import { useLayoutEffect } from "react";
import { useAccentStore } from "@multica/core/appearance";

/**
 * Mirrors the device's accent choice onto <html data-accent>, which tokens.css
 * reads. A layout effect so desktop, which has no pre-paint script, applies a
 * stored accent before the first frame.
 */
export function AccentSync() {
  const accent = useAccentStore((s) => s.accent);
  useLayoutEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);
  return null;
}
