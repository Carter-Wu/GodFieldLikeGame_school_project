import { useState, type ReactElement } from "react";
import type { ClassDef } from "../model/classes.ts";
import { DECK_RULES, deckSize, starterDeckList } from "../model/decks.ts";
import { onlineAvailable } from "../online/supabaseClient.ts";
import type { Account } from "../online/authApi.ts";
import type { SavedDeck } from "../online/decksApi.ts";

export interface ClassSelectProps {
  classes: ClassDef[];
  initialClassId: string | null;
  account: Account | null; // null when online features are off (no Supabase config)
  decks: SavedDeck[]; // all of the player's saved decks
  decksError: string | null;
  selectedDeckIds: Record<string, string | null>; // per class; null/absent = starter deck
  onSelectDeck: (classId: string, deckId: string | null) => void;
  onEditDecks: (classId: string) => void;
  onLogout: () => void;
  onPlayCpu: (classId: string) => void;
  onCreateOnline: (classId: string) => void;
  onJoinOnline: (classId: string) => void;
  onOpenGallery: () => void;
}

/** Class-select screen (React shell): one card per class, its decks, and vs-CPU / online buttons. */
export function ClassSelect({
  classes,
  initialClassId,
  account,
  decks,
  decksError,
  selectedDeckIds,
  onSelectDeck,
  onEditDecks,
  onLogout,
  onPlayCpu,
  onCreateOnline,
  onJoinOnline,
  onOpenGallery,
}: ClassSelectProps): ReactElement {
  const [selectedId, setSelectedId] = useState<string>(initialClassId ?? classes[0]?.id ?? "");
  const selected = classes.find((c) => c.id === selectedId) ?? classes[0];
  const classDecks = selected ? decks.filter((d) => d.classId === selected.id) : [];
  const chosenDeckId = selected ? (selectedDeckIds[selected.id] ?? null) : null;

  return (
    <div className="shell-screen">
      <div className="shell-topbar">
        <span className="shell-title">Godfield-lite</span>
        <div className="shell-topbar-right">
          {account ? (
            <>
              <span className="account-name" title={account.email}>
                {account.username}
              </span>
              <button type="button" className="shell-button" onClick={onLogout}>
                Log out
              </button>
            </>
          ) : null}
          <button type="button" className="shell-button" onClick={onOpenGallery}>
            Card gallery
          </button>
        </div>
      </div>
      <p className="shell-subtitle">
        Class-based card battle: attack / defend / buff / debuff / monster cards, synergies, and an ultimate meter.
        Every round both sides pick a card at the same time and pay its AP cost, then both resolve together
        -- the higher priority strikes first, ties go to the dice.
      </p>
      <h2 className="shell-heading">Choose your class</h2>
      <div className="class-grid">
        {classes.map((classDef) => (
          <button
            key={classDef.id}
            type="button"
            className={`class-card${classDef.id === selectedId ? " selected" : ""}`}
            onClick={() => setSelectedId(classDef.id)}
          >
            <div className="class-name">{classDef.name}</div>
            <div className="class-stats">
              HP {classDef.baseStats.hp} DEF {classDef.baseStats.def} MR {classDef.baseStats.mr} ER{" "}
              {classDef.baseStats.er} UR {classDef.baseStats.ur}
            </div>
            <div className="class-synergy">Synergy: {classDef.synergyPool.map((s) => s.name).join(", ")}</div>
            <div className="class-ultimate">
              Ultimate: {classDef.ultimate.name} (cost {classDef.ultimate.cost}, {classDef.ultimate.damage}{" "}
              dmg)
            </div>
          </button>
        ))}
      </div>
      {selected ? (
        <>
          <h2 className="shell-heading">Choose your deck</h2>
          <div className="deck-tabs">
            <button
              type="button"
              className={`deck-chip${chosenDeckId === null ? " selected" : ""}`}
              onClick={() => onSelectDeck(selected.id, null)}
            >
              Starter deck <span className="deck-chip-tag">{deckSize(starterDeckList(selected))} cards</span>
            </button>
            {classDecks.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`deck-chip${chosenDeckId === d.id ? " selected" : ""}`}
                onClick={() => onSelectDeck(selected.id, d.id)}
              >
                {d.name} <span className="deck-chip-tag">{deckSize(d.cards)} cards</span>
              </button>
            ))}
            {account ? (
              <button type="button" className="deck-chip deck-chip-new" onClick={() => onEditDecks(selected.id)}>
                Edit decks ({classDecks.length}/{DECK_RULES.maxDecksPerClass})
              </button>
            ) : null}
          </div>
          {decksError ? <p className="shell-note">Couldn&apos;t load your decks: {decksError}</p> : null}
          <div className="shell-actions">
            <button type="button" className="shell-button primary" onClick={() => onPlayCpu(selected.id)}>
              Play vs CPU
            </button>
            <button
              type="button"
              className="shell-button gold"
              disabled={!onlineAvailable}
              onClick={() => onCreateOnline(selected.id)}
            >
              Create online room
            </button>
            <button
              type="button"
              className="shell-button gold"
              disabled={!onlineAvailable}
              onClick={() => onJoinOnline(selected.id)}
            >
              Join with code
            </button>
          </div>
        </>
      ) : null}
      {!onlineAvailable ? (
        <p className="shell-note">
          Online play, accounts and custom decks are off: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
          aren&apos;t set (see .env).
        </p>
      ) : null}
    </div>
  );
}
