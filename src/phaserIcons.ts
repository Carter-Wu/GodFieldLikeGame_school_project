// Bridges the hand-authored SVG markup in src/icons.ts (plain DOM-agnostic
// strings) into Phaser textures, so the existing icon art is reused as-is
// instead of being re-implemented with Graphics draw calls: each <svg>
// string is base64-encoded into a data URI and loaded through Phaser's SVG
// loader, which rasterizes it into a texture at load time.

import type Phaser from "phaser";
import { cardIconMarkup, classIconMarkup, ultimateIconMarkup, DAMAGE_TYPE_ACCENT } from "./icons.ts";
import { CARD_CATEGORY, type CardCategory } from "./model/cardTypes.ts";
import type { DamageType } from "./model/damageTypes.ts";
import type { ClassDef } from "./model/classes.ts";

// Rasterized well above the largest on-screen icon size (~30px) so icons stay
// sharp once the camera is zoomed for HiDPI screens (see theme.js).
const ICON_TEXTURE_SIZE = 128;

export const CARD_ICON_KEY: Record<CardCategory, string> = {
  [CARD_CATEGORY.ATTACK]: "icon-card-attack",
  [CARD_CATEGORY.DEFEND]: "icon-card-defend",
  [CARD_CATEGORY.BUFF]: "icon-card-buff",
  [CARD_CATEGORY.DEBUFF]: "icon-card-debuff",
};

export const ULTIMATE_ICON_KEY = "icon-ultimate";

export function classIconKey(classId: string): string {
  return `icon-class-${classId}`;
}

function svgDataUri(markup: string): string {
  return `data:image/svg+xml;base64,${btoa(markup)}`;
}

function queueSvg(scene: Phaser.Scene, key: string, markup: string): void {
  if (!markup || scene.textures.exists(key)) return;
  scene.load.svg(key, svgDataUri(markup), { width: ICON_TEXTURE_SIZE, height: ICON_TEXTURE_SIZE });
}

// Queue every icon the UI can need. Call from a scene's preload() -- safe to
// call from multiple scenes/every scene restart since already-loaded keys
// are skipped rather than re-fetched.
export function preloadIcons(scene: Phaser.Scene, classDefs: ClassDef[]): void {
  for (const category of Object.values(CARD_CATEGORY)) {
    queueSvg(scene, CARD_ICON_KEY[category], cardIconMarkup({ category }));
  }
  queueSvg(scene, ULTIMATE_ICON_KEY, ultimateIconMarkup());
  for (const classDef of classDefs) {
    queueSvg(scene, classIconKey(classDef.id), classIconMarkup(classDef));
  }
}

// Hex string ("#c9c9c9") -> Phaser color number (0xc9c9c9), or null if the
// damage type has no accent (buff/debuff cards aren't typed by damage).
export function damageAccentColor(damageType: DamageType | undefined): number | null {
  if (!damageType) return null;
  const hex = DAMAGE_TYPE_ACCENT[damageType];
  return hex ? parseInt(hex.slice(1), 16) : null;
}
