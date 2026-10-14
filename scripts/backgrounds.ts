// Medieval-fantasy scene backgrounds, drawn as SVG so they live in the repo
// as reviewable source (like scripts/card-art.ts).
//
//   npm run backgrounds    writes public/backgrounds/{class-select,battle}.svg
//
// Both are 1280x720, the game's layout size, and kept dark where the UI sits
// (panels, hand, log) so text stays readable; the detail goes where the
// screen is empty. Randomness (stars, bricks, trees) is seeded, so
// regenerating gives the same picture.
//
// The battle hall's torch positions are mirrored in BattleScene.ts
// (TORCHES), which adds a flickering glow on top of them.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "backgrounds");

const W = 1280;
const H = 720;

// Small seeded PRNG (mulberry32).
function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;

const r1 = (n: number): number => Math.round(n * 10) / 10;

interface RidgeOptions {
  baseY: number;
  amp: number;
  step: number;
  color: string;
  opacity?: number;
}

// A jagged ridge line across the full width, closed down to the bottom.
function ridge(rand: Rand, { baseY, amp, step, color, opacity = 1 }: RidgeOptions): string {
  const pts: string[] = [`0,${H}`];
  for (let x = 0; x <= W + step; x += step) {
    pts.push(`${Math.min(x, W)},${r1(baseY - rand() * amp)}`);
  }
  pts.push(`${W},${H}`);
  return `<polygon points="${pts.join(" ")}" fill="${color}" opacity="${opacity}"/>`;
}

function pine(x: number, baseY: number, h: number, color: string): string {
  const w = h * 0.42;
  const tiers = [0, 0.28, 0.52];
  const parts = tiers.map((t, i) => {
    const top = baseY - h + t * h;
    const tierW = w * (0.55 + i * 0.25);
    const bottom = top + h * 0.5;
    return `<polygon points="${r1(x)},${r1(top)} ${r1(x - tierW / 2)},${r1(bottom)} ${r1(x + tierW / 2)},${r1(bottom)}"/>`;
  });
  parts.push(`<rect x="${r1(x - h * 0.03)}" y="${r1(baseY - h * 0.05)}" width="${r1(h * 0.06)}" height="${r1(h * 0.08)}"/>`);
  return `<g fill="${color}">${parts.join("")}</g>`;
}

// Crenellations along the top edge of a wall/tower.
function battlements(x: number, y: number, w: number, color: string, merlon = 10): string {
  let out = "";
  for (let mx = x; mx < x + w - merlon / 2; mx += merlon * 2) {
    out += `<rect x="${r1(mx)}" y="${r1(y - merlon)}" width="${merlon}" height="${merlon}" fill="${color}"/>`;
  }
  return out;
}

