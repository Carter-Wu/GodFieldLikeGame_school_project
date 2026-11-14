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

// Card art is usually a big image (1024px+) shown in a ~170px window. Let
// the GPU shrink it and every fine line aliases ("jaggy" art). Instead,
// resample it once on a 2D canvas -- halving in steps with high-quality
// smoothing, which averages properly -- to exactly the device pixels it
// covers, cropped to the window's shape. Cached per size.
export function sizedArtKey(scene: Phaser.Scene, key: string, width: number, height: number): string {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const sizedKey = `${key}@${w}x${h}`;
  if (scene.textures.exists(sizedKey)) return sizedKey;

  const src = scene.textures.get(key).getSourceImage() as CanvasImageSource & { width: number; height: number };
  // Cover crop: the largest centered region with the window's aspect ratio.
  const ratio = w / h;
  let sw = src.width;
  let sh = src.height;
  if (sw / sh > ratio) sw = sh * ratio;
  else sh = sw / ratio;
  const sx = (src.width - sw) / 2;
  const sy = (src.height - sh) / 2;

  let canvas = document.createElement("canvas");
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  let ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  while (canvas.width / 2 >= w && canvas.height / 2 >= h) {
    const half = document.createElement("canvas");
    half.width = Math.round(canvas.width / 2);
    half.height = Math.round(canvas.height / 2);
    const hctx = half.getContext("2d") as CanvasRenderingContext2D;
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(canvas, 0, 0, half.width, half.height);
    canvas = half;
    ctx = hctx;
  }
  const texture = scene.textures.createCanvas(sizedKey, w, h);
  if (!texture) return key;
  const out = texture.getContext();
  out.imageSmoothingEnabled = true;
  out.imageSmoothingQuality = "high";
  out.drawImage(canvas, 0, 0, w, h);
  texture.refresh();
  void ctx;
  return sizedKey;
}
