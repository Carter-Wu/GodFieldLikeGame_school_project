// Ultimate animations for the round recap. Every ultimate opens with a
// full-width "cut-in" banner (class emblem + ultimate name) so it reads as
// different from a normal card, then plays its class's own effect:
//
//   guardian   -- a giant crest drops from above and slams the target:
//                 golden light, shockwave rings, flying debris
//   pyromancer -- a fireball charges up, arcs across the screen and
//                 explodes into flame pillars on the target
//
// A class without an entry in THEMES gets a generic gold effect, so adding
// a class never breaks the recap. Each theme also has its own sounds (see
// src/fx/sound.ts). The damage number itself is still drawn by the recap's
// hit(), after the effect lands.

import Phaser from "phaser";
import { classIconKey, ULTIMATE_ICON_KEY } from "../phaserIcons.ts";
import { playSfx } from "../fx/sound.ts";
import { FONT_FAMILY, TEXT, GAME_WIDTH, GAME_HEIGHT } from "./theme.ts";
import { burstParticles, panelCenter, projectile, scaled, tween, wait, type PanelRect, type RecapRun } from "./recapUtil.ts";
import type { RecapSide } from "./roundRecap.ts";

const FIRE = [0xff4d1a, 0xff9d4d, 0xffd23f, 0xfff3b0];

interface UltimateTheme {
  color: number;
  dark: number;
  text: string;
  play: (
    run: RecapRun,
    from: { x: number; y: number },
    panel: PanelRect,
    side: RecapSide
  ) => Promise<void>;
}

const THEMES: Record<string, UltimateTheme> = {
  guardian: { color: 0xffd23f, dark: 0x122235, text: "#ffe9a8", play: guardianUltimate },
  pyromancer: { color: 0xff7a1a, dark: 0x2a0b05, text: "#ffb36b", play: pyromancerUltimate },
};
const DEFAULT_THEME: UltimateTheme = { color: 0xffd23f, dark: 0x1b1f2c, text: "#ffd23f", play: genericUltimate };

export async function playUltimate(
  run: RecapRun,
  side: RecapSide,
  target: RecapSide,
  from: { x: number; y: number }
): Promise<void> {
  const theme = THEMES[side.classId] ?? DEFAULT_THEME;
  await cutIn(run, side, theme);
  await theme.play(run, from, target.panel(), side);
}

// --- cut-in --------------------------------------------------------------------

