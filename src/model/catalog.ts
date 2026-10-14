// The game catalog -- every class, synergy, and card the engine can use --
// loaded from the Supabase catalog tables (supabase/migrations/*_game_catalog.sql)
// or, offline, from the local copy in catalogData.ts.
//
// Rows are turned into the same objects the rest of src/model/ has always
// used (createClass / createSynergy shapes), and kept in one module-level
// catalog. Everything that looks things up (findClassById, allClasses,
// buildDeckForClass) is synchronous, so callers only have to make sure a
// catalog was loaded once before starting -- main.js does that before Phaser
// starts, the Edge Function before handling a request.
//
// Deliberately forgiving about data it doesn't understand, so rows added for
// a newer version of the game don't break an older build: cards with an
// unknown category are left out of decks, deck/synergy links to missing rows
// are dropped, and unknown stats are ignored by createStats. Each is warned
// about once in the console.

import { createClass, type ClassDef, type Ultimate } from "./classes.ts";
import { createSynergy, type Synergy, type SynergyTier } from "./synergies.ts";
import { CARD_CATEGORY, createCardInstance, type Card, type CardCategory } from "./cardTypes.ts";
import { shuffle } from "./util.ts";
import { LOCAL_CATALOG_ROWS } from "./catalogData.ts";
import type { Stats } from "./stats.ts";
import type { Effect } from "./effects.ts";

const KNOWN_CATEGORIES = new Set<string>(Object.values(CARD_CATEGORY));
const TABLES = ["synergies", "classes", "class_synergies", "cards", "class_deck_cards"] as const;

export interface SynergyRow {
  id: string;
  name: string;
  description?: string | null;
  counts_category: string;
  tiers?: SynergyTier[] | null;
}

export interface ClassRow {
  id: string;
  name: string;
  base_stats?: Partial<Stats> | null;
  ultimate: Ultimate;
  passives?: Effect[] | null;
  sort_order?: number | null;
}

export interface ClassSynergyRow {
  class_id: string;
  synergy_id: string;
}

export interface CardRow {
  id: string;
  name: string;
  category: string;
  props?: Record<string, unknown> | null;
  image_url?: string | null;
}

export interface ClassDeckCardRow {
  class_id: string;
  card_id: string;
  copies: number;
}

export interface CatalogRows {
  synergies: SynergyRow[];
  classes: ClassRow[];
  class_synergies: ClassSynergyRow[];
  cards: CardRow[];
  class_deck_cards: ClassDeckCardRow[];
}

export interface CatalogCardEntry {
  id: string;
  name: string;
  category: CardCategory;
  props: Record<string, unknown>;
  imageUrl: string | null;
}

export interface DeckEntry {
  copies: number;
  card: CatalogCardEntry;
}

export interface Catalog {
  source: string; // "supabase" | "local" -- where these rows came from
  classes: ClassDef[];
  classById: Map<string, ClassDef>;
  cards: Map<string, CatalogCardEntry>;
  deckByClass: Map<string, DeckEntry[]>;
}

let current: Catalog | null = null;

export interface SupabaseCatalogClient {
  from(table: string): {
    select(columns: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
}

// rows: { synergies, classes, class_synergies, cards, class_deck_cards },
// each an array of table rows.
export function buildCatalog(rows: CatalogRows, source = "unknown"): Catalog {
  const warn = (message: string): void => console.warn(`[catalog] ${message}`);

  const synergies = new Map<string, Synergy>();
  for (const row of rows.synergies) {
    synergies.set(
      row.id,
      createSynergy({
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        countsCategory: row.counts_category as CardCategory,
        tiers: [...(row.tiers ?? [])].sort((a, b) => a.count - b.count),
      })
    );
  }

  const cards = new Map<string, CatalogCardEntry>();
  for (const row of rows.cards) {
    if (!KNOWN_CATEGORIES.has(row.category)) {
      warn(`skipping card "${row.id}": unknown category "${row.category}"`);
      continue;
    }
    cards.set(row.id, {
      id: row.id,
      name: row.name,
      category: row.category as CardCategory,
      props: (row.props ?? {}) as Record<string, unknown>,
      imageUrl: row.image_url ?? null, // optional artwork; null = use the category icon
    });
  }

  const poolByClass = new Map<string, Synergy[]>();
  for (const link of rows.class_synergies) {
    const synergy = synergies.get(link.synergy_id);
    if (!synergy) {
      warn(`class "${link.class_id}" links missing synergy "${link.synergy_id}"`);
      continue;
    }
    if (!poolByClass.has(link.class_id)) poolByClass.set(link.class_id, []);
    poolByClass.get(link.class_id)!.push(synergy);
  }

  const deckByClass = new Map<string, DeckEntry[]>();
  for (const entry of rows.class_deck_cards) {
    const card = cards.get(entry.card_id);
    if (!card) continue; // already warned above if it was an unknown category
    if (!deckByClass.has(entry.class_id)) deckByClass.set(entry.class_id, []);
    deckByClass.get(entry.class_id)!.push({ copies: entry.copies, card });
  }

  const classes = [...rows.classes]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id))
    .map((row) =>
      createClass({
        id: row.id,
        name: row.name,
        baseStats: row.base_stats ?? {},
        synergyPool: poolByClass.get(row.id) ?? [],
        ultimate: row.ultimate,
        passives: row.passives ?? [],
      })
    );

