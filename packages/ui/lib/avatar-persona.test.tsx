import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ActorAvatar } from "../components/common/actor-avatar";
import { AVATAR_PERSONAS, parseAvatarPersona } from "./avatar-persona";

describe("avatar personas", () => {
  it("offers the 24 avatars the server assigns", () => {
    expect(AVATAR_PERSONAS).toHaveLength(24);
    expect(AVATAR_PERSONAS[0]?.value).toBe("persona:01");
    expect(AVATAR_PERSONAS[23]?.value).toBe("persona:24");
  });

  it("resolves a known value to its image", () => {
    expect(parseAvatarPersona("persona:07")).toBe(AVATAR_PERSONAS[6]?.src);
    expect(parseAvatarPersona("persona:07")).toBeTruthy();
  });

  it.each([null, undefined, "", "emoji:🐙", "persona:", "persona:99", "https://x/a.png"])(
    "ignores %s",
    (value) => {
      expect(parseAvatarPersona(value)).toBeNull();
    },
  );
});

describe("ActorAvatar with a person avatar", () => {
  it("shows the bundled image, not the raw marker", () => {
    const { container } = render(<ActorAvatar name="解萬難" initials="解" isAgent avatarUrl="persona:03" />);

    expect(container.querySelector("img")?.getAttribute("src")).toBe(parseAvatarPersona("persona:03"));
  });
});
