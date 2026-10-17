// Random match through the Colyseus server (server/BattleRoom.ts). The room
// lives from the lobby ("looking for an opponent") into the battle scene, so
// this wrapper keeps the latest view and hands it to whoever is listening.
import { Client, type Room } from "@colyseus/sdk";
import { supabase } from "./supabaseClient.ts";
import { toClientAction, type Action } from "../model/engine.ts";
import type { RandomMatchView } from "./randomMatchView.ts";

export type { RandomMatchView };

const COLYSEUS_URL = import.meta.env.VITE_COLYSEUS_URL ?? "ws://localhost:2567";

export class RandomMatch {
  latest: RandomMatchView | null = null;
  closed = false;
  private viewListeners = new Set<(view: RandomMatchView) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private closeListeners = new Set<() => void>();

  constructor(private room: Room) {
    room.onMessage("state", (view: RandomMatchView) => {
      this.latest = view;
      for (const l of this.viewListeners) l(view);
    });
    room.onMessage("error", (message: string) => {
      for (const l of this.errorListeners) l(message);
    });
    room.onMessage("waiting", () => {});
    room.onLeave(() => {
      this.closed = true;
      for (const l of this.closeListeners) l();
    });
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
    if (!this.closed) void this.room.leave(true);
  }
}

export async function findRandomMatch(classId: string, deckId: string | null): Promise<RandomMatch> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in to an account to play online");
  // Joins a room that is waiting for a second player, or opens a new one.
  const room = await new Client(COLYSEUS_URL).joinOrCreate("battle", { token, classId, deckId });
  return new RandomMatch(room);
}