  return {
    source, // "supabase" | "local" -- where these rows came from
    classes,
    classById: new Map(classes.map((c) => [c.id, c])),
    cards,
    deckByClass,
  };
}

export function setCatalog(catalog: Catalog): void {
  current = catalog;
}

export function getCatalog(): Catalog {
  if (!current) throw new Error("Game catalog not loaded yet -- call loadCatalog() / useLocalCatalog() first");
  return current;
}

export function useLocalCatalog(): Catalog {
  setCatalog(buildCatalog(LOCAL_CATALOG_ROWS, "local"));
  return current!;
}

// `client` is a supabase-js client -- the browser's (publishable key) or the
// Edge Function's (service role); both can read the catalog.
export async function fetchCatalogRows(client: SupabaseCatalogClient): Promise<CatalogRows> {
  const results = await Promise.all(TABLES.map((table) => client.from(table).select("*")));
  const rows: Record<string, unknown[]> = {};
  TABLES.forEach((table, i) => {
    const { data, error } = results[i] as { data: unknown[] | null; error: { message: string } | null };
    if (error) throw new Error(`Couldn't load ${table}: ${error.message}`);
    rows[table] = data ?? [];
  });
  if ((rows["classes"] as unknown[]).length === 0) throw new Error("The classes table is empty");
  return rows as unknown as CatalogRows;
}

export async function loadCatalog(client: SupabaseCatalogClient): Promise<Catalog> {
  setCatalog(buildCatalog(await fetchCatalogRows(client), "supabase"));
  return current!;
}

// --- lookups used by the engine, serializer, UI, and server -------------

export function allClasses(): ClassDef[] {
  return getCatalog().classes;
}

export function findClassById(id: string): ClassDef {
  const classDef = getCatalog().classById.get(id);
  if (!classDef) throw new Error(`Unknown class "${id}"`);
  return classDef;
}

// Every card in the catalog (not just ones in a deck). Unordered -- callers
// that display them should sort.
export function allCards(): CatalogCardEntry[] {
  return [...getCatalog().cards.values()];
}

export function findCardById(id: string): CatalogCardEntry | null {
  return getCatalog().cards.get(id) ?? null;
}

// Which classes start with this card, and how many copies:
// [{ classDef, copies }]. Used by the card gallery.
export function deckEntriesForCard(cardId: string): { classDef: ClassDef; copies: number }[] {
  const catalog = getCatalog();
  const result: { classDef: ClassDef; copies: number }[] = [];
  for (const classDef of catalog.classes) {
    const entry = (catalog.deckByClass.get(classDef.id) ?? []).find((e) => e.card.id === cardId);
    if (entry) result.push({ classDef, copies: entry.copies });
  }
  return result;
}

// A fresh shuffled deck of card instances for a class.
export function buildDeckForClass(classDef: ClassDef): Card[] {
  const entries = getCatalog().deckByClass.get(classDef.id);
  if (!entries || entries.length === 0) throw new Error(`No deck for class "${classDef.id}"`);
  const deck: Card[] = [];
  for (const { copies, card } of entries) {
    for (let i = 0; i < copies; i++) deck.push(createCardInstance(card));
  }
  return shuffle(deck);
}
