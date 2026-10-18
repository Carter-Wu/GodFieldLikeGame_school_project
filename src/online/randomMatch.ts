// Random match through the Colyseus server (server/BattleRoom.ts). The room
// lives from the lobby ("looking for an opponent") into the battle scene, so
// this wrapper keeps the latest view and hands it to whoever is listening.
import { Client, type Room } from "@colyseus/sdk";
import { supabase } from "./supabaseClient.ts";
import { toClientAction, type Action } from "../model/engine.ts";
import type { RandomMatchView } from "./randomMatchView.ts";

export type { RandomMatchView };

const COLYSEUS_URL = import.meta.env.VITE_COLYSEUS_URL ?? "ws://localhost:2567";
// Lets a reloaded tab get back into its match (the server holds the seat for
// 30 seconds). Per tab, like the Supabase session.
const TOKEN_KEY = "zenkake.randomMatch.reconnect";

function saveToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: reloading just won't rejoin
  }
}

function savedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export class RandomMatch {
  latest: RandomMatchView | null = null;
  closed = false;
  reconnecting = false; // our own connection dropped; the SDK is retrying
  // Local-clock deadlines (ms) from the latest view.
  turnDeadline: number | null = null;
  opponentDeadline: number | null = null;
  private viewListeners = new Set<(view: RandomMatchView) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private closeListeners = new Set<() => void>();
  private connectionListeners = new Set<() => void>();

  constructor(private room: Room) {
    saveToken(room.reconnectionToken);
    room.onMessage("state", (view: RandomMatchView) => {
      const now = Date.now();
      this.latest = view;
      this.turnDeadline = view.turnMsLeft === null ? null : now + view.turnMsLeft;
      this.opponentDeadline = view.opponentReconnectMsLeft === null ? null : now + view.opponentReconnectMsLeft;
      if (view.over) saveToken(null);
      for (const l of this.viewListeners) l(view);
    });
    room.onMessage("error", (message: string) => {
      for (const l of this.errorListeners) l(message);
    });
    room.onMessage("waiting", () => {});
    // Wifi blip / sleeping laptop: the SDK reconnects on its own.
    room.onDrop(() => {
      this.reconnecting = true;
      for (const l of this.connectionListeners) l();
    });
    room.onReconnect(() => {
      this.reconnecting = false;
      saveToken(room.reconnectionToken);
      for (const l of this.connectionListeners) l();
    });
    room.onLeave(() => {
      this.closed = true;
      this.reconnecting = false;
      saveToken(null);
      for (const l of this.closeListeners) l();
    });
  }

  onConnectionChange(listener: () => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  onView(listener: (view: RandomMatchView) => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  // This turn's plays; only card ids go over the wire, the server re-checks them.
  pick(action: Action): void {
    this.room.send("pick", toClientAction(action));
  }

  leave(): void {
    saveToken(null);
    if (!this.closed) void this.room.leave(true);
  }
}

export async function findRandomMatch(classId: string, deckId: string | null): Promise<RandomMatch> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in to an account to play online");
  const client = new Client(COLYSEUS_URL);
  // A reloaded tab still inside its 30 seconds goes back to the same match.
  const previous = savedToken();
  if (previous) {
    try {
      return new RandomMatch(await client.reconnect(previous));
    } catch {
      saveToken(null); // too late, or that match is over
    }
  }
  // Joins a room that is waiting for a second player, or opens a new one.
  const room = await client.joinOrCreate("battle", { token, classId, deckId });
  return new RandomMatch(room);
}
