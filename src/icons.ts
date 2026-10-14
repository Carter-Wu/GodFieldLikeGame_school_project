// Simple hand-authored SVG icons for cards, classes, and the ultimate --
// there's still no illustrated artwork (see README's "Card art" note), just a
// small pictographic layer so each of these has *something* visual beyond
// text.
//
// This is UI-only (produces markup strings), so it lives alongside the UI
// rather than in src/model/, which stays DOM-free.

import { DAMAGE_TYPE, type DamageType } from "./model/damageTypes.ts";
import { CARD_CATEGORY, type CardCategory } from "./model/cardTypes.ts";

export const DAMAGE_TYPE_ACCENT: Record<DamageType, string> = {
  [DAMAGE_TYPE.PHYSICAL]: "#c9c9c9",
  [DAMAGE_TYPE.MAGIC]: "#b388ff",
  [DAMAGE_TYPE.ELEMENT]: "#ff9d4d",
  [DAMAGE_TYPE.TRUE]: "#ffe066",
};

// Inner SVG markup (no outer <svg> tag) for each card category's base icon:
// a sword for attack, a shield for defend, an upward spark for buff, and a
// downward drain for debuff.
const CATEGORY_ICON_BODY: Record<CardCategory, string> = {
  [CARD_CATEGORY.ATTACK]: `
    <path d="M12 2 L14 4 L13 14 L11 14 L10 4 Z" fill="#fff"/>
    <rect x="8" y="14" width="8" height="2" rx="1" fill="#fff"/>
    <rect x="11" y="16" width="2" height="5" rx="1" fill="#fff"/>
    <circle cx="12" cy="21.5" r="1.3" fill="#fff"/>
  `,
  [CARD_CATEGORY.DEFEND]: `
    <path d="M12 2 L20 5 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V5 Z" fill="#fff" opacity="0.92"/>
  `,
  [CARD_CATEGORY.BUFF]: `
    <path d="M12 3 L19 12 H15 V21 H9 V12 H5 Z" fill="#fff"/>
    <circle cx="18" cy="5" r="1.4" fill="#fff"/>
    <circle cx="6" cy="7" r="1" fill="#fff"/>
  `,
  [CARD_CATEGORY.DEBUFF]: `
    <path d="M12 21 L5 12 H9 V3 H15 V12 H19 Z" fill="#fff"/>
    <ellipse cx="12" cy="22.6" rx="3" ry="1" fill="#fff" opacity="0.6"/>
  `,
};

// Build the <svg> markup for one card: its category's base shape, plus a
// damage-type accent dot for attack/defend cards (buff/debuff aren't typed by
// damage, so they don't get one).
export function cardIconMarkup(card: { category: CardCategory; damageType?: DamageType }): string {
  const body = CATEGORY_ICON_BODY[card.category] ?? "";
  const isTyped = card.category === CARD_CATEGORY.ATTACK || card.category === CARD_CATEGORY.DEFEND;
  const accent = isTyped && card.damageType ? DAMAGE_TYPE_ACCENT[card.damageType] : null;
  const dot = accent
    ? `<circle cx="19.5" cy="4.5" r="2.6" fill="${accent}" stroke="#1e2230" stroke-width="0.8"/>`
    : "";
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}${dot}</svg>`;
}

// --- class icons -----------------------------------------------------------
//
// One emblem per class id, shown on the class-select card and the fighter
// panel heading. Keyed by classDef.id rather than name so it survives a
// rename; a class with no entry here just renders no icon.

const CLASS_ICON_BODY: Record<string, string> = {
  // A shield with a small crest, in the same blue as defend cards -- fits
  // Guardian's tanky/defend-leaning theme.
  guardian: `
    <path d="M12 2 L20 5 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V5 Z" fill="#fff" opacity="0.92"/>
    <path d="M12 6.5 L12 16.5" stroke="#2f6f8f" stroke-width="1.6"/>
    <circle cx="12" cy="9.5" r="1.7" fill="#2f6f8f"/>
  `,
  // A two-tone flame, warm orange over a pale gold core -- fits Pyromancer's
  // elemental/aggressive theme.
  pyromancer: `
    <path d="M12 2 C8 7 6 10 6 13.5 C6 17.6 8.7 21 12 21 C15.3 21 18 17.6 18 13.5
             C18 11.8 17.3 10.2 16 9 C16.2 11 15.2 12.3 14 12.8
             C14.6 10.5 13.6 8 12 2 Z" fill="#ff9d4d"/>
    <path d="M12 9 C10.3 12 9.7 13.6 9.7 15.2 C9.7 17.1 10.7 18.5 12 18.5
             C13.3 18.5 14.3 17.1 14.3 15.2 C14.3 14.3 14 13.5 13.4 12.8
             C13.2 13.6 12.7 14.1 12.2 14.2 C12.6 12.9 12.3 11.5 12 9 Z" fill="#ffe066"/>
  `,
};

// Returns "" (no icon) for a class id that isn't in CLASS_ICON_BODY, rather
// than throwing -- a new class just quietly renders without one until an
// icon is added for it.
export function classIconMarkup(classDef: { id: string }): string {
  const body = CLASS_ICON_BODY[classDef.id];
  if (!body) return "";
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
}

// --- ultimate icon -----------------------------------------------------------
//
// A single generic "burst" icon shared by every class's ultimate. Each class
// doesn't get its own ultimate icon (the way it gets its own class icon)
// because the ultimate's actual design/theme is still an open question --
// see docs/DESIGN.md ("name it something related to all in aspect maybe").

const ULTIMATE_ICON_BODY = `
  <path d="M12 1 L14 8 L21 6 L16 11.5 L22 15 L14.5 15 L15.5 22 L12 16.5
           L8.5 22 L9.5 15 L2 15 L8 11.5 L3 6 L10 8 Z" fill="#ffce54"/>
  <circle cx="12" cy="12" r="2.6" fill="#fff8e1"/>
`;

export function ultimateIconMarkup(): string {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ULTIMATE_ICON_BODY}</svg>`;
}
