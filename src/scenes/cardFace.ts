// One card drawn as a Phaser container: artwork box on top (the card's art
// if loaded, else its category icon), then its category, name and effect
// text. Used for the hand and for the big card in the round recap.

import type Phaser from "phaser";
import { COLORS, TEXT, FONT_FAMILY, roundedRect } from "./theme.ts";
import { CARD_ICON_KEY, ULTIMATE_ICON_KEY, damageAccentColor } from "../phaserIcons.ts";
import { loadedArtKey } from "../cardArt.ts";
import type { DamageType } from "../model/damageTypes.ts";

// card: { cardId, category, name, damageType, description } -- a hand card
// instance plus its describeCard() text, or a fighter's lastAction. The
// category "ultimate" draws the gold ultimate card.
export interface CardFaceData {
  cardId?: string | null;
  category: string;
  name?: string | null;
  damageType?: DamageType | null;
  description?: string | null;
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

  const accent = damageAccentColor(card.damageType ?? undefined);
  if (accent !== null) {
    container.add(scene.add.circle(pad + artW - 9 * scale, pad + 9 * scale, 5 * scale, accent).setStrokeStyle(1.5, COLORS.background));
  }

  const px = (n: number): string => `${Math.round(n * scale)}px`;
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
