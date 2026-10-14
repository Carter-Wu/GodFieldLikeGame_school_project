// A player's saved custom decks (the `decks` table,
// supabase/migrations/*_player_decks.sql). Read and written straight from
// the browser -- RLS only lets each player touch their own rows, and the
// table itself caps each player at DECK_RULES.maxDecksPerClass per class.

import { DECK_RULES, type DeckListEntry } from "../model/decks.ts";
import { supabase } from "./supabaseClient.ts";

export interface SavedDeck {
  id: string;
  classId: string;
  name: string;
  cards: DeckListEntry[];
  updatedAt: string;
}

interface DeckRow {
  id: string;
  class_id: string;
  name: string;
  cards: DeckListEntry[];
  updated_at: string;
}

const toDeck = (row: DeckRow): SavedDeck => ({
  id: row.id,
  classId: row.class_id,
  name: row.name,
  cards: row.cards ?? [],
  updatedAt: row.updated_at,
});

function fail(error: { message: string }): never {
  if (error.message.includes("deck_limit")) {
    throw new Error(`You can have at most ${DECK_RULES.maxDecksPerClass} decks per class. Delete one first.`);
  }
  throw new Error(error.message);
}

// Every deck of the logged-in player, oldest first.
export async function listDecks(): Promise<SavedDeck[]> {
  const { data, error } = await supabase
    .from("decks")
    .select("id, class_id, name, cards, updated_at")
    .order("created_at", { ascending: true });
  if (error) fail(error);
  return (data as DeckRow[]).map(toDeck);
}

export async function createDeck(classId: string, name: string, cards: DeckListEntry[]): Promise<SavedDeck> {
  const { data, error } = await supabase
    .from("decks")
    .insert({ class_id: classId, name: name.trim(), cards })
    .select("id, class_id, name, cards, updated_at")
    .single();
  if (error) fail(error);
  return toDeck(data as DeckRow);
}

export async function updateDeck(id: string, name: string, cards: DeckListEntry[]): Promise<SavedDeck> {
  const { data, error } = await supabase
    .from("decks")
    .update({ name: name.trim(), cards })
    .eq("id", id)
    .select("id, class_id, name, cards, updated_at")
    .single();
  if (error) fail(error);
  return toDeck(data as DeckRow);
}

export async function deleteDeck(id: string): Promise<void> {
  const { error } = await supabase.from("decks").delete().eq("id", id);
  if (error) fail(error);
}
