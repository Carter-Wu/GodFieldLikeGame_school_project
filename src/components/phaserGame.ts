import Phaser from "phaser";
import { COLORS, GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE } from "../scenes/theme.ts";

// Text objects are rasterized to their own small canvas at 1x by default, so
// the camera zoom would just stretch that bitmap and they'd stay blurry.
// Default every this.add.text(...) to render at RENDER_SCALE instead; a style
// that sets its own `resolution` still wins. (Mirrors the old main.js boot.)
const addText = Phaser.GameObjects.GameObjectFactory.prototype.text;
let textPatched = false;

function ensureCrispText(): void {
  if (textPatched) return;
  textPatched = true;
  Phaser.GameObjects.GameObjectFactory.prototype.text = function (
    x: number,
    y: number,
    text: string | string[],
    style: Phaser.Types.GameObjects.Text.TextStyle = {}
  ) {
    return addText.call(this, x, y, text, { resolution: RENDER_SCALE, ...style });
  };
}

/** Create a Phaser.Game scoped to one container div (destroyed on unmount). */
export function createPhaserGame(
  parent: HTMLElement,
  scenes: Phaser.Types.Scenes.SceneType[]
): Phaser.Game {
  ensureCrispText();
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    // The canvas is RENDER_SCALE times the 960x760 layout size so it has
    // enough real pixels for HiDPI screens; scenes zoom their camera to match.
    width: GAME_WIDTH * RENDER_SCALE,
    height: GAME_HEIGHT * RENDER_SCALE,
    backgroundColor: COLORS.background,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: scenes,
  });
}
