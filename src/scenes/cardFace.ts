// One card drawn as a Phaser container: artwork box on top (the card's art
// if loaded, else its category icon), then its category, name and effect
// text. Used for the hand and for the big card in the round recap.

import type Phaser from "phaser";
import { COLORS, TEXT, FONT_FAMILY, roundedRect } from "./theme.ts";
import { CARD_ICON_KEY, ULTIMATE_ICON_KEY, damageAccentColor, elementAccentColor } from "../phaserIcons.ts";
import { loadedArtKey } from "../cardArt.ts";
import { cardCost, type Card } from "../model/cardTypes.ts";
import { describeCard, type LastAction } from "../model/engine.ts";
import type { DamageType, Element } from "../model/damageTypes.ts";

export const AP_GEM_COLOR = 0x2f7fd0;

// card: { cardId, category, name, damageType, description } -- a hand card
// instance plus its describeCard() text, or a fighter's lastAction. The
// category "ultimate" draws the gold ultimate card.
export interface CardFaceData {
  cardId?: string | null;
  category: string;
  name?: string | null;
  damageType?: DamageType | null;
  element?: Element | null;
  cost?: number | null; // AP cost, drawn as a gem in the corner
  description?: string | null;
}

// Face data for a card instance (hand, arena slot, commit flight).
export function cardFaceData(card: Card): CardFaceData {
  return {
    cardId: card.cardId,
    category: card.category,
    name: card.name,
    damageType: "damageType" in card ? card.damageType : null,
    element: card.element ?? null,
    cost: cardCost(card),
    description: describeCard(card),
  };
}

// Face data for a resolved action (a fighter's lastAction): the card it
// played, the gold ultimate card, or a plain "Rest" card.
export function actionFace(action: LastAction, ultimateName: string): CardFaceData {
  if (action.kind === "ultimate") {
    return { category: "ultimate", name: ultimateName, description: `${action.damage ?? 0} damage` };
  }
  if (action.kind === "rest") return { category: "rest", name: "Rest", description: `+${action.apGained ?? 0} AP` };
  return {
    cardId: action.cardId,
    category: action.category ?? "",
    name: action.name,
    damageType: action.damageType,
    element: action.element ?? null,
    cost: action.cost ?? null,
    description: action.description,
  };
}

export function drawCardFace(
  scene: Phaser.Scene,
  card: CardFaceData,
  w: number,
  h: number,
  { scale = 1 }: { scale?: number } = {}
): { container: Phaser.GameObjects.Container; bg: Phaser.GameObjects.Graphics } {
  const container = scene.add.container(0, 0);
  const isUltimate = card.category === "ultimate";
  const color = isUltimate
    ? COLORS.ultimate
    : ((COLORS.card as Record<string, number>)[card.category] ?? COLORS.panel);

  const bg = roundedRect(scene, w, h, color, 10 * scale);
  container.add(bg);

  // Artwork box, 4:3 like the art itself.
  const pad = 6 * scale;
  const artW = w - pad * 2;
  const artH = Math.round(artW * 0.75);
  const box = scene.add.graphics();
  box.fillStyle(COLORS.background, 0.45);
  box.fillRoundedRect(pad, pad, artW, artH, 7 * scale);
  container.add(box);

  const artKey = loadedArtKey(scene, card.cardId);
  const iconKey = isUltimate ? ULTIMATE_ICON_KEY : (CARD_ICON_KEY as Record<string, string>)[card.category];
  if (artKey) {
    container.add(scene.add.image(pad + artW / 2, pad + artH / 2, artKey).setDisplaySize(artW - 2, artH - 2));
  } else if (iconKey && scene.textures.exists(iconKey)) {
    const size = Math.min(artW, artH) * 0.5;
    container.add(scene.add.image(pad + artW / 2, pad + artH / 2, iconKey).setDisplaySize(size, size));
  }

  const accent = elementAccentColor(card.element) ?? damageAccentColor(card.damageType ?? undefined);
  if (accent !== null) {
    container.add(scene.add.circle(pad + artW - 9 * scale, pad + 9 * scale, 5 * scale, accent).setStrokeStyle(1.5, COLORS.background));
  }

  const px = (n: number): string => `${Math.round(n * scale)}px`;

  // AP cost gem, top-left over the art.
  if (card.cost !== null && card.cost !== undefined && !isUltimate) {
    const gx = pad + 11 * scale;
    const gy = pad + 11 * scale;
    container.add(scene.add.circle(gx, gy, 10 * scale, AP_GEM_COLOR).setStrokeStyle(2 * scale, COLORS.background));
    container.add(
      scene.add
        .text(gx, gy, String(card.cost), { fontFamily: FONT_FAMILY, fontSize: px(12), fontStyle: "800", color: TEXT.white })
        .setOrigin(0.5)
    );
  }
  let y = pad + artH + 4 * scale;
  container.add(
    scene.add
      .text(w / 2, y, isUltimate ? "ULTIMATE" : card.category.toUpperCase(), {
        fontFamily: FONT_FAMILY,
        fontSize: px(9),
        color: TEXT.white,
      })
      .setOrigin(0.5, 0)
      .setAlpha(0.75)
  );
  y += 13 * scale;

  container.add(
    scene.add
      .text(w / 2, y, card.name ?? "", {
        fontFamily: FONT_FAMILY,
        fontSize: px(13),
        fontStyle: "700",
        color: TEXT.white,
        align: "center",
        wordWrap: { width: w - 10 * scale },
      })
      .setOrigin(0.5, 0)
  );

  if (card.description) {
    container.add(
      scene.add
        .text(w / 2, h - 6 * scale, card.description, {
          fontFamily: FONT_FAMILY,
          fontSize: px(10),
          color: TEXT.white,
          align: "center",
          wordWrap: { width: w - 10 * scale },
        })
        .setOrigin(0.5, 1)
        .setAlpha(0.9)
    );
  }

  return { container, bg };
}
