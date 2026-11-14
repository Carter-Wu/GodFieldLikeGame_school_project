// One card drawn as a Phaser container, as a vector frame: AP cost gem and
// name along the top, the card's art (else its category icon) in the window,
// its category on a ribbon and its effect text in the box at the bottom. Used for the hand and for the big card in the
// round recap.

import Phaser from "phaser";
import { COLORS, FONT_FAMILY, RENDER_SCALE, roundedRect } from "./theme.ts";
import { CARD_ICON_KEY, ULTIMATE_ICON_KEY, damageAccentColor, elementAccentColor } from "../phaserIcons.ts";
import { loadedArtKey, sizedArtKey } from "../cardArt.ts";
import { cardCost, cardRarity, RARITY, type Card, type Rarity } from "../model/cardTypes.ts";
import { cardPriority, describeCard, ULTIMATE_PRIORITY, type PlayRecord } from "../model/engine.ts";
import type { DamageType, Element } from "../model/damageTypes.ts";

export const AP_GEM_COLOR = 0x2f7fd0;
export const AP_SHORT_COLOR = 0x8f2318; // a cost gem you can't pay right now
export const PLAYABLE_GLOW = 0x5fd4ff; // matches the AP crystals

// card: { cardId, category, name, damageType, description } -- a hand card
// instance plus its describeCard() text, or one of a fighter's plays. The
// category "ultimate" draws the gold ultimate card.
export interface CardFaceData {
  cardId?: string | null;
  category: string;
  name?: string | null;
  damageType?: DamageType | null;
  element?: Element | null;
  cost?: number | null; // AP cost, drawn as a gem in the corner
  costShort?: boolean; // not enough AP left for it: the gem turns red
  playable?: boolean; // can be played right now: a soft cyan glow round the card and its gem
  description?: string | null;
  priority?: number | null; // strike priority, drawn as a badge atop the description
  rarity?: Rarity | null; // rare / legend: a border inside the art window and a gem on the name plate
}

// Rarity colors (normal cards draw neither the edge nor the gem).
export const RARITY_COLOR: Record<Rarity, number> = {
  normal: 0xc9ccd2,
  rare: 0x4aa3ff,
  legend: 0xff9d1a,
};

// The priority badge's colors: amber, so it reads apart from the ivory text.
export const PRIORITY_BADGE_COLOR = 0xffb020;
const PRIORITY_TEXT_COLOR = "#2a1600";

// Face data for a card instance (hand, arena slot, commit flight).
export function cardFaceData(card: Card): CardFaceData {
  return {
    cardId: card.cardId,
    category: card.category,
    name: card.name,
    damageType: "damageType" in card ? card.damageType : null,
    element: card.element ?? null,
    cost: cardCost(card),
    description: describeCard(card, { priority: false }),
    priority: cardPriority(card),
    rarity: cardRarity(card),
  };
}

// Face data for one resolved play (from a fighter's lastTurn): the card, or
// the gold ultimate card.
export function actionFace(action: PlayRecord, ultimateName: string): CardFaceData {
  if (action.kind === "ultimate") {
    return { category: "ultimate", name: ultimateName, description: `${action.damage ?? 0} damage`, priority: action.priority ?? ULTIMATE_PRIORITY };
  }
  return {
    cardId: action.cardId,
    category: action.category ?? "",
    name: action.name,
    damageType: action.damageType,
    element: action.element ?? null,
    cost: action.cost ?? null,
    description: action.description,
    priority: action.priority ?? null,
    rarity: action.rarity ?? null,
  };
}

// Card layout, in units of a 143x192 hand card: the card is vector-drawn
// (Graphics + text at the camera's resolution) so it stays sharp at every
// size -- hand, hover, arena slot, the big preview and the round recap.
// The AP gem and the name sit at the top LEFT, the part of each card that
// stays visible when the hand fans out and cards overlap on the right.
export const CARD_UNIT = { w: 143, h: 192 };
const LAYOUT = {
  radius: 9,
  inset: 4.5, // inner hairline
  plate: { y: 6, h: 25 }, // gem + name
  gem: { x: 17, y: 18.5, r: 11.5 },
  art: { x: 7, y: 33, h: 80 },
  banner: { y: 116, h: 15 },
  text: { x: 7, y: 135, bottom: 7 },
};

// Card fonts (loaded from Google Fonts in index.html), each with fallbacks
// for while they load or if they can't: the display serif for names and
// banners, a geometric sans for numbers, Inter for rules text.
export const CARD_FONT = {
  title: "Cinzel, 'Trajan Pro', Georgia, serif",
  cost: "Outfit, Inter, 'Arial Black', sans-serif",
  body: FONT_FAMILY,
};

const GOLD = 0xe2c588;
const CARD_INK = 0x14161c;
const TEXT_BOX_INK = 0x0a0b0f;

