// Small helpers shared by the round recap (roundRecap.ts) and the ultimate
// effects (ultimateFx.ts). `run` is the recap's state: { scene, layer, ... }
// -- everything is added to run.layer so the recap can clean up in one go,
// and timed with the scene's tweens/clock so the recap speed setting and
// click-to-skip apply to all of it.

import Phaser from "phaser";

export interface RecapRun {
  scene: Phaser.Scene;
  layer: Phaser.GameObjects.Container;
}

export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const hex = (color: number): string => `#${color.toString(16).padStart(6, "0")}`;
export const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function tween(run: RecapRun, config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
  return new Promise((resolve) => {
    run.scene.tweens.add({ ...config, onComplete: () => resolve() });
  });
}

export function wait(run: RecapRun, ms: number): Promise<void> {
  return new Promise((resolve) => {
    run.scene.time.delayedCall(ms, () => resolve());
  });
}

// Camera flash/shake run on real time, not the scene clock -- scale their
// duration by the current recap speed so they stay in step.
export function scaled(run: RecapRun, ms: number): number {
  return ms / run.scene.tweens.timeScale;
}

export function panelCenter(panel: PanelRect): { x: number; y: number } {
  return { x: panel.x + panel.w / 2, y: panel.y + panel.h / 2 };
}

// An orb with a fading trail, flying from `from` to the middle of `panel`.
export async function projectile(
  run: RecapRun,
  from: { x: number; y: number },
  panel: PanelRect,
  color: number,
  radius: number,
  { duration = 380 }: { duration?: number } = {}
): Promise<void> {
  const { scene, layer } = run;
  const to = panelCenter(panel);
  const orb = scene.add.circle(from.x, from.y, radius, color).setStrokeStyle(3, 0xffffff);
  layer.add(orb);

  const trail = scene.time.addEvent({
    delay: 25,
    loop: true,
    callback: () => {
      const dot = scene.add.circle(orb.x, orb.y, radius * 0.7, color, 0.6);
      layer.add(dot);
      scene.tweens.add({ targets: dot, alpha: 0, scale: 0.2, duration: 260, onComplete: () => dot.destroy() });
    },
  });
  await tween(run, { targets: orb, x: to.x, y: to.y, duration, ease: "Quad.easeIn" });
  trail.remove();
  orb.destroy();
}

export interface BurstOptions {
  count?: number;
  colors: number[];
  minDist?: number;
  maxDist?: number;
  minR?: number;
  maxR?: number;
  duration?: number;
  additive?: boolean;
}

// `count` particles flying outward from (x, y) and fading.
export function burstParticles(
  run: RecapRun,
  x: number,
  y: number,
  { count = 12, colors, minDist = 40, maxDist = 80, minR = 3, maxR = 6, duration = 420, additive = false }: BurstOptions
): void {
  const { scene, layer } = run;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist = minDist + Math.random() * (maxDist - minDist);
    const color = colors[i % colors.length] as number;
    const p = scene.add.circle(x, y, minR + Math.random() * (maxR - minR), color);
    if (additive) p.setBlendMode(Phaser.BlendModes.ADD);
    layer.add(p);
    scene.tweens.add({
      targets: p,
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      alpha: 0,
      scale: 0.3,
      duration,
      ease: "Cubic.easeOut",
      onComplete: () => p.destroy(),
    });
  }
}
