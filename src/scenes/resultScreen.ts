// Drawing helpers for the end-of-game screen (VICTORY / DEFEAT / DRAW):
// the blurred battlefield behind it, the charcoal glass panel, the gold
// divider with its diamond, the summary line with highlighted numbers and
// the lobby-style buttons. BattleScene.showResult() puts them together.

import Phaser from "phaser";
import { FONT_NUM, FONT_UI, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, type Button } from "./theme.ts";

// Colors for each outcome: the title gradient, its glow, and the
// ornaments (dividers, panel edge).
export interface ResultTone {
  titleTop: string;
  titleBottom: string;
  glow: string;
  accent: number; // dividers, diamond, panel hairline
  accentCss: string;
}

export const RESULT_TONES: Record<"win" | "lose" | "draw", ResultTone> = {
  // Champagne gold, as on the title / login screens.
  win: { titleTop: "#fbeccb", titleBottom: "#c9a35e", glow: "#e2c588", accent: 0xe2c588, accentCss: "#e2c588" },
  // Deep crimson, calm rather than alarming.
  lose: { titleTop: "#e9a294", titleBottom: "#8f2a22", glow: "#b83a30", accent: 0xb65a4f, accentCss: "#c9786c" },
  // Steel grey.
  draw: { titleTop: "#eef1f5", titleBottom: "#8d939e", glow: "#a9b0bc", accent: 0xa9b0bc, accentCss: "#b9c0cb" },
};

export const RESULT_TEXT = {
  ivory: "#f2ead8",
  soft: "#d6d2c8",
  label: "#d9c9a3",
};

// A canvas texture drawn at RENDER_SCALE, replaced if it already exists.
function canvasTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): string {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const texture = scene.textures.createCanvas(key, Math.ceil(w * RENDER_SCALE), Math.ceil(h * RENDER_SCALE));
  if (!texture) return key;
  const ctx = texture.getContext();
  ctx.save();
  ctx.scale(RENDER_SCALE, RENDER_SCALE);
  draw(ctx);
  ctx.restore();
  texture.refresh();
  return key;
}

function hexToRgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;
}

// --- blurred battlefield ------------------------------------------------------