async function cutIn(run: RecapRun, side: RecapSide, theme: UltimateTheme): Promise<void> {
  const { scene, layer } = run;
  const cy = GAME_HEIGHT / 2;
  const cx = GAME_WIDTH / 2;
  const band = scene.add.container(0, 0);
  layer.add(band);

  const bg = scene.add.rectangle(cx, cy, GAME_WIDTH, 170, theme.dark, 0.96).setScale(1, 0);
  const edgeTop = scene.add.rectangle(cx, cy - 85, GAME_WIDTH, 4, theme.color).setScale(0, 1);
  const edgeBottom = scene.add.rectangle(cx, cy + 85, GAME_WIDTH, 4, theme.color).setScale(0, 1);
  band.add([bg, edgeTop, edgeBottom]);

  // Coming from the actor's side of the screen: emblem on that side,
  // text toward the middle, both sliding in from the actor's edge.
  // Positions are fractions of the stage width so the composition holds at
  // any aspect (tuned at 960 wide: 260/700 icon, 370/590 text).
  const fromRight = panelCenter(side.panel()).x > GAME_WIDTH / 2;
  const dir = fromRight ? -1 : 1;

  const lines: Phaser.GameObjects.Rectangle[] = [];
  for (let i = 0; i < 14; i++) {
    const line = scene.add
      .rectangle(0, cy - 75 + Math.random() * 150, 80 + Math.random() * 160, 2 + Math.random() * 2, theme.color, 0.35)
      .setAlpha(0);
    band.add(line);
    lines.push(line);
    const startX = fromRight ? -GAME_WIDTH * 0.156 : GAME_WIDTH * 1.156;
    const endX = fromRight ? GAME_WIDTH * 1.156 : -GAME_WIDTH * 0.156;
    line.x = startX + (endX - startX) * Math.random();
    scene.tweens.add({ targets: line, alpha: 1, duration: 120 });
    scene.tweens.add({
      targets: line,
      x: { from: startX, to: endX },
      duration: 280 + Math.random() * 220,
      delay: Math.random() * 200,
      repeat: -1,
    });
  }

  const iconX = fromRight ? GAME_WIDTH * 0.729 : GAME_WIDTH * 0.271;
  const glow = scene.add.circle(iconX, cy, 72, theme.color, 0.3).setBlendMode(Phaser.BlendModes.ADD).setScale(0);
  band.add(glow);
  const iconKey = scene.textures.exists(classIconKey(side.classId)) ? classIconKey(side.classId) : ULTIMATE_ICON_KEY;
  const icon = scene.textures.exists(iconKey)
    ? scene.add.image(iconX - dir * GAME_WIDTH * 0.417, cy, iconKey).setDisplaySize(124, 124)
    : null;
  if (icon) band.add(icon);

  const textX = fromRight ? GAME_WIDTH * 0.615 : GAME_WIDTH * 0.385;
  const align = fromRight ? 1 : 0;
  const texts = scene.add.container(textX - dir * GAME_WIDTH * 0.521, cy);
  texts.add([
    scene.add
      .text(0, -48, `${side.who.toUpperCase()} · ULTIMATE`, {
        fontFamily: FONT_FAMILY,
        fontSize: "15px",
        fontStyle: "800",
        color: theme.text,
      })
      .setOrigin(align, 0.5),
    scene.add
      .text(0, 0, side.ultimateName, {
        fontFamily: FONT_FAMILY,
        fontSize: "50px",
        fontStyle: "800",
        color: TEXT.white,
        stroke: "#000000",
        strokeThickness: 7,
      })
      .setOrigin(align, 0.5),
    scene.add
      .text(0, 44, side.className, { fontFamily: FONT_FAMILY, fontSize: "14px", color: TEXT.muted })
      .setOrigin(align, 0.5),
  ]);
  band.add(texts);

  playSfx("cutin");
  await Promise.all([
    tween(run, { targets: bg, scaleY: 1, duration: 140, ease: "Cubic.easeOut" }),
    tween(run, { targets: [edgeTop, edgeBottom], scaleX: 1, duration: 220, ease: "Cubic.easeOut" }),
  ]);
  await Promise.all([
    icon && tween(run, { targets: icon, x: iconX, duration: 260, ease: "Cubic.easeOut" }),
    tween(run, { targets: glow, scale: 1, duration: 300, ease: "Back.easeOut" }),
    tween(run, { targets: texts, x: textX, duration: 260, ease: "Cubic.easeOut" }),
  ]);
  scene.tweens.add({ targets: glow, scale: 1.25, alpha: 0.6, duration: 300, yoyo: true, repeat: 1 });
  await wait(run, 700);

  await tween(run, { targets: band, alpha: 0, duration: 180 });
  scene.tweens.killTweensOf([...lines, glow]);
  band.destroy(true);
}

// --- Guardian: crest slam --------------------------------------------------------

