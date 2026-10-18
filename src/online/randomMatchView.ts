// What the Colyseus server (server/BattleRoom.ts) sends each player after
// every change, from that player's point of view. Types only, so both the
// server and the browser can import it.
import type { SerializedFighter } from "../model/serialize.ts";

export interface RandomMatchView {
  round: number;
  me: SerializedFighter; // includes my hand, never my deck order
  opponent: SerializedFighter; // public info only
  log: string[];
  over: boolean;
  result: "win" | "lose" | "draw" | null;
  myReady: boolean;
  opponentReady: boolean;
  turnMsLeft: number | null; // time left to end this turn; null when the match is over
  opponentReconnectMsLeft: number | null; // set while the opponent is disconnected
}
