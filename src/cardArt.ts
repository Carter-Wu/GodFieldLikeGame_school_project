// Loads card artwork (the `cards.image_url` column -- see
// scripts/card-art.js and supabase/migrations/*_card_images.sql) into
// Phaser textures, for the card gallery and the battle screen.
//
// Artwork is always optional and loaded after a scene is already on screen:
// a card whose image is missing, slow, or fails to load just keeps its
// category icon.

import type Phaser from "phaser";
import type { CatalogCardEntry } from "./model/catalog.ts";

// Card art is drawn at 4:3; SVGs are rasterized at this size so they stay
// sharp in the largest place they're shown (the round recap).
const SVG_TEXTURE_SIZE = { width: 480, height: 360 };

export function cardArtKey(cardId: string): string {
  return `card-art-${cardId}`;
}

// The texture key for a card's artwork if it's loaded, else null. Accepts a
// catalog id -- a card instance's `cardId`, or a catalog card's `id`.
export function loadedArtKey(scene: Phaser.Scene, cardId: string | null | undefined): string | null {
  if (!cardId) return null;
  const key = cardArtKey(cardId);
  return scene.textures.exists(key) ? key : null;
}

// Queue the artwork of every given catalog card that isn't loaded yet, and
// call onLoaded() once they're in (only if something was queued and the
// scene is still running).
export function loadCardArt(scene: Phaser.Scene, cards: CatalogCardEntry[], onLoaded: () => void): void {
  const pending = cards.filter((card) => card.imageUrl && !scene.textures.exists(cardArtKey(card.id)));
  if (pending.length === 0) return;

  scene.load.setCORS("anonymous"); // Storage URLs are on another origin
  for (const card of pending) {
    const key = cardArtKey(card.id);
    if (/\.svg($|\?)/i.test(card.imageUrl as string)) scene.load.svg(key, card.imageUrl as string, SVG_TEXTURE_SIZE);
    else scene.load.image(key, card.imageUrl as string);
  }

  const onError = (file: { key: string; url: string }): void =>
    console.warn(`[card art] Couldn't load "${file.key}" (${file.url})`);
  scene.load.on("loaderror", onError);
  scene.load.once("complete", () => {
    scene.load.off("loaderror", onError);
    if (scene.sys.isActive()) onLoaded();
  });
  scene.load.start();
}