function tower(x: number, y: number, w: number, h: number, color: string, roofColor: string, flagColor: string): string {
  const roofH = w * 1.1;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>
    <polygon points="${x - 6},${y} ${x + w / 2},${y - roofH} ${x + w + 6},${y}" fill="${roofColor}"/>
    <line x1="${x + w / 2}" y1="${y - roofH}" x2="${x + w / 2}" y2="${y - roofH - 26}" stroke="${color}" stroke-width="2"/>
    <path d="M${x + w / 2} ${y - roofH - 26} q12 3 22 -2 q-6 7 0 13 q-10 -4 -22 0 z" fill="${flagColor}"/>`;
}

function window_(x: number, y: number, w = 7, h = 11): string {
  return `<path d="M${x} ${y + h} v${-h + w / 2} a${w / 2} ${w / 2} 0 0 1 ${w} 0 v${h - w / 2} z" fill="#ffc56b" filter="url(#windowGlow)"/>`;
}

// --- class select: castle on a hill at dusk ---------------------------------

function classSelectSvg(): string {
  const rand = rng(7);

  let stars = "";
  for (let i = 0; i < 170; i++) {
    const x = r1(rand() * W);
    const y = r1(rand() * 400);
    const r = r1(0.4 + rand() * 1.3);
    const o = r1(0.25 + rand() * 0.7);
    stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff6e0" opacity="${o}"/>`;
  }

  const castleColor = "#140e21";
  const roof = "#1c1330";
  const cx = W / 2;
  const base = 600;
  // Drawn around a base line, then scaled/moved (below) into the
  // empty band under the class cards and buttons.
  const castle = `
    <g>
      <!-- outer walls -->
      <rect x="${cx - 190}" y="${base - 95}" width="380" height="95" fill="${castleColor}"/>
      ${battlements(cx - 190, base - 95, 380, castleColor)}
      <!-- corner towers -->
      ${tower(cx - 215, base - 150, 44, 150, castleColor, roof, "#8f2d2d")}
      ${tower(cx + 171, base - 150, 44, 150, castleColor, roof, "#8f2d2d")}
      <!-- keep -->
      <rect x="${cx - 70}" y="${base - 200}" width="140" height="200" fill="${castleColor}"/>
      ${battlements(cx - 70, base - 200, 140, castleColor, 12)}
      ${tower(cx - 105, base - 250, 40, 250, castleColor, roof, "#c9a227")}
      ${tower(cx + 65, base - 250, 40, 250, castleColor, roof, "#c9a227")}
      ${tower(cx - 22, base - 300, 44, 110, castleColor, roof, "#8f2d2d")}
      <!-- gate -->
      <path d="M${cx - 22} ${base} v-44 a22 22 0 0 1 44 0 v44 z" fill="#3a1d10"/>
      <path d="M${cx - 16} ${base} v-40 a16 16 0 0 1 32 0 v40 z" fill="#ff9d4d" opacity="0.55" filter="url(#windowGlow)"/>
      <!-- lit windows -->
      ${window_(cx - 40, base - 160)}${window_(cx + 33, base - 160)}${window_(cx - 4, base - 120)}
      ${window_(cx - 90, base - 210)}${window_(cx + 80, base - 210)}${window_(cx - 4, base - 260)}
      ${window_(cx - 197, base - 120)}${window_(cx + 190, base - 120)}${window_(cx - 140, base - 60)}
      ${window_(cx + 132, base - 60)}
    </g>`;

  let trees = "";
  for (let i = 0; i < 26; i++) {
    const left = i % 2 === 0;
    const x = left ? rand() * 260 - 20 : W - rand() * 260 + 20;
    const h = 90 + rand() * 120;
    trees += pine(x, H - rand() * 40, h, "#07050d");
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#070716"/>
      <stop offset="0.38" stop-color="#1d1336"/>
      <stop offset="0.62" stop-color="#4a2745"/>
      <stop offset="0.76" stop-color="#a24f45"/>
      <stop offset="0.84" stop-color="#d98a4f"/>
      <stop offset="1" stop-color="#d98a4f"/>
    </linearGradient>
    <radialGradient id="moonGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff2cc" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#fff2cc" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sunset" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffb26b" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffb26b" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fog" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c9a6c9" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#c9a6c9" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#c9a6c9" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="topShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.75">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.65"/>
    </radialGradient>
    <mask id="crescent">
      <rect width="${W}" height="${H}" fill="#fff"/>
      <circle cx="1085" cy="88" r="36" fill="#000"/>
    </mask>
    <filter id="windowGlow" x="-200%" y="-200%" width="500%" height="500%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars}
  <circle cx="1067" cy="102" r="110" fill="url(#moonGlow)"/>
  <circle cx="1067" cy="102" r="38" fill="#f6ead0" mask="url(#crescent)"/>
  <ellipse cx="640" cy="600" rx="693" ry="150" fill="url(#sunset)"/>
  <g fill="#2a1a3a" opacity="0.55">
    <ellipse cx="227" cy="250" rx="150" ry="10"/><ellipse cx="347" cy="268" rx="110" ry="7"/>
    <ellipse cx="920" cy="300" rx="170" ry="9"/><ellipse cx="813" cy="318" rx="90" ry="6"/>
  </g>
  ${ridge(rand, { baseY: 530, amp: 110, step: 48, color: "#3d2446", opacity: 0.95 })}
  ${ridge(rand, { baseY: 578, amp: 70, step: 36, color: "#281733" })}
  <!-- the castle's hill -->
  <path d="M200 ${H} C387 683 533 669 640 669 C747 669 893 683 1080 ${H} Z" fill="#170f23"/>
  <g transform="translate(640 672) scale(0.72) translate(-640 -600)">${castle}</g>
  <rect x="0" y="610" width="${W}" height="90" fill="url(#fog)"/>
  ${ridge(rand, { baseY: 695, amp: 35, step: 30, color: "#0b0712" })}
  ${trees}
  <rect width="${W}" height="260" fill="url(#topShade)"/>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
</svg>
`;
}

// --- battle: torch-lit castle hall -----------------------------------------------

export interface Torch {
  x: number;
  y: number;
}

export const TORCHES: Torch[] = [
  { x: 278, y: 322 },
  { x: 1002, y: 322 },
];

function flame(x: number, y: number, s: number): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M0 -34 C10 -18 18 -8 16 6 C14 18 7 24 0 24 C-7 24 -14 18 -16 6 C-18 -6 -8 -12 -4 -22 C-2 -14 2 -12 4 -9 C5 -18 3 -26 0 -34 Z" fill="#ff8a3d"/>
    <path d="M0 -12 C6 -3 9 3 8 11 C7 18 4 21 0 21 C-4 21 -7 18 -8 11 C-9 4 -4 -1 0 -12 Z" fill="#ffe08a"/>
  </g>`;
}

