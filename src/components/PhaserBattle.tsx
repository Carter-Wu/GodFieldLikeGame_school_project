import { useEffect, useRef, type ReactElement } from "react";
import Phaser from "phaser";
import { BattleScene } from "../scenes/BattleScene.ts";
import { findClassById } from "../model/catalog.ts";
import { createPhaserGame } from "./phaserGame.ts";

export interface PhaserBattleProps {
  playerClassId: string;
  onExit: () => void;
}

/** vs-CPU battle stage: the Phaser BattleScene owns all frames; React only mounts it. */
export function PhaserBattle({ playerClassId, onExit }: PhaserBattleProps): ReactElement {
  const mountRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const playerClass = findClassById(playerClassId);
    // No scenes in the config: the battle scene is added (with its data) once
    // the game is ready, so create() never runs without a playerClass.
    const game = createPhaserGame(mount, []);
    game.events.once(Phaser.Core.Events.READY, () => {
      game.scene.add("BattleScene", BattleScene, true, {
        playerClass,
        onExit: () => onExitRef.current(),
      });
    });
    return () => {
      game.destroy(true);
    };
  }, [playerClassId]);

  return <div className="phaser-mount" ref={mountRef} />;
}
