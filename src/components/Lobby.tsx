import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ClassDef } from "../model/classes.ts";
import { createPrivateMatch, joinPrivateMatch, type RandomMatch } from "../online/randomMatch.ts";
import { RoomScreen } from "./RoomScreen.tsx";

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

type Phase = "connecting" | "waiting" | "joined" | "failed";

/**
 * Private-room lobby (React shell): create a room / join by code, wait for
 * start. The room lives on the Colyseus server, same as a random match, so
 * it gets the same turn timer and 30s reconnection.
 */
export function Lobby({ mode, playerClass, deckId, deckName, code, onReady, onBack }: LobbyProps): ReactElement {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [error, setError] = useState("");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const matchRef = useRef<RandomMatch | null>(null);
  const startedRef = useRef(false);
  const copiedTimer = useRef<number | undefined>(undefined);

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
            setPhase("waiting");
          } else setPhase("joined");
          offView = match.onView(start);
        }
      },
      (err: Error) => {
        if (cancelled) return;
        setError(err.message || "Couldn't reach the match server.");
        setPhase("failed");
      }
    );

    return () => {
      cancelled = true;
      offView?.();
      window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const copyCode = (): void => {
    if (!roomCode) return;
    navigator.clipboard?.writeText(roomCode).then(
      () => {
        setCopied(true);
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1800);
      },
      () => {}
    );
  };

  const back = (): void => {
    // Close our room if nobody has joined yet, so it doesn't sit there open.
    if (!startedRef.current) matchRef.current?.leave();
    onBack();
  };

  return (
    <RoomScreen
      title="Private Room"
      playerClass={playerClass}
      deckName={deckName}
      onBack={back}
      toast={copied ? "Room code copied" : null}
    >
      {phase === "waiting" && roomCode ? (
        <>
          <p className="room-label">Room code</p>
          <button
            type="button"
            className={`room-code${copied ? " copied" : ""}`}
            onClick={copyCode}
            aria-label={`Room code ${roomCode}. Click to copy.`}
          >
            <span className="room-code-ring" aria-hidden="true" />
            <span className="room-code-text">{roomCode}</span>
            <span className="room-code-hint">{copied ? "✓ Copied!" : "Click to copy"}</span>
          </button>
          <p className="room-note">Send this code to a friend.</p>
          <p className="room-status waiting">Waiting for them to join</p>
        </>
      ) : phase === "failed" ? (
        <>
          <p className="room-status error">{error}</p>
          <button type="button" className="room-action" onClick={back}>
            Back to lobby
          </button>
        </>
      ) : (
        <>
          <span className="room-seal" aria-hidden="true" />
          <p className="room-status waiting">
            {phase === "joined" ? "Joined! Starting the battle" : mode === "join" ? `Joining room ${code ?? ""}` : "Opening a room"}
          </p>
        </>
      )}
    </RoomScreen>
  );
}