function battleSvg(): string {
  const rand = rng(11);

  // Stone wall: rows of bricks with slightly varied color.
  let bricks = "";
  const rowH = 38;
  for (let row = 0; row * rowH < 600; row++) {
    const y = row * rowH;
    let x = row % 2 === 0 ? -30 : -70;
    while (x < W) {
      const w = 70 + Math.floor(rand() * 40);
      const shade = 30 + Math.floor(rand() * 14);
      const fill = `rgb(${shade + 6},${shade},${shade + 12})`;
      bricks += `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${rowH - 4}" rx="3" fill="${fill}"/>`;
      x += w;
    }
  }

  // Flagstone floor in perspective, converging on the hall's far door.
  const vx = W / 2;
  const vy = 420;
  let floorLines = "";
  for (let i = -12; i <= 12; i++) {
    floorLines += `<line x1="${vx}" y1="${vy}" x2="${vx + i * 110}" y2="${H}" />`;
  }
  for (const y of [604, 622, 644, 670, 700]) {
    floorLines += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" />`;
  }

  const pillar = (x: number): string => `
    <rect x="${x - 34}" y="0" width="68" height="600" fill="url(#pillar)"/>
    <rect x="${x - 42}" y="560" width="84" height="40" fill="#2c2733"/>
    <rect x="${x - 42}" y="120" width="84" height="18" fill="#2c2733"/>`;

  const banner = (x: number, color: string, emblem: string): string => `
    <g>
      <rect x="${x - 4}" y="0" width="${88}" height="8" fill="#5b4632" transform="translate(-40 0)"/>
      <path d="M${x - 34} 6 H${x + 34} V250 L${x} 222 L${x - 34} 250 Z" fill="${color}"/>
      <path d="M${x - 34} 6 H${x + 34} V250 L${x} 222 L${x - 34} 250 Z" fill="none" stroke="#c9a227" stroke-width="3"/>
      <path d="M${x - 26} 14 H${x + 26} V238 L${x} 214 L${x - 26} 238 Z" fill="none" stroke="#c9a227" stroke-width="1" opacity="0.6"/>
      ${emblem}
      <path d="M${x - 34} 6 H${x + 34} V250 L${x} 222 L${x - 34} 250 Z" fill="url(#bannerShade)"/>
    </g>`;
  const swordEmblem = (x: number): string => `
    <g transform="translate(${x} 110)" fill="#e8c65a">
      <path d="M-4 -46 L0 -54 L4 -46 L4 20 L-4 20 Z"/><rect x="-16" y="18" width="32" height="6" rx="2"/>
      <rect x="-3" y="24" width="6" height="18"/><circle cx="0" cy="46" r="5"/>
    </g>`;
  const shieldEmblem = (x: number): string => `
    <g transform="translate(${x} 110)">
      <path d="M-24 -32 Q0 -40 24 -32 V0 C24 20 10 34 0 42 C-10 34 -24 20 -24 0 Z" fill="#e8c65a"/>
      <path d="M0 -28 V34 M-18 -4 H18" stroke="#1d2f5a" stroke-width="5"/>
    </g>`;

  const torch = ({ x, y }: Torch): string => `
    <circle cx="${x}" cy="${y - 20}" r="230" fill="url(#torchLight)"/>
    <path d="M${x - 14} ${y + 6} L${x + 14} ${y + 6} L${x + 6} ${y + 44} L${x - 6} ${y + 44} Z" fill="#3b2a1a" stroke="#1a120b" stroke-width="2"/>
    <rect x="${x - 17}" y="${y}" width="34" height="8" rx="2" fill="#6b5236"/>
    ${flame(x, y - 8, 1.1)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="pillar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#241f2b"/>
      <stop offset="0.35" stop-color="#3a3442"/>
      <stop offset="0.7" stop-color="#2b2632"/>
      <stop offset="1" stop-color="#17141c"/>
    </linearGradient>
    <radialGradient id="torchLight" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ff9d4d" stop-opacity="0.42"/>
      <stop offset="0.5" stop-color="#ff7a2a" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#ff7a2a" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="floorArea">
      <rect x="0" y="600" width="${W}" height="${H - 600}"/>
      <path d="M482 600 V362 A158 158 0 0 1 798 362 V600 Z"/>
    </clipPath>
    <radialGradient id="doorLight" cx="0.5" cy="0.8" r="0.7">
      <stop offset="0" stop-color="#6b5a8f" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#0c0a12" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b1720"/>
      <stop offset="1" stop-color="#0c0a10"/>
    </linearGradient>
    <linearGradient id="bannerShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.35"/>
      <stop offset="0.4" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.35"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.75">
      <stop offset="0.5" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.7"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#120f17"/>
  ${bricks}
  <!-- great arched doorway at the back of the hall, behind the hand -->
  <path d="M460 600 V360 A180 180 0 0 1 820 360 V600 Z" fill="#3a3442"/>
  <path d="M482 600 V362 A158 158 0 0 1 798 362 V600 Z" fill="#0c0a12"/>
  <path d="M482 600 V362 A158 158 0 0 1 798 362 V600 Z" fill="url(#doorLight)"/>
  <g stroke="#2a2531" stroke-width="3" fill="none">
    ${Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI + (i + 1) * (Math.PI / 10);
      const x1 = 640 + Math.cos(a) * 158;
      const y1 = 362 + Math.sin(a) * 158;
      const x2 = 640 + Math.cos(a) * 180;
      const y2 = 362 + Math.sin(a) * 180;
      return `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`;
    }).join("")}
  </g>
  ${pillar(278)}${pillar(1002)}
  ${banner(40, "#7a1f24", swordEmblem(40))}
  ${banner(1240, "#1d2f5a", shieldEmblem(1240))}
  ${TORCHES.map(torch).join("")}
  <!-- floor -->
  <rect x="0" y="600" width="${W}" height="${H - 600}" fill="url(#floor)"/>
  <g stroke="#26212c" stroke-width="2" opacity="0.8" clip-path="url(#floorArea)">${floorLines}</g>
  <rect x="0" y="596" width="${W}" height="8" fill="#2c2733"/>
  <rect width="${W}" height="${H}" fill="#000" opacity="0.18"/>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
</svg>
`;
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "class-select.svg"), classSelectSvg());
  writeFileSync(join(OUT_DIR, "battle.svg"), battleSvg());
  console.log("wrote public/backgrounds/class-select.svg and battle.svg");
}

main();
