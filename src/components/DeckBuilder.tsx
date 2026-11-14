import { useMemo, useState, type DragEvent, type ReactElement } from "react";
import type { ClassDef } from "../model/classes.ts";
import { CARD_CATEGORY, cardCost, cardRarity, RARITY, RARITY_LABEL, type Card, type CardCategory } from "../model/cardTypes.ts";
import type { CatalogCardEntry } from "../model/catalog.ts";
import { describeCard, describeMonsterOrders } from "../model/engine.ts";
import {
  DECK_RULES,
  classCardPool,
  deckRarityPoints,
  maxCopiesOf,
  rarityPointsOf,
  deckSize,
  starterDeckList,
  validateDeckList,
  type DeckListEntry,
} from "../model/decks.ts";
import { createDeck, deleteDeck, updateDeck, type SavedDeck } from "../online/decksApi.ts";
import { FramedCard } from "./FramedCard.tsx";

export interface DeckBuilderProps {
  classDef: ClassDef;
  decks: SavedDeck[]; // this player's saved decks for classDef
  initialDeckId: string | null; // which one to open first (null = starter)
  onDecksChanged: (selectDeckId: string | null) => void; // after a save/delete: reload, and pick this deck
  confirm: (title: string, message: string, confirmLabel: string, onYes: () => void) => void;
  onBack: () => void;
}

// What the editor is showing: the read-only starter deck, a saved deck, or a
// new deck that hasn't been saved yet.
type Draft = { kind: "starter" } | { kind: "saved"; id: string } | { kind: "new" };

type Filter = "all" | CardCategory;

const CATEGORIES = Object.values(CARD_CATEGORY);
const CATEGORY_LABEL: Record<CardCategory, string> = {
  attack: "Attack",
  defend: "Defend",
  buff: "Buff",
  debuff: "Debuff",
  monster: "Monster",
};

// Drag payloads: where the card came from, so a drop knows whether to add or remove.
const DRAG_TYPE = "text/plain";
const dragFrom = (source: "pool" | "deck", cardId: string) => (e: DragEvent): void => {
  e.dataTransfer.setData(DRAG_TYPE, `${source}:${cardId}`);
  e.dataTransfer.effectAllowed = "move";
};
const readDrag = (e: DragEvent): { source: string; cardId: string } => {
  const [source = "", cardId = ""] = e.dataTransfer.getData(DRAG_TYPE).split(":");
  return { source, cardId };
};

const toCounts = (list: DeckListEntry[]): Record<string, number> =>
  Object.fromEntries(list.map((e) => [e.cardId, e.copies]));

// Deck order: by category, then AP cost, then name.
const byCategoryCost = (a: CatalogCardEntry, b: CatalogCardEntry): number =>
  CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
  cardCost(a.props) - cardCost(b.props) ||
  a.name.localeCompare(b.name);

const asCard = (card: CatalogCardEntry): Card => ({ ...card.props, category: card.category, name: card.name }) as Card;

interface CardTileProps {
  card: CatalogCardEntry;
  badge?: string;
  dim?: boolean;
  selected?: boolean;
  draggable?: boolean;
  onSelect: () => void;
  onPrimary?: () => void; // double-click
  onSecondary?: () => void; // right-click
  onDragStart?: (e: DragEvent) => void;
}

/** One card as a small portrait tile: art, AP cost, name. */
function CardTile({ card, badge, dim, selected, draggable, onSelect, onPrimary, onSecondary, onDragStart }: CardTileProps): ReactElement {
  // Rare and legend tiles: a border just inside the tile and a gem before
  // the name, like the full card faces (FramedCard, cardFace.ts).
  const rarity = cardRarity(card.props);
  const marked = rarity !== RARITY.NORMAL;
  return (
    <button
      type="button"
      className={`card-tile ${card.category} rarity-${rarity}${dim ? " dim" : ""}${selected ? " selected" : ""}`}
      title={marked ? `${card.name} (${RARITY_LABEL[rarity]})` : card.name}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onSelect}
      onDoubleClick={onPrimary}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect();
        onSecondary?.();
      }}
    >
      {card.imageUrl ? (
        <img className="card-tile-art" src={card.imageUrl} alt="" loading="lazy" draggable={false} />
      ) : (
        <span className={`card-tile-art gallery-art fallback ${card.category}`}>{card.category}</span>
      )}
      {marked ? <span className="card-tile-rarity" aria-hidden="true" /> : null}
      <span className="card-tile-cost">{cardCost(card.props)}</span>
      {badge ? <span className="card-tile-badge">{badge}</span> : null}
      <span className="card-tile-name">
        {marked ? <span className="card-tile-gem" aria-label={RARITY_LABEL[rarity]} /> : null}
        {card.name}
      </span>
    </button>
  );
}

