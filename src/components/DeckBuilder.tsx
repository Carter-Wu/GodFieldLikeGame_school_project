import { useMemo, useState, type ReactElement } from "react";
import type { ClassDef } from "../model/classes.ts";
import { cardCost, type Card } from "../model/cardTypes.ts";
import { describeCard, describeMonsterOrders } from "../model/engine.ts";
import {
  DECK_RULES,
  classCardPool,
  deckSize,
  starterDeckList,
  validateDeckList,
  type DeckListEntry,
} from "../model/decks.ts";
import { createDeck, deleteDeck, updateDeck, type SavedDeck } from "../online/decksApi.ts";

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

const toCounts = (list: DeckListEntry[]): Record<string, number> =>
  Object.fromEntries(list.map((e) => [e.cardId, e.copies]));

/** Deck builder (React shell): the starter deck plus up to 3 custom decks for one class. */
export function DeckBuilder({ classDef, decks, initialDeckId, onDecksChanged, confirm, onBack }: DeckBuilderProps): ReactElement {
  const pool = useMemo(() => classCardPool(classDef), [classDef]);
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

  const readOnly = draft.kind === "starter";
  const list: DeckListEntry[] = pool.filter((c) => (counts[c.id] ?? 0) > 0).map((c) => ({ cardId: c.id, copies: counts[c.id]! }));
  const total = deckSize(list);
  const problem = validateDeckList(classDef, list);
  const atLimit = decks.length >= DECK_RULES.maxDecksPerClass;

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

  const setCopies = (cardId: string, copies: number): void => {
    setCounts((c) => ({ ...c, [cardId]: Math.max(0, Math.min(DECK_RULES.maxCopies, copies)) }));
    setDirty(true);
  };

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
    <div className="shell-screen">
      <div className="shell-topbar">
        <span className="shell-title">{classDef.name} decks</span>
        <button type="button" className="shell-button" onClick={() => guard(onBack)}>
          ← Back
        </button>
      </div>
      <p className="shell-subtitle">
        Starter deck + up to {DECK_RULES.maxDecksPerClass} of your own. {DECK_RULES.minCards}–{DECK_RULES.maxCards} cards,
        at most {DECK_RULES.maxCopies} copies of each {classDef.name} card.
      </p>

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

      <div className="deck-editor">
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
            {total} cards
          </span>
        </div>
        {readOnly ? (
          <p className="shell-note deck-hint">
            Every player has this deck and it can&apos;t be edited. Use &quot;Copy to a new deck&quot; to start your own from it.
          </p>
        ) : null}

        <div className="deck-rows">
          {pool.map((card) => {
            const copies = counts[card.id] ?? 0;
            const description = describeCard({ ...card.props, category: card.category, name: card.name } as Card);
            return (
              <div key={card.id} className={`deck-row${copies === 0 ? " empty" : ""}`}>
                {card.imageUrl ? (
                  <img className="deck-art" src={card.imageUrl} alt="" loading="lazy" />
                ) : (
                  <div className={`deck-art gallery-art fallback ${card.category}`} />
                )}
                <div className="deck-row-text">
                  <div className="gallery-name">{card.name}</div>
                  <div className="gallery-desc">
                    {cardCost(card.props)} AP · {description}
                  </div>
                  {card.category === "monster" ? (
                    <div className="gallery-desc">{describeMonsterOrders({ ...card.props, category: card.category } as Card)}</div>
                  ) : null}
                </div>
                <div className="deck-stepper">
                  <button
                    type="button"
                    aria-label={`Remove a ${card.name}`}
                    disabled={readOnly || copies === 0}
                    onClick={() => setCopies(card.id, copies - 1)}
                  >
                    −
                  </button>
                  <span>{copies}</span>
                  <button
                    type="button"
                    aria-label={`Add a ${card.name}`}
                    disabled={readOnly || copies >= DECK_RULES.maxCopies}
                    onClick={() => setCopies(card.id, copies + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
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
      </div>
    </div>
  );
}