// Shrink a text object (never grow it) until it fits in maxW x maxH.
function fit(text: Phaser.GameObjects.Text, maxW: number, maxH: number): Phaser.GameObjects.Text {
  const s = Math.min(1, maxW / Math.max(1, text.width), maxH / Math.max(1, text.height));
  return text.setScale(s);
}

// Lighten (amount > 0) or darken (amount < 0) a 0xRRGGBB colour.
function shade(color: number, amount: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  const t = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  return Phaser.Display.Color.GetColor(
    Math.round(c.red + (t - c.red) * k),
    Math.round(c.green + (t - c.green) * k),
    Math.round(c.blue + (t - c.blue) * k)
  );
}

export function drawCardFace(
  scene: Phaser.Scene,
  card: CardFaceData,
  w: number,
  h: number,
  _opts: { scale?: number } = {}
): { container: Phaser.GameObjects.Container; bg: Phaser.GameObjects.Graphics; glow: Phaser.GameObjects.Graphics | null } {
  void _opts; // sizes follow w/h now; kept so callers don't change
  const container = scene.add.container(0, 0);
  const isUltimate = card.category === "ultimate";
  const color = isUltimate
    ? COLORS.ultimate
    : ((COLORS.card as Record<string, number>)[card.category] ?? COLORS.panel);

  // Units: ux/uy across/down a 143x192 card; u (the smaller) for type and
  // strokes, so a stretched card never gets fat or thin lines.
  const ux = w / CARD_UNIT.w;
  const uy = h / CARD_UNIT.h;
  const u = Math.min(ux, uy);
  const px = (n: number): string => `${Math.max(1, Math.round(n * 10) / 10)}px`;
  // Card text renders at a bit over the camera's resolution so the hover
  // zoom (1.12x) doesn't soften it.
  const res = RENDER_SCALE * 1.5;
  const text = (x: number, y: number, str: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text =>
    scene.add.text(x, y, str, { resolution: res, ...style });

  // Body: the click target (callers wire it up) is the dark card itself.
  const radius = LAYOUT.radius * u;
  const bg = roundedRect(scene, w, h, CARD_INK, radius);
  container.add(bg);

  // Playable now: a soft AP-cyan glow just outside the card (behind it).
  let glow: Phaser.GameObjects.Graphics | null = null;
  if (card.playable) {
    glow = scene.add.graphics();
    for (let i = 1; i <= 4; i++) {
      glow.lineStyle(2.5 * u, PLAYABLE_GLOW, 0.34 - i * 0.07);
      glow.strokeRoundedRect(-i * 1.6 * u, -i * 1.6 * u, w + i * 3.2 * u, h + i * 3.2 * u, radius + i * 1.6 * u);
    }
    container.addAt(glow, 0);
  }

  const g = scene.add.graphics();
  // Category wash, strongest at the top.
  g.fillStyle(color, 0.34);
  g.fillRoundedRect(0, 0, w, h, radius);
  g.fillStyle(CARD_INK, 0.45);
  g.fillRoundedRect(0, h * 0.55, w, h * 0.45, { tl: 0, tr: 0, bl: radius, br: radius });
  // Frame: a gold outer edge and a thin category-coloured inner hairline.
  g.lineStyle(Math.max(1, 1.6 * u), card.playable ? 0xbff0ff : isUltimate ? 0xffd86b : GOLD, 0.95);
  g.strokeRoundedRect(0.8 * u, 0.8 * u, w - 1.6 * u, h - 1.6 * u, radius);
  const inset = LAYOUT.inset * u;
  g.lineStyle(Math.max(1, 0.9 * u), shade(color, 0.35), 0.55);
  g.strokeRoundedRect(inset, inset, w - inset * 2, h - inset * 2, Math.max(2, radius - inset * 0.7));
  container.add(g);

  // Art window: the card's art cropped to fit, else its category icon on a
  // tint of the category colour.
  const art = {
    x: LAYOUT.art.x * ux,
    y: LAYOUT.art.y * uy,
    w: w - LAYOUT.art.x * ux * 2,
    h: LAYOUT.art.h * uy,
  };
  const artKey = loadedArtKey(scene, card.cardId);
  const iconKey = isUltimate ? ULTIMATE_ICON_KEY : (CARD_ICON_KEY as Record<string, string>)[card.category];
  const artBg = scene.add.graphics();
  artBg.fillStyle(shade(color, -0.55), 1);
  artBg.fillRoundedRect(art.x, art.y, art.w, art.h, 4 * u);
  artBg.fillStyle(color, 0.38);
  artBg.fillRoundedRect(art.x, art.y, art.w, art.h * 0.7, { tl: 4 * u, tr: 4 * u, bl: 0, br: 0 });
  container.add(artBg);
  if (artKey) {
    // Pre-resampled to the window's device pixels (cardArt.sizedArtKey), a
    // touch over so the hover zoom stays sharp: no GPU minification shimmer.
    const density = RENDER_SCALE * 1.15;
    const sized = sizedArtKey(scene, artKey, art.w * density, art.h * density);
    container.add(scene.add.image(art.x, art.y, sized).setOrigin(0).setDisplaySize(art.w, art.h));
  } else if (iconKey && scene.textures.exists(iconKey)) {
    const size = Math.min(art.w, art.h) * 0.58;
    container.add(scene.add.image(art.x + art.w / 2, art.y + art.h / 2, iconKey).setDisplaySize(size, size));
  }

  // Rare and legend cards: a border in the rarity's colour just inside the
  // art window (normal cards get a faint gold one).
  const rarity = card.rarity ?? RARITY.NORMAL;
  const artEdge = scene.add.graphics();
  if (rarity !== RARITY.NORMAL) {
    const lw = Math.max(1.5, (rarity === RARITY.LEGEND ? 2.6 : 2) * u);
    artEdge.lineStyle(lw, RARITY_COLOR[rarity], 1);
    artEdge.strokeRoundedRect(art.x + lw / 2, art.y + lw / 2, art.w - lw, art.h - lw, 4 * u);
  } else {
    artEdge.lineStyle(Math.max(1, 0.8 * u), GOLD, 0.45);
    artEdge.strokeRoundedRect(art.x, art.y, art.w, art.h, 4 * u);
  }
  container.add(artEdge);

  // Damage type / element dot, bottom left of the art.
  const accent = elementAccentColor(card.element) ?? damageAccentColor(card.damageType ?? undefined);
  if (accent !== null) {
    const dot = scene.add.graphics();
    dot.fillStyle(accent, 1);
    dot.fillCircle(art.x + 8 * u, art.y + art.h - 8 * u, 4.2 * u);
    dot.lineStyle(Math.max(1, 1.2 * u), 0x000000, 0.8);
    dot.strokeCircle(art.x + 8 * u, art.y + art.h - 8 * u, 4.2 * u);
    container.add(dot);
  }

  // AP cost gem, top left (red when this turn's AP can't pay for it).
  let nameLeft = 8 * ux;
  if (card.cost !== null && card.cost !== undefined && !isUltimate) {
    const gx = LAYOUT.gem.x * ux;
    const gy = LAYOUT.gem.y * uy;
    const r = LAYOUT.gem.r * u;
    const gemColor = card.costShort ? AP_SHORT_COLOR : AP_GEM_COLOR;
    const gem = scene.add.graphics();
    if (card.playable) {
      gem.fillStyle(PLAYABLE_GLOW, 0.22);
      gem.fillCircle(gx, gy, r + 5 * u);
      gem.fillStyle(PLAYABLE_GLOW, 0.3);
      gem.fillCircle(gx, gy, r + 2.6 * u);
    }
    gem.fillStyle(0x000000, 0.45);
    gem.fillCircle(gx, gy + 1.2 * u, r + 1.5 * u);
    gem.fillStyle(shade(gemColor, -0.35), 1);
    gem.fillCircle(gx, gy, r);
    gem.fillStyle(gemColor, 1);
    gem.fillCircle(gx, gy - 0.8 * u, r * 0.84);
    gem.fillStyle(0xffffff, 0.22);
    gem.fillEllipse(gx, gy - r * 0.42, r * 1.1, r * 0.5);
    gem.lineStyle(Math.max(1, 1.4 * u), card.costShort ? 0xff8a7a : 0xbfe0ff, 1);
    gem.strokeCircle(gx, gy, r);
    container.add(gem);
    container.add(
      text(gx, gy, String(card.cost), {
        fontFamily: CARD_FONT.cost,
        fontSize: px(15.5 * u),
        fontStyle: "700",
        color: card.costShort ? "#ffd2cc" : "#ffffff",
        stroke: card.costShort ? "#3a0904" : "#06121f",
        strokeThickness: Math.max(1, 2 * u),
      }).setOrigin(0.5)
    );
    nameLeft = gx + r + 4.5 * ux;
  }

  // Name, on the plate right of the gem: ivory caps, shrunk to fit.
  const plateY = LAYOUT.plate.y * uy;
  const plateH = LAYOUT.plate.h * uy;
  const nameW = w - nameLeft - 8 * ux;
  container.add(
    fit(
      text(nameLeft, plateY + plateH / 2, (card.name ?? "").toUpperCase(), {
        fontFamily: CARD_FONT.title,
        fontSize: px(11.5 * u),
        fontStyle: "700",
        color: isUltimate ? "#fff1c2" : "#f7efdc",
      })
        .setShadow(0, Math.max(1, u), "#000000", 2 * u, false, true)
        .setOrigin(0, 0.5),
      nameW,
      plateH
    )
  );

  // Category ribbon under the art (with the rarity gem at its left end).
  const bannerY = LAYOUT.banner.y * uy;
  const bannerH = LAYOUT.banner.h * uy;
  const label = text(w / 2, bannerY + bannerH / 2, isUltimate ? "ULTIMATE" : card.category.toUpperCase(), {
    fontFamily: CARD_FONT.title,
    fontSize: px(8.5 * u),
    fontStyle: "700",
    color: "#ffffff",
    letterSpacing: 1.6 * u,
  }).setOrigin(0.5);
  const gemW = rarity !== RARITY.NORMAL ? 10 * u : 0;
  const ribbonW = Math.min(art.w, label.width + 18 * u + gemW);
  const ribbonX = (w - ribbonW) / 2;
  const ribbon = scene.add.graphics();
  ribbon.fillStyle(shade(color, -0.1), 1);
  ribbon.fillRoundedRect(ribbonX, bannerY, ribbonW, bannerH, bannerH / 2);
  ribbon.lineStyle(Math.max(1, 0.8 * u), shade(color, 0.45), 0.9);
  ribbon.strokeRoundedRect(ribbonX, bannerY, ribbonW, bannerH, bannerH / 2);
  container.add(ribbon);
  label.setX(w / 2 + gemW / 2);
  container.add(fit(label, ribbonW - 12 * u - gemW, bannerH));
  if (rarity !== RARITY.NORMAL) {
    const rc = RARITY_COLOR[rarity];
    const gr = bannerH * 0.36;
    const gx = ribbonX + 6 * u + gr;
    const gy = bannerY + bannerH / 2;
    const gem = scene.add.graphics();
    gem.fillStyle(rc, 1);
    gem.lineStyle(Math.max(1, 1 * u), 0x111111, 1);
    const pts = [
      new Phaser.Math.Vector2(gx, gy - gr),
      new Phaser.Math.Vector2(gx + gr * 0.8, gy),
      new Phaser.Math.Vector2(gx, gy + gr),
      new Phaser.Math.Vector2(gx - gr * 0.8, gy),
    ];
    gem.fillPoints(pts, true);
    gem.strokePoints(pts, true);
    container.add(gem);
  }

  // Rules text: white on a near-black box, big enough to read in the hand,
  // with the strike priority (if any) on an amber badge at its top.
  const priority = card.priority ?? null;
  if (card.description || priority !== null) {
    const box = {
      x: LAYOUT.text.x * ux,
      y: LAYOUT.text.y * uy,
      w: w - LAYOUT.text.x * ux * 2,
      h: h - LAYOUT.text.y * uy - LAYOUT.text.bottom * uy,
    };
    const pad = 4 * u;
    const panel = scene.add.graphics();
    panel.fillStyle(TEXT_BOX_INK, 0.92);
    panel.fillRoundedRect(box.x, box.y, box.w, box.h, 4 * u);
    panel.lineStyle(Math.max(1, 0.8 * u), 0xffffff, 0.08);
    panel.strokeRoundedRect(box.x, box.y, box.w, box.h, 4 * u);
    container.add(panel);

    let textTop = box.y + pad * 0.5;
    if (priority !== null) {
      const badgeH = 12 * u;
      const badgeY = box.y + pad * 0.75;
      const plabel = text(box.x + box.w / 2, badgeY + badgeH / 2, `PRIORITY ${priority}`, {
        fontFamily: CARD_FONT.cost,
        fontSize: px(8.5 * u),
        fontStyle: "700",
        color: PRIORITY_TEXT_COLOR,
        letterSpacing: 0.6 * u,
      }).setOrigin(0.5);
      fit(plabel, box.w * 0.75, badgeH);
      const badgeW = plabel.displayWidth + 12 * u;
      const badge = scene.add.graphics();
      badge.fillStyle(PRIORITY_BADGE_COLOR, 1);
      badge.fillRoundedRect(box.x + (box.w - badgeW) / 2, badgeY, badgeW, badgeH, badgeH / 2);
      container.add([badge, plabel]);
      textTop = badgeY + badgeH;
    }

    if (card.description) {
      const textH = box.y + box.h - textTop;
      container.add(
        fit(
          text(box.x + box.w / 2, textTop + textH / 2, card.description, {
            fontFamily: CARD_FONT.body,
            fontSize: px(11.5 * u),
            fontStyle: "700",
            color: "#ffffff",
            align: "center",
            lineSpacing: 0,
            wordWrap: { width: box.w - pad * 2 },
          }).setOrigin(0.5),
          box.w - pad * 2,
          textH - pad
        )
      );
    }
  }

  return { container, bg, glow };
}