// A frosted copy of the board for the result screen's backdrop: grabs the
// current frame, blurs it (~`blur` layout px, by down/up-sampling like
// theme.addSoftBackground, so it works on every browser), darkens it and adds
// a vignette. Calls back with the image (already added to the scene), or
// with null if the snapshot isn't available.
export function addBlurredSnapshot(
  scene: Phaser.Scene,
  done: (image: Phaser.GameObjects.Image | null) => void,
  { blur = 8, dim = 0.5, vignette = 0.85 }: { blur?: number; dim?: number; vignette?: number } = {}
): void {
  const renderer = scene.game.renderer as Phaser.Renderer.Canvas.CanvasRenderer | Phaser.Renderer.WebGL.WebGLRenderer;
  if (typeof renderer.snapshot !== "function") {
    done(null);
    return;
  }
  renderer.snapshot((snap) => {
    if (!scene.sys.isActive() || !(snap instanceof HTMLImageElement)) {
      done(null);
      return;
    }
    const W = snap.width;
    const H = snap.height;
    const key = "result-backdrop";
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const texture = scene.textures.createCanvas(key, W, H);
    if (!texture) {
      done(null);
      return;
    }
    const ctx = texture.getContext();
    const k = Math.max(2, Math.round((blur * W) / GAME_WIDTH));
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(W / k));
    small.height = Math.max(1, Math.round(H / k));
    const sctx = small.getContext("2d") as CanvasRenderingContext2D;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(snap, 0, 0, small.width, small.height);
    let mid = small;
    while (mid.width * 2 <= W) {
      const next = document.createElement("canvas");
      next.width = mid.width * 2;
      next.height = mid.height * 2;
      const nctx = next.getContext("2d") as CanvasRenderingContext2D;
      nctx.imageSmoothingQuality = "high";
      nctx.drawImage(mid, 0, 0, next.width, next.height);
      mid = next;
    }
    ctx.imageSmoothingQuality = "high";
    const bleed = 0.02;
    ctx.drawImage(mid, -W * bleed, -H * bleed, W * (1 + bleed * 2), H * (1 + bleed * 2));
    ctx.fillStyle = `rgba(7, 7, 9, ${dim})`;
    ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.hypot(W, H) * 0.56);
    v.addColorStop(0, "rgba(4, 4, 6, 0)");
    v.addColorStop(0.55, `rgba(4, 4, 6, ${vignette * 0.4})`);
    v.addColorStop(1, `rgba(4, 4, 6, ${vignette})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    texture.refresh();
    done(scene.add.image(0, 0, key).setOrigin(0, 0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT));
  });
}

// --- glass panel ---------------------------------------------------------------

// The lobby / login glass card: warm charcoal body, a lighter sheen at the
// top, a thin hairline in the outcome's accent with a soft glow, and a
// faint inner frame. (x, y) is the top-left corner.
export function addResultPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  tone: ResultTone
): Phaser.GameObjects.Image {
  const pad = 40; // room for the shadow / glow around the card
  const r = 20;
  const key = canvasTexture(scene, "result-panel", w + pad * 2, h + pad * 2, (ctx) => {
    ctx.translate(pad, pad);
    // Drop shadow + accent glow.
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = "rgba(18, 17, 19, 0.86)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.shadowColor = hexToRgba(tone.accent, 0.22);
    ctx.shadowBlur = 30;
    ctx.strokeStyle = hexToRgba(tone.accent, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, w - 1, h - 1, r);
    ctx.stroke();
    ctx.restore();
    // Sheen: warm and a touch lighter at the top.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.clip();
    const sheen = ctx.createLinearGradient(0, 0, 0, h);
    sheen.addColorStop(0, "rgba(58, 52, 42, 0.42)");
    sheen.addColorStop(0.35, "rgba(30, 28, 26, 0.12)");
    sheen.addColorStop(1, "rgba(0, 0, 0, 0.18)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
    ctx.beginPath();
    ctx.moveTo(r, 1.5);
    ctx.lineTo(w - r, 1.5);
    ctx.stroke();
    ctx.restore();
    // Faint inner frame.
    ctx.strokeStyle = hexToRgba(tone.accent, 0.12);
    ctx.beginPath();
    ctx.roundRect(8.5, 8.5, w - 17, h - 17, r - 6);
    ctx.stroke();
  });
  return scene.add
    .image(x - pad, y - pad, key)
    .setOrigin(0, 0)
    .setDisplaySize(w + pad * 2, h + pad * 2);
}

// A thin divider centered on (cx, y): two hairlines fading out from a small
// diamond, as on the login / private room screens.
export function addDivider(scene: Phaser.Scene, cx: number, y: number, w: number, color: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x: cx, y });
  const half = w / 2;
  const gap = 14;
  const lineH = 1;
  g.fillGradientStyle(color, color, color, color, 0, 0.75, 0, 0.75);
  g.fillRect(-half, -lineH / 2, half - gap, lineH);
  g.fillGradientStyle(color, color, color, color, 0.75, 0, 0.75, 0);
  g.fillRect(gap, -lineH / 2, half - gap, lineH);
  // Diamond: a solid core inside a hairline outline.
  g.lineStyle(1, color, 0.8);
  g.strokePoints([new Phaser.Math.Vector2(0, -7), new Phaser.Math.Vector2(7, 0), new Phaser.Math.Vector2(0, 7), new Phaser.Math.Vector2(-7, 0)], true);
  g.fillStyle(color, 0.95);
  g.fillPoints([new Phaser.Math.Vector2(0, -3.5), new Phaser.Math.Vector2(3.5, 0), new Phaser.Math.Vector2(0, 3.5), new Phaser.Math.Vector2(-3.5, 0)], true);
  return g;
}

// --- summary line ----------------------------------------------------------------

// `text` laid out centered within `width`, wrapping on spaces, with
// stand-alone numbers ("8", "44/44") in Outfit and the accent color, the
// rest in Inter ivory. Returns a container whose (0, 0) is the top center,
// and its height.
export function addSummaryText(
  scene: Phaser.Scene,
  cx: number,
  y: number,
  text: string,
  width: number,
  accent: string,
  size = 20
): { container: Phaser.GameObjects.Container; height: number } {
  const container = scene.add.container(cx, y);
  const lineH = Math.round(size * 1.55);
  const numberRe = /^(\d+(?:[./]\d+)?)([.,!?:;]*)$/;
  type Piece = { t: Phaser.GameObjects.Text; w: number };
  const words: Piece[][] = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const m = numberRe.exec(word);
      const parts: Array<[string, boolean]> = m ? [[m[1] as string, true], [m[2] as string, false]] : [[word, false]];
      return parts
        .filter(([s]) => s)
        .map(([s, isNum]) => {
          const t = scene.add
            .text(0, 0, s, {
              fontFamily: isNum ? FONT_NUM : FONT_UI,
              fontSize: `${isNum ? size + 3 : size}px`,
              fontStyle: isNum ? "700" : "500",
              color: isNum ? accent : RESULT_TEXT.ivory,
            })
            .setOrigin(0, 0.5);
          return { t, w: t.width };
        });
    });
  const space = size * 0.3;
  const lines: Piece[][][] = [[]];
  let lineW = 0;
  for (const word of words) {
    const ww = word.reduce((s, p) => s + p.w, 0);
    const current = lines[lines.length - 1] as Piece[][];
    if (current.length && lineW + space + ww > width) {
      lines.push([word]);
      lineW = ww;
    } else {
      current.push(word);
      lineW += (current.length > 1 ? space : 0) + ww;
    }
  }
  lines.forEach((line, i) => {
    const total = line.reduce((s, word) => s + word.reduce((a, p) => a + p.w, 0), 0) + space * (line.length - 1);
    let x = -total / 2;
    const ly = i * lineH + lineH / 2;
    line.forEach((word) => {
      word.forEach((p) => {
        p.t.setPosition(x, ly);
        container.add(p.t);
        x += p.w;
      });
      x += space;
    });
  });
  return { container, height: lines.length * lineH };
}

// --- buttons ---------------------------------------------------------------------

// The lobby's action buttons, drawn for Phaser: `primary` is the Random
// match button (gold gradient, double gold border, soft glow), otherwise the
// secondary one (translucent charcoal, white hairline that turns gold on
// hover). Same shape as theme.createButton's result -- the label is the
// container's second child -- so callers can relabel it. (x, y) is the
// top-left corner.
export function createLobbyButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  { primary, onClick }: { primary: boolean; onClick: () => void }
): Button {
  const pad = 26;
  const r = 14;
  const keyFor = (hover: boolean): string => `result-btn-${primary ? "p" : "s"}-${w}x${h}-${hover ? "h" : "n"}`;
  for (const hover of [false, true]) {
    canvasTexture(scene, keyFor(hover), w + pad * 2, h + pad * 2, (ctx) => {
      ctx.translate(pad, pad);
      const shape = (): void => {
        ctx.beginPath();
        ctx.roundRect(0.5, 0.5, w - 1, h - 1, r);
      };
      if (primary) {
        ctx.save();
        ctx.shadowColor = `rgba(226, 185, 100, ${hover ? 0.5 : 0.35})`;
        ctx.shadowBlur = hover ? 34 : 26;
        const fill = ctx.createLinearGradient(0, 0, 0, h);
        fill.addColorStop(0, hover ? "rgba(126, 96, 46, 0.95)" : "rgba(110, 84, 40, 0.92)");
        fill.addColorStop(1, hover ? "rgba(48, 36, 18, 0.97)" : "rgba(40, 30, 15, 0.96)");
        ctx.fillStyle = fill;
        shape();
        ctx.fill();
        ctx.restore();
        // Outer gold line, a dark ring, then the inner gold line.
        ctx.strokeStyle = "#e2c588";
        ctx.lineWidth = 1;
        shape();
        ctx.stroke();
        ctx.strokeStyle = "rgba(8, 9, 11, 0.55)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(2.5, 2.5, w - 5, h - 5, r - 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(226, 197, 136, ${hover ? 0.6 : 0.45})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(4.5, 4.5, w - 9, h - 9, r - 4);
        ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(22, 22, 25, 0.78)";
        shape();
        ctx.fill();
        ctx.fillStyle = hover ? "rgba(255, 255, 255, 0.09)" : "rgba(255, 255, 255, 0.05)";
        shape();
        ctx.fill();
        ctx.strokeStyle = hover ? "rgba(226, 197, 136, 0.6)" : "rgba(255, 255, 255, 0.2)";
        ctx.lineWidth = 1;
        shape();
        ctx.stroke();
      }
    });
  }

  const container = scene.add.container(x, y);
  const bg = scene.add
    .image(-pad, -pad, keyFor(false))
    .setOrigin(0, 0)
    .setDisplaySize(w + pad * 2, h + pad * 2);
  const label = scene.add
    .text(w / 2, h / 2, primary ? text.toUpperCase() : text, {
      fontFamily: FONT_NUM,
      fontSize: primary ? "20px" : "18px",
      fontStyle: "600",
      color: primary ? "#fff3d6" : "#eceef2",
      letterSpacing: primary ? 2 : 0.4,
    })
    .setOrigin(0.5);
  container.add([bg, label]);
  container.setData("enabled", true);

  // The hit area is in texture pixels (RENDER_SCALE x layout px).
  const s = bg.width / (w + pad * 2);
  const hit = new Phaser.Geom.Rectangle(pad * s, pad * s, w * s, h * s);
  const setHit = (): void => {
    bg.setInteractive({ hitArea: hit, hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
  };
  setHit();
  const hover = (on: boolean): void => {
    if (!container.getData("enabled")) return;
    bg.setTexture(keyFor(on)).setDisplaySize(w + pad * 2, h + pad * 2);
    label.setColor(on && !primary ? "#fff6df" : primary ? "#fff3d6" : "#eceef2");
    container.setY(on ? y - 1 : y);
  };
  bg.on("pointerover", () => hover(true));
  bg.on("pointerout", () => hover(false));
  bg.on("pointerdown", () => container.getData("enabled") && onClick());

  // Relabeling keeps the primary button's capitals.
  const setText = label.setText.bind(label);
  label.setText = ((value: string | string[]) => setText(primary && typeof value === "string" ? value.toUpperCase() : value)) as typeof label.setText;

  function setEnabled(enabled: boolean): void {
    if (!enabled) hover(false);
    container.setData("enabled", enabled);
    container.setAlpha(enabled ? 1 : 0.45);
    if (enabled) setHit();
    else bg.disableInteractive();
  }

  return { container, setEnabled };
}
