import { useEffect, useRef, type ReactElement } from "react";
import Phaser from "phaser";
import { BattleScene } from "../scenes/BattleScene.ts";
import { findClassById } from "../model/catalog.ts";
import { buildDeckFromList, type DeckListEntry } from "../model/decks.ts";
import { accountSettings, createPhaserGame } from "./phaserGame.ts";

export interface PhaserBattleProps {
  playerClassId: string;
  playerDeckList: DeckListEntry[] | null; // a validated custom deck; null = starter deck
  onExit: () => void;
  onAccountSettings?: (() => void) | null; // leave the match for Account settings; null/absent = no account
}

/** vs-CPU battle stage: the Phaser BattleScene owns all frames; React only mounts it. */
export function PhaserBattle({
  playerClassId,
  playerDeckList,
  onExit,
  onAccountSettings,
}: PhaserBattleProps): ReactElement {
  const mountRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onAccountRef = useRef(onAccountSettings);
  onAccountRef.current = onAccountSettings;

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
        playerDeck: playerDeckList ? buildDeckFromList(playerDeckList) : null,
        onExit: () => onExitRef.current(),
        onAccountSettings: accountSettings(onAccountRef),
      });
    });
    return () => {
      game.destroy(true);
    };
  }, [playerClassId, playerDeckList]);

  return <div className="phaser-mount" ref={mountRef} />;
}
