// Random match through the Colyseus server (server/BattleRoom.ts).
import { Client, type Room } from "@colyseus/sdk";
import { supabase } from "./supabaseClient.ts";
import type { ClientAction } from "../model/engine.ts";

const COLYSEUS_URL = import.meta.env.VITE_COLYSEUS_URL ?? "ws://localhost:2567";

export async function findRandomMatch(classId: string, deckId: string | null): Promise<Room> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in to an account to play online");
  // Joins a room that is waiting for a second player, or opens a new one.
  return new Client(COLYSEUS_URL).joinOrCreate("battle", { token, classId, deckId });
}

export function pick(room: Room, action: ClientAction): void {
  room.send("pick", action);
}
