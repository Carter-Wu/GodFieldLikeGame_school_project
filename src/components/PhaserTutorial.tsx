import { useEffect, useRef, type ReactElement } from "react";
import Phaser from "phaser";
import { TutorialBattleScene } from "../scenes/TutorialBattleScene.ts";
import { accountSettings, createPhaserGame } from "./phaserGame.ts";

export interface PhaserTutorialProps {
  onExit: () => void;
  onAccountSettings?: (() => void) | null; // leave the match for Account settings; null/absent = no account
}

/** Guided practice match: the Phaser TutorialBattleScene owns all frames; React only mounts it. */
export function PhaserTutorial({ onExit, onAccountSettings }: PhaserTutorialProps): ReactElement {
  const mountRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onAccountRef = useRef(onAccountSettings);
  onAccountRef.current = onAccountSettings;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const game = createPhaserGame(mount, []);
    game.events.once(Phaser.Core.Events.READY, () => {
      // The scene picks its own class and decks; playerClass is unused.
      game.scene.add("TutorialBattleScene", TutorialBattleScene, true, {
        onExit: () => onExitRef.current(),
        onAccountSettings: accountSettings(onAccountRef),
      });
    });
    return () => {
      game.destroy(true);
    };
  }, []);

  return <div className="phaser-mount" ref={mountRef} />;
}
