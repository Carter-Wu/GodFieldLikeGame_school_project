import { useEffect, useRef, type ReactElement } from "react";
import Phaser from "phaser";
import { OnlineBattleScene } from "../scenes/OnlineBattleScene.ts";
import type { Card } from "../model/cardTypes.ts";
import type { MatchRow } from "../online/matchApi.ts";
import { createPhaserGame } from "./phaserGame.ts";

export interface PhaserOnlineBattleProps {
  matchId: string;
  userId: string;
  match: MatchRow;
  hand: Card[];
  onExit: () => void;
}

/** Online battle stage: the Phaser OnlineBattleScene owns all frames; React only mounts it. */
export function PhaserOnlineBattle({ matchId, userId, match, hand, onExit }: PhaserOnlineBattleProps): ReactElement {
  const mountRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    // No scenes in the config: the battle scene is added (with its data) once
    // the game is ready, so create() never runs without match data.
    const game = createPhaserGame(mount, []);
    game.events.once(Phaser.Core.Events.READY, () => {
      game.scene.add("OnlineBattleScene", OnlineBattleScene, true, {
        matchId,
        userId,
        match,
        hand,
        onExit: () => onExitRef.current(),
      });
    });
    return () => {
      game.destroy(true);
    };
  }, [matchId]);

  return <div className="phaser-mount" ref={mountRef} />;
}
