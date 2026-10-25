"use client";

import { useEffect } from "react";
import { useAccentStore } from "@multica/core/appearance";

/** Mirrors the device's accent choice onto <html data-accent>, which tokens.css reads. */
export function AccentSync() {
  const accent = useAccentStore((s) => s.accent);
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);
  return null;
}
