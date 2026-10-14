import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ClassDef } from "../model/classes.ts";
import type { Card } from "../model/cardTypes.ts";
import {
  createMatch,
  ensureSignedIn,
  fetchHand,
  fetchMatch,
  fetchMatchVersion,
  joinMatch,
  leaveMatch,
  watchMatch,
  type MatchRow,
} from "../online/matchApi.ts";

export interface LobbyReady {
  matchId: string;
  userId: string;
  match: MatchRow;
  hand: Card[];
}

export interface LobbyProps {
  mode: "create" | "join";
  playerClass: ClassDef;
  /** For join mode: the room code supplied up front (from the join dialog). */
  code?: string;
  onReady: (ready: LobbyReady) => void;
  onBack: () => void;
}

/** Online lobby (React shell): create a room / join by code, wait for start. */
export function Lobby({ mode, playerClass, code, onReady, onBack }: LobbyProps): ReactElement {
  const [status, setStatus] = useState("Connecting…");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const stateRef = useRef({ matchId: null as string | null, userId: null as string | null, starting: false, stopWatching: null as (() => void) | null, gone: false });

  useEffect(() => {
    const s = stateRef.current;
    let cancelled = false;

    async function checkStarted(): Promise<void> {
      if (s.starting || s.gone || !s.matchId) return;
      let version;
      try {
        version = await fetchMatchVersion(s.matchId);
      } catch {
        return; // try again on the next event/poll
      }
      if (s.starting || s.gone || cancelled) return;
      if (version.round === 0) {
        if (version.status === "finished") {
          setStatus("This room was closed.");
          s.stopWatching?.();
        }
        return;
      }
      s.starting = true;
      try {
        const [match, hand] = await Promise.all([fetchMatch(s.matchId), fetchHand(s.matchId, s.userId!)]);
        if (s.gone || cancelled) return;
        s.stopWatching?.();
        onReady({ matchId: s.matchId, userId: s.userId!, match, hand });
      } catch {
        s.starting = false; // try again on the next event/poll
      }
    }

    async function run(): Promise<void> {
      try {
        setStatus("Connecting…");
        const userId = await ensureSignedIn();
        if (cancelled) return;
        s.userId = userId;
        if (mode === "create") {
          const match = await createMatch(playerClass.id);
          if (cancelled) return;
          s.matchId = match.id;
          setRoomCode(match.code);
          setStatus("Send this room code to a friend. Waiting for them to join… (click the code to copy it)");
        } else {
          const match = await joinMatch(code ?? "", playerClass.id);
          if (cancelled) return;
          s.matchId = match.id;
          setStatus("Joined! Starting the battle…");
        }
        s.stopWatching = watchMatch(s.matchId, () => void checkStarted());
      } catch (err) {
        if (!cancelled) {
          setStatus((err as Error).message);
          setFailed(true);
        }
      }
    }
    void run();

    return () => {
      cancelled = true;
      s.gone = true;
      s.stopWatching?.();
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
    const s = stateRef.current;
    // Close our room if nobody has joined yet, so it doesn't sit there open.
    if (s.matchId && !s.starting) leaveMatch(s.matchId).catch(() => {});
    s.gone = true;
    s.stopWatching?.();
    onBack();
  };

  return (
    <div className="shell-screen">
      <div className="shell-topbar">
        <span className="shell-title">Godfield-lite — Online</span>
        <button type="button" className="shell-button" onClick={back}>
          Back
        </button>
      </div>
      <p className="shell-subtitle">Playing as {playerClass.name}</p>
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
