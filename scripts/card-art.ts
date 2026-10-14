// Card artwork, drawn as SVG so it lives in the repo as reviewable source.
//
//   npm run cards:art            writes card-art/<card id>.svg for every card
//   npm run cards:art -- --upload   ...and uploads them to the `card-images`
//                                   Storage bucket, then points each
//                                   `cards.image_url` at its file
//
// Uploading needs the project's secret (service_role) key, which must never
// be committed or shipped to the browser: put it in .env.local (gitignored)
// as SUPABASE_SERVICE_ROLE_KEY=... -- VITE_SUPABASE_URL is read from .env.
//
// Each card id below has its own emblem; a card without one (e.g. a new row
// added in the dashboard) gets its category's generic emblem instead.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_CATALOG_ROWS } from "../src/model/catalogData.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "card-art");
const BUCKET = "card-images";

const W = 480;
const H = 360;

interface Palette {
  dark: string;
  light: string;
  glow: string;
}

// Background gradient per category, matching COLORS.card in theme.ts.
const PALETTE: Record<string, Palette> = {
  attack: { dark: "#2a0b09", light: "#b5423a", glow: "#ffb199" },
  defend: { dark: "#081a25", light: "#2f6f8f", glow: "#a8e1ff" },
  buff: { dark: "#08200f", light: "#3a8f5a", glow: "#b6ffcf" },
  debuff: { dark: "#150b24", light: "#6a4a94", glow: "#e0c2ff" },
};

// --- shared shapes -------------------------------------------------------

const INK = "#1b1f2c";

function flame(x: number, y: number, scale = 1, rotate = 0): string {
  return `
  <g transform="translate(${x} ${y}) rotate(${rotate}) scale(${scale})">
    <path d="M0 -70 C22 -38 44 -18 38 14 C33 42 16 58 0 58 C-16 58 -33 42 -38 14 C-42 -8 -22 -24 -12 -46 C-6 -30 2 -26 6 -20 C8 -38 4 -54 0 -70 Z" fill="url(#fireOuter)"/>
    <path d="M0 -24 C12 -6 20 6 18 22 C16 38 8 46 0 46 C-8 46 -16 38 -18 24 C-20 10 -10 0 -4 -10 C0 -2 4 0 6 2 C6 -8 4 -16 0 -24 Z" fill="url(#fireInner)"/>
  </g>`;
}

function shield(x: number, y: number, scale = 1, fill = "url(#metal)"): string {
  return `
  <g transform="translate(${x} ${y}) scale(${scale})">
    <path d="M-62 -84 Q0 -104 62 -84 L62 -8 C62 44 28 78 0 96 C-28 78 -62 44 -62 -8 Z" fill="${fill}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M-44 -70 Q0 -84 44 -70 L44 -8 C44 32 20 58 0 72 C-20 58 -44 32 -44 -8 Z" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="4"/>
  </g>`;
}

function sparks(points: Array<[number, number, number]>, color = "#ffe9a8"): string {
  return points.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`).join("");
}

function burst(x: number, y: number, r: number, color = "#ffe066"): string {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${color}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
}

function arrow(x: number, y: number, dir: "up" | "down" = "up", scale = 1, fill = "#ffffff"): string {
  const rot = dir === "up" ? 0 : 180;
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})">
    <path d="M0 -50 L42 0 H18 V50 H-18 V0 H-42 Z" fill="${fill}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
  </g>`;
}

// --- one emblem per card ------------------------------------------------