/** Deck builder (React shell): the starter deck plus up to 3 custom decks for one class. */
export function DeckBuilder({ classDef, decks, initialDeckId, onDecksChanged, confirm, onBack }: DeckBuilderProps): ReactElement {
  const pool = useMemo(() => [...classCardPool(classDef)].sort(byCategoryCost), [classDef]);
  const starter = useMemo(() => starterDeckList(classDef), [classDef]);

  const openFor = (id: string | null): { draft: Draft; name: string; counts: Record<string, number> } => {
    const saved = id ? decks.find((d) => d.id === id) : undefined;
    return saved
      ? { draft: { kind: "saved", id: saved.id }, name: saved.name, counts: toCounts(saved.cards) }
      : { draft: { kind: "starter" }, name: "Starter deck", counts: toCounts(starter) };
  };

  const initial = openFor(initialDeckId);
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [name, setName] = useState(initial.name);
  const [counts, setCounts] = useState<Record<string, number>>(initial.counts);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(pool[0]?.id ?? null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [dropTarget, setDropTarget] = useState<"deck" | "pool" | null>(null);

  const readOnly = draft.kind === "starter";
  const list: DeckListEntry[] = pool.filter((c) => (counts[c.id] ?? 0) > 0).map((c) => ({ cardId: c.id, copies: counts[c.id]! }));
  const total = deckSize(list);
  const problem = validateDeckList(classDef, list);
  const atLimit = decks.length >= DECK_RULES.maxDecksPerClass;
  const sizeOk = total >= DECK_RULES.minCards && total <= DECK_RULES.maxCards;

  // One tile per copy, in deck order.
  const deckTiles = pool.flatMap((card) => Array.from({ length: counts[card.id] ?? 0 }, (_, i) => ({ card, key: `${card.id}-${i}` })));
  const perCategory = CATEGORIES.map((cat) => ({
    cat,
    n: pool.filter((c) => c.category === cat).reduce((sum, c) => sum + (counts[c.id] ?? 0), 0),
  })).filter((x) => x.n > 0);

  const query = search.trim().toLowerCase();
  const shownPool = pool.filter(
    (c) => (filter === "all" || c.category === filter) && (!query || c.name.toLowerCase().includes(query))
  );
  const selected = pool.find((c) => c.id === selectedId) ?? null;
  const selectedCopies = selected ? (counts[selected.id] ?? 0) : 0;

  // Switching away from unsaved edits asks first.
  const guard = (go: () => void): void => {
    if (!dirty) return go();
    confirm("Discard changes?", "This deck has unsaved changes.", "Discard", go);
  };

  const show = (next: { draft: Draft; name: string; counts: Record<string, number> }): void => {
    setDraft(next.draft);
    setName(next.name);
    setCounts(next.counts);
    setDirty(false);
    setError(null);
  };

  const startNew = (from: DeckListEntry[]): void => {
    if (atLimit) {
      setError(`You already have ${DECK_RULES.maxDecksPerClass} ${classDef.name} decks. Delete one to make another.`);
      return;
    }
    show({ draft: { kind: "new" }, name: `${classDef.name} deck ${decks.length + 1}`, counts: toCounts(from) });
    setDirty(true);
  };

  const limitOf = (cardId: string): number => maxCopiesOf(pool.find((c) => c.id === cardId));
  const overLimit = pool.some((c) => (counts[c.id] ?? 0) > maxCopiesOf(c));
  const points = deckRarityPoints(list);
  const overBudget = points > DECK_RULES.maxRarityPoints;
  // Room for one more copy: under its copy limit, and its rarity points fit.
  const canAdd = (card: CatalogCardEntry | null | undefined): boolean =>
    Boolean(card) &&
    (counts[card!.id] ?? 0) < maxCopiesOf(card) &&
    points + rarityPointsOf(card) <= DECK_RULES.maxRarityPoints;

  const setCopies = (cardId: string, copies: number): void => {
    setCounts((c) => ({ ...c, [cardId]: Math.max(0, Math.min(limitOf(cardId), copies)) }));
    setDirty(true);
  };

  const addOne = (cardId: string): void => {
    if (readOnly || !canAdd(pool.find((c) => c.id === cardId))) return;
    setCopies(cardId, (counts[cardId] ?? 0) + 1);
  };

  const removeOne = (cardId: string): void => {
    if (readOnly || (counts[cardId] ?? 0) === 0) return;
    setCopies(cardId, (counts[cardId] ?? 0) - 1);
  };

  const dropZone = (zone: "deck" | "pool") => ({
    onDragOver: (e: DragEvent): void => {
      if (readOnly) return;
      e.preventDefault();
      setDropTarget(zone);
    },
    onDragLeave: (): void => setDropTarget(null),
    onDrop: (e: DragEvent): void => {
      e.preventDefault();
      setDropTarget(null);
      const { source, cardId } = readDrag(e);
      if (zone === "deck" && source === "pool") addOne(cardId);
      if (zone === "pool" && source === "deck") removeOne(cardId);
    },
  });

  const save = async (): Promise<void> => {
    if (readOnly || busy || problem || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const saved =
        draft.kind === "saved" ? await updateDeck(draft.id, name, list) : await createDeck(classDef.id, name, list);
      setDraft({ kind: "saved", id: saved.id });
      setDirty(false);
      onDecksChanged(saved.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = (): void => {
    if (draft.kind === "starter") return;
    if (draft.kind === "new") return show(openFor(null));
    const id = draft.id;
    confirm("Delete deck?", `"${name}" will be deleted for good.`, "Delete", () => {
      setBusy(true);
      deleteDeck(id).then(
        () => {
          setBusy(false);
          show(openFor(null));
          onDecksChanged(null);
        },
        (err: Error) => {
          setBusy(false);
          setError(err.message);
        }
      );
    });
  };

  const isOpen = (d: Draft): boolean =>
    d.kind === draft.kind && (d.kind !== "saved" || (draft.kind === "saved" && d.id === draft.id));

  return (
    <div className="shell-screen deck-builder">
      <div className="shell-topbar">
        <span className="shell-title">{classDef.name} decks</span>
        <button type="button" className="shell-button" onClick={() => guard(onBack)}>
          ← Back
        </button>
      </div>
      <ul className="deck-rules" aria-label="Deck rules">
        <li className={`deck-rule${sizeOk ? " ok" : " bad"}`}>
          <span className="deck-rule-label">Deck size</span>
          <span className="deck-rule-value">
            {DECK_RULES.minCards}–{DECK_RULES.maxCards} cards
          </span>
          <span className="deck-rule-now">now {total}</span>
        </li>
        <li className={`deck-rule${overLimit ? " bad" : " ok"}`}>
          <span className="deck-rule-label">Copies</span>
          <span className="deck-rule-value">
            Normal {DECK_RULES.maxCopies.normal} · Rare {DECK_RULES.maxCopies.rare} · Legend {DECK_RULES.maxCopies.legend}
          </span>
          <span className="deck-rule-now">{classDef.name} cards only</span>
        </li>
        <li className={`deck-rule${overBudget ? " bad" : points === DECK_RULES.maxRarityPoints ? " full" : " ok"}`}>
          <span className="deck-rule-label">Rarity budget</span>
          <span className="deck-rule-value">
            max {DECK_RULES.maxRarityPoints} pts · Rare {DECK_RULES.rarityPoints.rare} · Legend {DECK_RULES.rarityPoints.legend}
          </span>
          <span className="deck-rule-now">
            {points}/{DECK_RULES.maxRarityPoints} used
          </span>
        </li>
        <li className={`deck-rule${atLimit ? " full" : " ok"}`}>
          <span className="deck-rule-label">Custom decks</span>
          <span className="deck-rule-value">up to {DECK_RULES.maxDecksPerClass} + starter</span>
          <span className="deck-rule-now">
            {decks.length}/{DECK_RULES.maxDecksPerClass} used
          </span>
        </li>
      </ul>

      <div className="deck-tabs">
        <button
          type="button"
          className={`deck-chip${isOpen({ kind: "starter" }) ? " selected" : ""}`}
          onClick={() => guard(() => show(openFor(null)))}
        >
          Starter deck <span className="deck-chip-tag">basic</span>
        </button>
        {decks.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`deck-chip${isOpen({ kind: "saved", id: d.id }) ? " selected" : ""}`}
            onClick={() => guard(() => show(openFor(d.id)))}
          >
            {d.name}
          </button>
        ))}
        {draft.kind === "new" ? <span className="deck-chip selected">{name || "New deck"} (unsaved)</span> : null}
        <button
          type="button"
          className="deck-chip deck-chip-new"
          disabled={atLimit || draft.kind === "new"}
          title={atLimit ? `At most ${DECK_RULES.maxDecksPerClass} decks per class` : undefined}
          onClick={() => guard(() => startNew(starter))}
        >
          + New deck ({decks.length}/{DECK_RULES.maxDecksPerClass})
        </button>
      </div>

      <div className="deck-workspace">
        {/* Left: the selected card, large. */}
        <aside className="deck-panel deck-detail">
          {selected ? (
            <>
              <FramedCard card={selected} description={describeCard(asCard(selected), { priority: false })} />
              {selected.category === "monster" ? (
                <p className="deck-detail-text">{describeMonsterOrders(asCard(selected))}</p>
              ) : null}
              <div className="deck-stepper deck-detail-stepper">
                <button
                  type="button"
                  aria-label={`Remove a ${selected.name}`}
                  disabled={readOnly || selectedCopies === 0}
                  onClick={() => removeOne(selected.id)}
                >
                  −
                </button>
                <span>
                  {selectedCopies}/{maxCopiesOf(selected)}
                </span>
                <button
                  type="button"
                  aria-label={`Add a ${selected.name}`}
                  disabled={readOnly || !canAdd(selected)}
                  onClick={() => addOne(selected.id)}
                >
                  +
                </button>
              </div>
            </>
          ) : (
            <p className="shell-note">Pick a card to see it here.</p>
          )}
        </aside>

        {/* Middle: the deck itself, one tile per copy. */}
        <section className="deck-panel deck-main">
          <div className="deck-editor-head">
            <input
              className="deck-name"
              type="text"
              maxLength={DECK_RULES.maxNameLength}
              value={name}
              disabled={readOnly}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
            <span className={`deck-count${problem ? " bad" : ""}`}>
              {total}/{DECK_RULES.maxCards}
            </span>
          </div>
          <div className="deck-breakdown">
            {perCategory.map(({ cat, n }) => (
              <span key={cat} className={`deck-breakdown-item ${cat}`}>
                {CATEGORY_LABEL[cat]} {n}
              </span>
            ))}
          </div>
          {readOnly ? (
            <p className="shell-note deck-hint">
              Every player has this deck and it can&apos;t be edited. Use &quot;Copy to a new deck&quot; to start your own from it.
            </p>
          ) : null}

          <div className={`deck-grid${dropTarget === "deck" ? " drop" : ""}`} {...dropZone("deck")}>
            {deckTiles.map(({ card, key }) => (
              <CardTile
                key={key}
                card={card}
                selected={card.id === selectedId}
                draggable={!readOnly}
                onDragStart={dragFrom("deck", card.id)}
                onSelect={() => setSelectedId(card.id)}
                onPrimary={() => removeOne(card.id)}
                onSecondary={() => removeOne(card.id)}
              />
            ))}
            {deckTiles.length === 0 ? <p className="shell-note deck-grid-empty">Drag cards here from the right.</p> : null}
          </div>

          {problem && !readOnly ? <p className="auth-error">{problem}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}

          <div className="shell-actions">
            {readOnly ? (
              <button type="button" className="shell-button gold" disabled={atLimit} onClick={() => startNew(list)}>
                Copy to a new deck
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="shell-button gold"
                  disabled={busy || Boolean(problem) || !name.trim() || (!dirty && draft.kind === "saved")}
                  onClick={() => void save()}
                >
                  {busy ? "Saving…" : draft.kind === "new" ? "Create deck" : dirty ? "Save changes" : "Saved"}
                </button>
                <button type="button" className="shell-button danger" disabled={busy} onClick={remove}>
                  {draft.kind === "new" ? "Cancel" : "Delete deck"}
                </button>
              </>
            )}
          </div>
        </section>

        {/* Right: the class's card pool, filterable. */}
        <section className={`deck-panel deck-pool${dropTarget === "pool" ? " drop" : ""}`} {...dropZone("pool")}>
          <input
            className="deck-search"
            type="search"
            placeholder="Search cards"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="deck-filters">
            {(["all", ...CATEGORIES] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                className={`deck-filter ${f}${filter === f ? " selected" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : CATEGORY_LABEL[f]}
              </button>
            ))}
          </div>
          <div className="pool-grid">
            {shownPool.map((card) => {
              const copies = counts[card.id] ?? 0;
              return (
                <CardTile
                  key={card.id}
                  card={card}
                  badge={`${copies}/${maxCopiesOf(card)}`}
                  dim={!canAdd(card)}
                  selected={card.id === selectedId}
                  draggable={!readOnly && canAdd(card)}
                  onDragStart={dragFrom("pool", card.id)}
                  onSelect={() => setSelectedId(card.id)}
                  onPrimary={() => addOne(card.id)}
                  onSecondary={() => removeOne(card.id)}
                />
              );
            })}
            {shownPool.length === 0 ? <p className="shell-note">No cards match.</p> : null}
          </div>
          <p className="shell-note deck-controls-hint">
            {readOnly ? "Click a card to read it." : "Double-click or drag to add · right-click to remove"}
          </p>
        </section>
      </div>
    </div>
  );
}
