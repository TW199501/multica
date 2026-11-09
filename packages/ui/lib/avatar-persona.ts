import persona01 from "../assets/personas/01.svg";
import persona02 from "../assets/personas/02.svg";
import persona03 from "../assets/personas/03.svg";
import persona04 from "../assets/personas/04.svg";
import persona05 from "../assets/personas/05.svg";
import persona06 from "../assets/personas/06.svg";
import persona07 from "../assets/personas/07.svg";
import persona08 from "../assets/personas/08.svg";
import persona09 from "../assets/personas/09.svg";
import persona10 from "../assets/personas/10.svg";
import persona11 from "../assets/personas/11.svg";
import persona12 from "../assets/personas/12.svg";
import persona13 from "../assets/personas/13.svg";
import persona14 from "../assets/personas/14.svg";
import persona15 from "../assets/personas/15.svg";
import persona16 from "../assets/personas/16.svg";
import persona17 from "../assets/personas/17.svg";
import persona18 from "../assets/personas/18.svg";
import persona19 from "../assets/personas/19.svg";
import persona20 from "../assets/personas/20.svg";
import persona21 from "../assets/personas/21.svg";
import persona22 from "../assets/personas/22.svg";
import persona23 from "../assets/personas/23.svg";
import persona24 from "../assets/personas/24.svg";

const AVATAR_PERSONA_PREFIX = "persona:";

const SOURCES: Record<string, string | { src: string }> = {
  "01": persona01,
  "02": persona02,
  "03": persona03,
  "04": persona04,
  "05": persona05,
  "06": persona06,
  "07": persona07,
  "08": persona08,
  "09": persona09,
  "10": persona10,
  "11": persona11,
  "12": persona12,
  "13": persona13,
  "14": persona14,
  "15": persona15,
  "16": persona16,
  "17": persona17,
  "18": persona18,
  "19": persona19,
  "20": persona20,
  "21": persona21,
  "22": persona22,
  "23": persona23,
  "24": persona24,
};

// Next.js exposes static imports as objects while Vite exposes URL strings.
function assetSrc(asset: string | { src: string }): string {
  return typeof asset === "string" ? asset : asset.src;
}

/** Every person avatar, as the value to persist in `avatar_url` and its image. */
export const AVATAR_PERSONAS = Object.keys(SOURCES)
  // Keys 10-24 are integer-like, so object order would list them before 01-09.
  .sort()
  .map((key) => ({
    value: AVATAR_PERSONA_PREFIX + key,
    src: assetSrc(SOURCES[key] as string | { src: string }),
  }));

/** The image for a `persona:NN` value; null for anything else or an unknown number. */
export function parseAvatarPersona(value?: string | null): string | null {
  if (!value?.startsWith(AVATAR_PERSONA_PREFIX)) return null;
  const asset = SOURCES[value.slice(AVATAR_PERSONA_PREFIX.length)];
  return asset ? assetSrc(asset) : null;
}