const EMBLEMS: Record<string, () => string> = {
  shield_bash: () => `
    <g stroke="#ffffff" stroke-opacity="0.55" stroke-width="8" stroke-linecap="round">
      <line x1="60" y1="140" x2="130" y2="140"/><line x1="44" y1="185" x2="124" y2="185"/><line x1="64" y1="230" x2="130" y2="230"/>
    </g>
    ${shield(215, 180, 1.05)}
    <circle cx="215" cy="176" r="20" fill="#c9ced8" stroke="${INK}" stroke-width="6"/>
    ${burst(335, 170, 62)}
    ${burst(335, 170, 30, "#ffffff")}`,

  heavy_slam: () => `
    <path d="M40 300 H440" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>
    <path d="M200 300 L170 340 M200 300 L215 345 M270 300 L300 338 M270 300 L262 350 M235 300 L238 330" stroke="${INK}" stroke-width="6" fill="none" stroke-linecap="round"/>
    <g stroke="#ffe066" stroke-width="8" stroke-linecap="round">
      <line x1="130" y1="285" x2="95" y2="262"/><line x1="340" y1="285" x2="378" y2="262"/><line x1="150" y1="250" x2="118" y2="215"/><line x1="322" y1="250" x2="356" y2="214"/>
    </g>
    <g transform="translate(236 230) rotate(-18)">
      <rect x="-13" y="-190" width="26" height="160" rx="10" fill="#8a5a32" stroke="${INK}" stroke-width="6"/>
      <rect x="-13" y="-150" width="26" height="14" fill="${INK}" opacity="0.5"/>
      <rect x="-88" y="-44" width="176" height="80" rx="12" fill="url(#metal)" stroke="${INK}" stroke-width="7"/>
      <rect x="-70" y="-30" width="140" height="10" rx="5" fill="#ffffff" opacity="0.5"/>
    </g>
    ${sparks([[120, 300, 9], [360, 296, 8], [150, 318, 6], [330, 322, 6]], "#c9a27a")}`,

  iron_wall: () => {
    let bricks = "";
    for (let row = 0; row < 6; row++) {
      const offset = row % 2 === 0 ? 0 : -40;
      for (let col = 0; col < 7; col++) {
        const x = 30 + offset + col * 80;
        bricks += `<rect x="${x}" y="${40 + row * 48}" width="74" height="42" rx="4" fill="#6f7888" stroke="${INK}" stroke-width="4"/>`;
      }
    }
    return `<g opacity="0.75">${bricks}</g>
      <rect x="0" y="0" width="${W}" height="${H}" fill="url(#vignette)"/>
      ${shield(240, 178, 1.2)}
      <path d="M200 150 H280 M200 190 H280 M240 110 V250" stroke="${INK}" stroke-width="8" stroke-linecap="round" opacity="0.6"/>
      <g fill="${INK}"><circle cx="190" cy="120" r="7"/><circle cx="290" cy="120" r="7"/><circle cx="240" cy="258" r="7"/></g>`;
  },

  brace: () => `
    <g fill="none" stroke="#a8e1ff" stroke-linecap="round">
      <path d="M90 90 Q40 180 90 270" stroke-width="10" opacity="0.9"/>
      <path d="M60 70 Q0 180 60 290" stroke-width="8" opacity="0.6"/>
      <path d="M390 90 Q440 180 390 270" stroke-width="10" opacity="0.9"/>
      <path d="M420 70 Q480 180 420 290" stroke-width="8" opacity="0.6"/>
    </g>
    ${shield(240, 180, 1.15)}
    <g fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
      <path d="M200 110 L240 140 L280 110"/><path d="M200 150 L240 180 L280 150"/><path d="M200 190 L240 220 L280 190"/>
    </g>
    <g fill="none" stroke="#2f6f8f" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M200 110 L240 140 L280 110"/><path d="M200 150 L240 180 L280 150"/><path d="M200 190 L240 220 L280 190"/>
    </g>`,

  second_wind: () => `
    <g fill="none" stroke-linecap="round">
      <path d="M60 250 C140 250 150 180 110 170 C80 162 72 200 100 206" stroke="#ffffff" stroke-width="12"/>
      <path d="M90 300 C220 300 260 220 230 180 C205 148 160 170 175 200" stroke="#b6ffcf" stroke-width="14"/>
      <path d="M150 120 C260 120 300 60 360 90 C400 110 390 150 355 146" stroke="#ffffff" stroke-width="10" opacity="0.85"/>
      <path d="M200 330 C330 330 420 270 410 200 C404 160 360 160 360 190" stroke="#ffffff" stroke-width="12" opacity="0.8"/>
    </g>
    ${arrow(330, 230, "up", 0.9, "#b6ffcf")}
    ${sparks([[300, 70, 7], [420, 120, 6], [90, 110, 5], [250, 50, 5]], "#ffffff")}`,

  taunt: () => `
    <g transform="translate(240 150)">
      <path d="M-120 -60 L-70 -80 L-50 -115 L-10 -85 L40 -110 L55 -75 L110 -80 L95 -40 L135 -10 L95 15 L110 55 L55 45 L35 85 L0 55 L-40 85 L-55 45 L-110 55 L-95 15 L-135 -10 L-95 -35 Z"
        fill="#ffe066" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
      <rect x="-14" y="-72" width="28" height="80" rx="10" fill="${INK}"/>
      <circle cx="0" cy="34" r="15" fill="${INK}"/>
    </g>
    <g fill="#e0c2ff" stroke="${INK}" stroke-width="4">
      <path d="M150 262 C150 280 170 290 170 300 A20 20 0 1 1 130 300 C130 290 150 280 150 262 Z"/>
      <path d="M240 272 C240 292 262 302 262 314 A22 22 0 1 1 218 314 C218 302 240 292 240 272 Z"/>
      <path d="M330 262 C330 280 350 290 350 300 A20 20 0 1 1 310 300 C310 290 330 280 330 262 Z"/>
    </g>`,

  ember_dart: () => `
    ${flame(120, 250, 0.55, -125)}
    ${flame(165, 215, 0.7, -125)}
    <g transform="translate(260 170) rotate(-40)">
      <rect x="-150" y="-7" width="230" height="14" rx="6" fill="#7a4b2a" stroke="${INK}" stroke-width="5"/>
      <path d="M-150 -7 L-185 -32 L-160 0 L-185 32 L-150 7 Z" fill="#ff9d4d" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M80 -26 L140 0 L80 26 L92 0 Z" fill="url(#metal)" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    </g>
    ${sparks([[90, 300, 7], [210, 280, 5], [60, 230, 5], [400, 130, 6]])}`,

  fire_lance: () => `
    <g transform="translate(225 195) rotate(-22) scale(0.9)">
      <path d="M-230 -26 C-160 -60 -60 -30 40 -16 L40 16 C-60 30 -160 60 -230 26 C-190 0 -190 0 -230 -26 Z" fill="url(#fireOuter)" opacity="0.9"/>
      <path d="M-170 -10 C-100 -24 -30 -12 40 -8 L40 8 C-30 12 -100 24 -170 10 Z" fill="url(#fireInner)"/>
      <rect x="-40" y="-9" width="230" height="18" rx="7" fill="#6b4226" stroke="${INK}" stroke-width="5"/>
      <path d="M190 -28 L270 0 L190 28 L204 0 Z" fill="url(#metal)" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
      <rect x="170" y="-18" width="22" height="36" rx="5" fill="#ffe066" stroke="${INK}" stroke-width="5"/>
    </g>
    ${sparks([[120, 110, 7], [80, 300, 6], [330, 300, 5], [180, 70, 5], [410, 250, 6]])}`,

  heat_shroud: () => `
    <path d="M60 300 C60 120 160 60 240 60 C320 60 420 120 420 300 Z" fill="#ff9d4d" opacity="0.18" stroke="#ffb870" stroke-width="8"/>
    <path d="M100 300 C100 160 170 100 240 100 C310 100 380 160 380 300" fill="none" stroke="#ffd29a" stroke-width="5" stroke-dasharray="18 12" opacity="0.8"/>
    <g fill="none" stroke="#ffd29a" stroke-width="7" stroke-linecap="round" opacity="0.9">
      <path d="M150 260 q15 -20 0 -40 q-15 -20 0 -40"/>
      <path d="M330 260 q15 -20 0 -40 q-15 -20 0 -40"/>
    </g>
    ${shield(240, 205, 0.8, "url(#fireShield)")}
    ${flame(240, 205, 0.55)}
    <path d="M40 300 H440" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`,

  stoke_the_flame: () => `
    <g stroke="${INK}" stroke-width="6">
      <rect x="130" y="265" width="220" height="30" rx="14" fill="#7a4b2a" transform="rotate(12 240 280)"/>
      <rect x="130" y="265" width="220" height="30" rx="14" fill="#8a5a32" transform="rotate(-12 240 280)"/>
    </g>
    ${flame(240, 190, 1.4)}
    ${arrow(380, 150, "up", 0.6, "#b6ffcf")}
    ${arrow(100, 170, "up", 0.45, "#b6ffcf")}
    ${sparks([[180, 60, 6], [300, 45, 7], [250, 30, 5], [150, 110, 5], [330, 95, 5]])}`,

  scorch: () => `
    <path d="M40 290 H440" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>
    <g fill="#2a1a12" opacity="0.9">
      <ellipse cx="240" cy="296" rx="150" ry="22"/>
    </g>
    <path d="M150 292 L130 330 M200 292 L205 340 M280 292 L300 336 M330 292 L360 326" stroke="#ff9d4d" stroke-width="5" fill="none" stroke-linecap="round"/>
    ${flame(170, 230, 0.8)}
    ${flame(310, 236, 0.7)}
    ${flame(240, 210, 1.0)}
    ${arrow(240, 95, "down", 0.8, "#e0c2ff")}
    <g fill="#8a8f9c" opacity="0.7"><circle cx="110" cy="120" r="18"/><circle cx="135" cy="95" r="14"/><circle cx="370" cy="110" r="20"/><circle cx="395" cy="80" r="12"/></g>`,
};

