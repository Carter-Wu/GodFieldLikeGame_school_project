import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ClassDef } from "../model/classes.ts";
import { findRandomMatch, type RandomMatch } from "../online/randomMatch.ts";

export interface RandomLobbyProps {
  playerClass: ClassDef;
  /** One of the player's saved decks; null = starter deck. */
  deckId: string | null;
  deckName: string;
  onReady: (match: RandomMatch) => void;
  onBack: () => void;
}

/** Random-match lobby: wait in the Colyseus queue until a second player joins. */
export function RandomLobby({ playerClass, deckId, deckName, onReady, onBack }: RandomLobbyProps): ReactElement {
  const [status, setStatus] = useState("Connecting…");
  const [failed, setFailed] = useState(false);
  const matchRef = useRef<RandomMatch | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let offView: (() => void) | null = null;

    findRandomMatch(playerClass.id, deckId).then(
      (match) => {
        if (cancelled) {
          match.leave();
          return;
        }
        matchRef.current = match;
        // The first "state" message means both players are in.
        const start = (): void => {
          if (startedRef.current) return;
          startedRef.current = true;
          offView?.();
          onReady(match);
        };
        if (match.latest) start();
        else {
          setStatus("Looking for an opponent…");
          offView = match.onView(start);
        }
      },
      (err: Error) => {
        if (cancelled) return;
        setStatus(err.message || "Couldn't reach the match server.");
        setFailed(true);
      }
    );

    return () => {
      cancelled = true;
      offView?.();
    };
  }, []);

  const back = (): void => {
    if (!startedRef.current) matchRef.current?.leave();
    onBack();
  };

  return (
    <div className="shell-screen">
      <div className="shell-topbar">
        <span className="shell-title">Godfield-lite — Random match</span>
        <button type="button" className="shell-button" onClick={back}>
          Back
        </button>
      </div>
      <p className="shell-subtitle">
        Playing as {playerClass.name} · {deckName}
      </p>
      <p className="lobby-status">{status}</p>
      {failed ? (
        <button type="button" className="shell-button" onClick={back}>
          Back
        </button>
      ) : null}
    </div>
  );
}
