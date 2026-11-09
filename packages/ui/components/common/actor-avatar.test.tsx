import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { parseAvatarPersona } from "@multica/ui/lib/avatar-persona";
import { ActorAvatar } from "./actor-avatar";

describe("ActorAvatar with a person avatar", () => {
  it("shows the bundled image, not the raw marker", () => {
    const { container } = render(<ActorAvatar name="解萬難" initials="解" isAgent avatarUrl="persona:03" />);

    expect(container.querySelector("img")?.getAttribute("src")).toBe(parseAvatarPersona("persona:03"));
  });

  it("falls back to the agent icon for a number this client does not have", () => {
    const { container } = render(<ActorAvatar name="解萬難" initials="解" isAgent avatarUrl="persona:99" />);

    // The marker reaches <img>, fails to load in a browser, and the icon takes over.
    expect(container.querySelector("img")?.getAttribute("src")).toBe("persona:99");
  });
});
