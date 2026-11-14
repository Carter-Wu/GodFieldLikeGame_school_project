// Stat icons + colours shared by the lobby inspector (ClassSelect.tsx) and
// the battle HUD (BattleScene's stat badges), so a stat looks the same
// everywhere. Each icon is the inner markup of a 24x24 SVG drawn in
// currentColor.

import type { StatKey } from "./model/stats.ts";

export interface StatStyle {
  label: string;
  name: string;
  color: string;
  icon: string;
}

export const STAT_STYLE: Record<"hp" | "def" | "mr" | "er" | "ur" | "atk", StatStyle> = {
  hp: {
    label: "HP",
    name: "Health",
    color: "#ef5b63",
    icon: '<path d="M12 21 C5 15.5 2.5 12.3 2.5 8.6 A4.9 4.9 0 0 1 12 6.4 A4.9 4.9 0 0 1 21.5 8.6 C21.5 12.3 19 15.5 12 21 Z" fill="currentColor"/>',
  },
  def: {
    label: "DEF",
    name: "Physical defense",
    color: "#8fb3e0",
    icon: '<path d="M12 2 L20 5 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V5 Z" fill="currentColor"/><path d="M12 5.5 V18.5" stroke="#0b0d13" stroke-width="1.6"/>',
  },
  mr: {
    label: "MR",
    name: "Magic resist",
    color: "#5fdbe6",
    icon: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 5 L17 15 H7 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>',
  },
  er: {
    label: "ER",
    name: "Element resist",
    color: "#f2c95c",
    icon: '<path d="M13.5 2 L5 13.5 H11 L10 22 L19 10 H13 Z" fill="currentColor"/>',
  },
  ur: {
    label: "UR",
    name: "Ultimate regen",
    color: "#ffb347",
    icon: '<path d="M12 2 C13 6 17.5 8 17.5 13.5 A5.5 5.5 0 0 1 6.5 13.5 C6.5 10.5 8.5 9 9.5 6.5 C10.5 9 11.5 9.5 12 2 Z" fill="currentColor"/><path d="M12 12.5 C13 14 14.2 14.8 14.2 16.4 A2.2 2.2 0 0 1 9.8 16.4 C9.8 15 11 14 12 12.5 Z" fill="#0b0d13"/>',
  },
  atk: {
    label: "ATK",
    name: "Attack",
    color: "#ff7a6b",
    icon: '<path d="M20.5 3.5 L19.8 8 L10.2 17.6 L6.4 13.8 L16 4.2 Z" fill="currentColor"/><path d="M4.2 13.6 L10.4 19.8 L9 21.2 L2.8 15 Z" fill="currentColor"/><path d="M5.6 18.4 L3 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  },
};

export type StyledStat = keyof typeof STAT_STYLE;

export const isStyledStat = (key: StatKey): key is StyledStat => key in STAT_STYLE;

// A standalone SVG for one stat's icon, filled with the stat's colour
// (or `color`), for rasterizing into a Phaser texture.
export function statIconMarkup(key: StyledStat, color = STAT_STYLE[key].color): string {
  const body = STAT_STYLE[key].icon.split("currentColor").join(color);
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