// Generic emblem per category, for cards without their own.
const CATEGORY_EMBLEM: Record<string, () => string> = {
  attack: () => `${burst(240, 180, 120)}${burst(240, 180, 60, "#ffffff")}`,
  defend: () => shield(240, 180, 1.3),
  buff: () => `${arrow(240, 190, "up", 2)}${sparks([[120, 90, 8], [360, 110, 7], [330, 280, 6]], "#ffffff")}`,
  debuff: () => `${arrow(240, 170, "down", 2, "#e0c2ff")}`,
};

const FALLBACK_PALETTE: Palette = { dark: "#1b1f2c", light: "#4a5573", glow: "#e8eaf0" };
const FALLBACK_EMBLEM = (): string => "";

export function cardArtSvg(card: { id: string; category: string }): string {
  const palette = PALETTE[card.category] ?? PALETTE.attack ?? FALLBACK_PALETTE;
  const emblem = (EMBLEMS[card.id] ?? CATEGORY_EMBLEM[card.category] ?? CATEGORY_EMBLEM.attack ?? FALLBACK_EMBLEM)();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="45%" r="75%">
      <stop offset="0" stop-color="${palette.light}"/>
      <stop offset="1" stop-color="${palette.dark}"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${palette.glow}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${palette.glow}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.6"/>
    </radialGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f4f6fa"/>
      <stop offset="0.55" stop-color="#b8c0cd"/>
      <stop offset="1" stop-color="#7d8697"/>
    </linearGradient>
    <linearGradient id="fireOuter" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#ff4d1a"/>
      <stop offset="0.6" stop-color="#ff9d4d"/>
      <stop offset="1" stop-color="#ffd23f"/>
    </linearGradient>
    <linearGradient id="fireInner" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#ffe066"/>
      <stop offset="1" stop-color="#fffbe6"/>
    </linearGradient>
    <linearGradient id="fireShield" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd29a"/>
      <stop offset="1" stop-color="#c7612a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="240" cy="180" r="170" fill="url(#halo)"/>
  <g opacity="0.12" stroke="#ffffff" stroke-width="2" fill="none">
    <circle cx="240" cy="180" r="120"/><circle cx="240" cy="180" r="150"/>
  </g>
  ${emblem}
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
</svg>
`;
}

// --- upload ----------------------------------------------------------------

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    const key = match?.[1];
    if (key) env[key] = (match?.[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return env;
}

interface ArtFile {
  id: string;
  path: string;
}

async function upload(files: ArtFile[]): Promise<void> {
  const env = { ...readEnvFile(join(ROOT, ".env")), ...readEnvFile(join(ROOT, ".env.local")), ...process.env };
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Uploading needs VITE_SUPABASE_URL (.env) and SUPABASE_SERVICE_ROLE_KEY (.env.local).");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  for (const { id, path } of files) {
    const objectPath = `${id}.svg`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(objectPath, new Blob([readFileSync(path)], { type: "image/svg+xml" }), { contentType: "image/svg+xml", upsert: true, cacheControl: "3600" });
    if (uploadError) throw new Error(`upload ${objectPath}: ${uploadError.message}`);

    // Versioned by upload time so browsers don't keep showing a stale cached copy.
    const publicUrl = `${admin.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl}?v=${Date.now()}`;
    const { error: updateError } = await admin.from("cards").update({ image_url: publicUrl }).eq("id", id);
    if (updateError) throw new Error(`update cards.image_url for ${id}: ${updateError.message}`);
    console.log(`uploaded ${objectPath} -> cards.image_url`);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const files: ArtFile[] = LOCAL_CATALOG_ROWS.cards.map((card) => {
    const path = join(OUT_DIR, `${card.id}.svg`);
    writeFileSync(path, cardArtSvg(card));
    return { id: card.id, path };
  });
  console.log(`wrote ${files.length} files to card-art/`);
  if (process.argv.includes("--upload")) await upload(files);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
