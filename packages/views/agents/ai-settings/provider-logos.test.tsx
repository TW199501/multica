// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import { PROVIDER_PRESETS } from "./provider-presets";

function markup(provider: string) {
  return render(<ProviderLogo provider={provider} />).container.innerHTML;
}

describe("AI provider logos", () => {
  const fallback = markup("provider-from-a-newer-server");

  it.each(PROVIDER_PRESETS.map((preset) => preset.key))(
    "%s has its own logo",
    (key) => {
      expect(markup(key)).not.toBe(fallback);
    },
  );
});