async function guardianUltimate(run: RecapRun, _from: { x: number; y: number }, panel: PanelRect, side: RecapSide): Promise<void> {
  const { scene, layer } = run;
  const c = panelCenter(panel);

  // Column of light where the crest will land.
  const column = scene.add
    .rectangle(c.x, c.y / 2, 150, c.y, 0xfff3c4, 0.35)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setAlpha(0);
  const shadow = scene.add.ellipse(c.x, c.y + 50, 90, 22, 0x000000, 0.45).setScale(0.3);
  layer.add([column, shadow]);
  await tween(run, { targets: column, alpha: 1, duration: 180 });

  const iconKey = classIconKey(side.classId);
  const glow = scene.add.circle(c.x, -120, 90, 0xffd23f, 0.4).setBlendMode(Phaser.BlendModes.ADD);
  const crest = scene.textures.exists(iconKey)
    ? scene.add.image(c.x, -120, iconKey).setDisplaySize(160, 160).setAngle(-18).setTint(0xffd23f) // white emblem -> gold
    : scene.add.circle(c.x, -120, 70, 0xffd23f);
  layer.add([glow, crest]);
  const baseScaleX = crest.scaleX;
  const baseScaleY = crest.scaleY;

  playSfx("guardianDrop");
  scene.tweens.add({ targets: shadow, scale: 1.6, duration: 420, ease: "Quad.easeIn" });
  await Promise.all([
    tween(run, { targets: crest, y: c.y, angle: 0, duration: 420, ease: "Quad.easeIn" }),
    tween(run, { targets: glow, y: c.y, duration: 420, ease: "Quad.easeIn" }),
  ]);

  // Impact.
  playSfx("guardianImpact");
  scene.cameras.main.shake(scaled(run, 500), 0.022);
  scene.cameras.main.flash(scaled(run, 200), 255, 240, 200);
  scene.tweens.add({ targets: crest, scaleX: baseScaleX * 1.2, scaleY: baseScaleY * 0.8, duration: 70, yoyo: true });

  for (let i = 0; i < 3; i++) {
    const ring = scene.add.circle(c.x, c.y, 40).setStrokeStyle(6 - i, i === 1 ? 0xffffff : 0xffd23f);
    layer.add(ring);
    scene.tweens.add({
      targets: ring,
      scale: 4.5,
      alpha: 0,
      delay: i * 110,
      duration: 650,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }
  burstParticles(run, c.x, c.y + 20, {
    count: 22,
    colors: [0xc9ced8, 0x8a8f9c, 0xffd23f, 0x6f7888],
    minDist: 70,
    maxDist: 190,
    minR: 3,
    maxR: 8,
    duration: 700,
  });

  await wait(run, 450);
  await tween(run, { targets: [crest, glow, column, shadow], alpha: 0, y: "-=20", duration: 300 });
  [crest, glow, column, shadow].forEach((o) => o.destroy());
}

// --- Pyromancer: meteor --------------------------------------------------------

async function pyromancerUltimate(run: RecapRun, from: { x: number; y: number }, panel: PanelRect): Promise<void> {
  const { scene, layer } = run;
  const c = panelCenter(panel);

  // Heat haze over the whole screen.
  const heat = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xff4d1a, 0).setOrigin(0, 0);
  layer.add(heat);
  scene.tweens.add({ targets: heat, fillAlpha: 0.16, duration: 250 });

  // Charge: the fireball swells while embers are pulled in.
  playSfx("pyroCharge");
  const outer = scene.add.circle(from.x, from.y, 18, 0xff7a1a, 0.9).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4);
  const core = scene.add.circle(from.x, from.y, 10, 0xfff3b0).setScale(0.4);
  layer.add([outer, core]);
  for (let i = 0; i < 16; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * 60;
    const ember = scene.add
      .circle(from.x + Math.cos(angle) * dist, from.y + Math.sin(angle) * dist, 3 + Math.random() * 3, (FIRE[i % FIRE.length] as number))
      .setBlendMode(Phaser.BlendModes.ADD);
    layer.add(ember);
    scene.tweens.add({
      targets: ember,
      x: from.x,
      y: from.y,
      alpha: 0.2,
      delay: Math.random() * 200,
      duration: 350,
      ease: "Quad.easeIn",
      onComplete: () => ember.destroy(),
    });
  }
  await tween(run, { targets: [outer, core], scale: 2.4, duration: 520, ease: "Sine.easeIn" });

  // Launch in an arc, leaving a trail of flame.
  const flight = { t: 0 };
  const trail = scene.time.addEvent({
    delay: 18,
    loop: true,
    callback: () => {
      const puff = scene.add
        .circle(outer.x + (Math.random() - 0.5) * 16, outer.y + (Math.random() - 0.5) * 16, 10 + Math.random() * 14, Phaser.Utils.Array.GetRandom(FIRE), 0.8)
        .setBlendMode(Phaser.BlendModes.ADD);
      layer.add(puff);
      scene.tweens.add({ targets: puff, alpha: 0, scale: 0.2, y: puff.y - 20, duration: 380, onComplete: () => puff.destroy() });
    },
  });
  await tween(run, {
    targets: flight,
    t: 1,
    duration: 560,
    ease: "Sine.easeIn",
    onUpdate: () => {
      const x = Phaser.Math.Linear(from.x, c.x, flight.t);
      const y = Phaser.Math.Linear(from.y, c.y, flight.t) - Math.sin(Math.PI * flight.t) * 170;
      outer.setPosition(x, y);
      core.setPosition(x, y);
    },
  });
  trail.remove();
  outer.destroy();
  core.destroy();

  // Explosion.
  playSfx("pyroExplode");
  scene.cameras.main.shake(scaled(run, 550), 0.018);
  scene.cameras.main.flash(scaled(run, 220), 255, 140, 40);
  const blast = scene.add.circle(c.x, c.y, 30, 0xff7a1a, 0.9).setBlendMode(Phaser.BlendModes.ADD);
  const blastCore = scene.add.circle(c.x, c.y, 20, 0xfff3b0).setBlendMode(Phaser.BlendModes.ADD);
  layer.add([blast, blastCore]);
  scene.tweens.add({ targets: blast, scale: 6, alpha: 0, duration: 500, ease: "Cubic.easeOut", onComplete: () => blast.destroy() });
  scene.tweens.add({ targets: blastCore, scale: 4, alpha: 0, duration: 350, ease: "Cubic.easeOut", onComplete: () => blastCore.destroy() });
  burstParticles(run, c.x, c.y, { count: 30, colors: FIRE, minDist: 60, maxDist: 200, minR: 4, maxR: 10, duration: 650, additive: true });

  // Flame pillars rising off the target's panel.
  const pillars = scene.time.addEvent({
    delay: 30,
    repeat: 24,
    callback: () => {
      const x = panel.x + 20 + Math.random() * (panel.w - 40);
      const flame = scene.add
        .circle(x, panel.y + panel.h - 10, 8 + Math.random() * 12, Phaser.Utils.Array.GetRandom(FIRE), 0.85)
        .setBlendMode(Phaser.BlendModes.ADD);
      layer.add(flame);
      scene.tweens.add({
        targets: flame,
        y: flame.y - (80 + Math.random() * 110),
        scale: 0.2,
        alpha: 0,
        duration: 600,
        ease: "Sine.easeOut",
        onComplete: () => flame.destroy(),
      });
    },
  });

  await wait(run, 800);
  pillars.remove();
  await tween(run, { targets: heat, fillAlpha: 0, duration: 250 });
  heat.destroy();
}

// --- any other class --------------------------------------------------------------

async function genericUltimate(run: RecapRun, from: { x: number; y: number }, panel: PanelRect): Promise<void> {
  const { scene } = run;
  playSfx("ultimate");
  scene.cameras.main.flash(scaled(run, 250), 255, 210, 90);
  await projectile(run, from, panel, 0xffd23f, 18);
  scene.cameras.main.shake(scaled(run, 350), 0.01);
  const c = panelCenter(panel);
  burstParticles(run, c.x, c.y, { count: 20, colors: [0xffd23f, 0xffffff], minDist: 50, maxDist: 140, duration: 550 });
}
