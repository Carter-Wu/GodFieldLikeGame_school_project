import { useEffect, useRef, type ReactElement } from "react";
import Phaser from "phaser";
import { RandomBattleScene } from "../scenes/RandomBattleScene.ts";
import type { RandomMatch } from "../online/randomMatch.ts";
import { createPhaserGame } from "./phaserGame.ts";

export interface PhaserRandomBattleProps {
  match: RandomMatch;
  onExit: () => void;
}

/** Random-match battle stage: mounts the Phaser RandomBattleScene. */
export function PhaserRandomBattle({ match, onExit }: PhaserRandomBattleProps): ReactElement {
  const mountRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const game = createPhaserGame(mount, []);
    game.events.once(Phaser.Core.Events.READY, () => {
      game.scene.add("RandomBattleScene", RandomBattleScene, true, { match, onExit: () => onExitRef.current() });
    });
    return () => {
      match.leave();
      game.destroy(true);
    };
  }, [match]);

  return <div className="phaser-mount" ref={mountRef} />;
}
