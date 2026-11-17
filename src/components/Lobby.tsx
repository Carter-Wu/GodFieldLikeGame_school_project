import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ClassDef } from "../model/classes.ts";
import { createPrivateMatch, joinPrivateMatch, type RandomMatch } from "../online/randomMatch.ts";

export interface LobbyProps {
  mode: "create" | "join";
  playerClass: ClassDef;
  /** One of the player's saved decks (decksApi.ts); null = starter deck. */
  deckId: string | null;
  deckName: string;
  /** For join mode: the room code supplied up front (from the join dialog). */
  code?: string;
  onReady: (match: RandomMatch) => void;
  onBack: () => void;
}

/**
 * Private-room lobby (React shell): create a room / join by code, wait for
 * start. The room lives on the Colyseus server, same as a random match, so
 * it gets the same turn timer and 30s reconnection.
 */
export function Lobby({ mode, playerClass, deckId, deckName, code, onReady, onBack }: LobbyProps): ReactElement {
  const [status, setStatus] = useState("Connecting…");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const matchRef = useRef<RandomMatch | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let offView: (() => void) | null = null;

    const connect =
      mode === "create" ? createPrivateMatch(playerClass.id, deckId) : joinPrivateMatch(code ?? "", playerClass.id, deckId);
    connect.then(
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
          if (mode === "create") {
            setRoomCode(match.code);
            setStatus("Send this room code to a friend. Waiting for them to join… (click the code to copy it)");
          } else setStatus("Joined! Starting the battle…");
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

  const copyCode = (): void => {
    if (!roomCode) return;
    navigator.clipboard?.writeText(roomCode).then(
      () => setStatus("Code copied! Waiting for your friend to join…"),
      () => {}
    );
  };

  const back = (): void => {
    // Close our room if nobody has joined yet, so it doesn't sit there open.
    if (!startedRef.current) matchRef.current?.leave();
    onBack();
  };

  return (
    <div className="shell-screen">
      <div className="shell-topbar">
        <span className="shell-title">Zenkake — Online</span>
        <button type="button" className="shell-button" onClick={back}>
          Back
        </button>
      </div>
      <p className="shell-subtitle">
        Playing as {playerClass.name} · {deckName}
      </p>
      {roomCode ? (
        <button type="button" className="lobby-code" onClick={copyCode} title="Click to copy">
          {roomCode}
        </button>
      ) : null}
      <p className="lobby-status">{status}</p>
      {failed ? (
        <button type="button" className="shell-button" onClick={back}>
          Back
        </button>
      ) : null}
    </div>
  );
}
