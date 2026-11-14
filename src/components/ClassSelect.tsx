import { useState, type CSSProperties, type ReactElement } from "react";
import type { ClassDef } from "../model/classes.ts";
import type { StatKey } from "../model/stats.ts";
import { DECK_RULES, deckSize, starterDeckList } from "../model/decks.ts";
import { cardIconMarkup, classIconMarkup, ultimateIconMarkup } from "../icons.ts";
import { STAT_STYLE } from "../statIcons.ts";
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
  onRandomOnline: (classId: string) => void;
  onOpenGallery: () => void;
  onOpenRecord: () => void;
  onOpenTutorial: () => void;
}

// The five stats shown in the inspector, in display order, each with its own
// icon and colour (shared with the battle HUD, src/statIcons.ts) so the shape
// of a class reads at a glance.
const STAT_ROWS: { key: StatKey; label: string; name: string; color: string; icon: string }[] = (
  ["hp", "def", "mr", "er", "ur"] as const
).map((key) => ({ key, ...STAT_STYLE[key] }));

// Accent colour per class; unknown classes fall back to gold.
const CLASS_ACCENT: Record<string, string> = {
  guardian: "#8fb3e0",
  pyromancer: "#ff9a3c",
  black_mage: "#b892ff",
  craftsman: "#d79a5b",
  necromancer: "#4fd1a0",
};
const accentOf = (classDef: ClassDef): string => CLASS_ACCENT[classDef.id] ?? "#d9be84";

// Letter grade from a stat's share of the best value any class has.
function grade(ratio: number): string {
  if (ratio >= 0.9) return "S";
  if (ratio >= 0.7) return "A";
  if (ratio >= 0.5) return "B";
  if (ratio >= 0.3) return "C";
  return "D";
}

const svg = (body: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

function Icon({ markup, className }: { markup: string; className: string }): ReactElement {
  // Hand-authored SVG (this file / src/icons.ts), not user input.
  return <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}

function Medallion({ classDef, size }: { classDef: ClassDef; size: "sm" | "lg" }): ReactElement {
  return <Icon className={`lobby-medallion ${size}`} markup={classIconMarkup(classDef)} />;
}

/**
 * Lobby / class-select screen (React shell): a class list on the left, an
 * inspector for the selected class on the right (stats as gauges, synergy and
 * ultimate in their own boxes), then deck choice and the play buttons, with
 * Random match as the main action.
 */
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
  onRandomOnline,
  onOpenGallery,
  onOpenRecord,
  onOpenTutorial,
}: ClassSelectProps): ReactElement {
  const [selectedId, setSelectedId] = useState<string>(initialClassId ?? classes[0]?.id ?? "");
  const selected = classes.find((c) => c.id === selectedId) ?? classes[0];
  const classDecks = selected ? decks.filter((d) => d.classId === selected.id) : [];
  const chosenDeckId = selected ? (selectedDeckIds[selected.id] ?? null) : null;

  // Gauges are relative to the best value any class has, so the bars show
  // how classes compare rather than an arbitrary scale.
  const statMax = Object.fromEntries(
    STAT_ROWS.map(({ key }) => [key, Math.max(1, ...classes.map((c) => c.baseStats[key]))]),
  ) as Record<StatKey, number>;
  const ratio = (classDef: ClassDef, key: StatKey): number => classDef.baseStats[key] / statMax[key];
  // The two stats this class is relatively best at, shown as its "strengths".
  const strengths = selected
    ? [...STAT_ROWS].sort((a, b) => ratio(selected, b.key) - ratio(selected, a.key)).slice(0, 2)
    : [];

  return (
    <div className="lobby">
      <header className="lobby-topbar">
        <div className="lobby-brand">
          <img src="/ui/zenkake-emblem.svg" alt="" className="lobby-brand-mark" />
          <span className="lobby-brand-name">Zenkake</span>
        </div>
        <nav className="lobby-nav">
          {account ? (
            <button type="button" className="lobby-nav-btn" onClick={onOpenRecord}>
              My record
            </button>
          ) : null}
          <button type="button" className="lobby-nav-btn" onClick={onOpenGallery}>
            Card gallery
          </button>
          <button type="button" className="lobby-nav-btn accent" onClick={onOpenTutorial}>
            Tutorial
          </button>
          {account ? (
            <div className="lobby-account">
              <span className="lobby-account-name" title={account.email}>
                {account.username}
              </span>
              <button type="button" className="lobby-logout" onClick={onLogout}>
                Log out
              </button>
            </div>
          ) : null}
        </nav>
      </header>

      <div className="lobby-heading">
        <span className="lobby-rule" aria-hidden="true" />
        <h1>Choose your class</h1>
        <span className="lobby-rule" aria-hidden="true" />
      </div>

      <div className="lobby-main">
        <div className="lobby-rail" role="tablist" aria-label="Classes">
          {classes.map((classDef) => {
            const active = classDef.id === selected?.id;
            return (
              <button
                key={classDef.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`lobby-class${active ? " selected" : ""}`}
                style={{ "--cls": accentOf(classDef) } as CSSProperties}
                onClick={() => setSelectedId(classDef.id)}
              >
                <Medallion classDef={classDef} size="sm" />
                <span className="lobby-class-text">
                  <span className="lobby-class-name">{classDef.name}</span>
                  <span className="lobby-class-sub">{classDef.synergyPool.map((s) => s.name).join(" · ")}</span>
                </span>
              </button>
            );
          })}
        </div>

        {selected ? (
          <section
            className="lobby-inspector"
            key={selected.id}
            aria-live="polite"
            style={{ "--cls": accentOf(selected) } as CSSProperties}
          >
            <div className="lobby-hero">
              <Medallion classDef={selected} size="lg" />
              <div className="lobby-hero-text">
                <div className="lobby-eyebrow">Class</div>
                <h2 className="lobby-class-title">{selected.name}</h2>
                <div className="lobby-strengths">
                  <span className="lobby-strengths-label">Strengths</span>
                  {strengths.map((st) => (
                    <span className="lobby-strength" key={st.key} style={{ color: st.color }}>
                      <Icon className="lobby-strength-icon" markup={svg(st.icon)} />
                      {st.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="lobby-stats">
              {STAT_ROWS.map(({ key, label, name, color, icon }) => {
                const value = selected.baseStats[key];
                const r = ratio(selected, key);
                return (
                  <div className="lobby-stat" key={key} title={name} style={{ "--stat": color } as CSSProperties}>
                    <div className="lobby-stat-head">
                      <Icon className="lobby-stat-icon" markup={svg(icon)} />
                      <span className="lobby-stat-label">{label}</span>
                      <span className={`lobby-grade g-${grade(r)}`}>{grade(r)}</span>
                    </div>
                    <div className="lobby-stat-value">{value}</div>
                    <div className="lobby-stat-bar">
                      <span className="lobby-stat-fill" style={{ width: `${Math.round(r * 100)}%` }} />
                    </div>
                    <div className="lobby-stat-name">{name}</div>
                  </div>
                );
              })}
            </div>

            <div className="lobby-abilities">
              {selected.synergyPool.map((syn) => (
                <div className="lobby-slot" key={syn.id}>
                  <Icon className="lobby-slot-icon" markup={cardIconMarkup({ category: syn.countsCategory })} />
                  <div className="lobby-slot-body">
                    <div className="lobby-slot-head">
                      <span className="lobby-eyebrow">Synergy</span>
                      {syn.tiers.length ? (
                        <span className="lobby-tags" title="Cards needed for each tier">
                          {syn.tiers.map((t, i) => (
                            <span key={t.count}>
                              T{i + 1} · {t.count}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </div>
                    <div className="lobby-slot-title">{syn.name}</div>
                    <p>{syn.description}</p>
                  </div>
                </div>
              ))}
              <div className="lobby-slot ultimate">
                <Icon className="lobby-slot-icon" markup={ultimateIconMarkup()} />
                <div className="lobby-slot-body">
                  <div className="lobby-slot-head">
                    <span className="lobby-eyebrow">Ultimate</span>
                    <span className="lobby-tags">
                      <span>Cost {selected.ultimate.cost}</span>
                      {selected.ultimate.damage ? <span>{selected.ultimate.damage} dmg</span> : null}
                    </span>
                  </div>
                  <div className="lobby-slot-title">{selected.ultimate.name}</div>
                  <p>{selected.ultimate.description}</p>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {selected ? (
        <footer className="lobby-dock">
          <div className="lobby-decks">
            <span className="lobby-eyebrow">Deck</span>
            <div className="lobby-deck-list">
              <button
                type="button"
                className={`lobby-deck${chosenDeckId === null ? " selected" : ""}`}
                onClick={() => onSelectDeck(selected.id, null)}
              >
                Starter deck <span className="lobby-deck-count">{deckSize(starterDeckList(selected))}</span>
              </button>
              {classDecks.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`lobby-deck${chosenDeckId === d.id ? " selected" : ""}`}
                  onClick={() => onSelectDeck(selected.id, d.id)}
                >
                  {d.name} <span className="lobby-deck-count">{deckSize(d.cards)}</span>
                </button>
              ))}
              {account ? (
                <button type="button" className="lobby-deck edit" onClick={() => onEditDecks(selected.id)}>
                  Edit decks {classDecks.length}/{DECK_RULES.maxDecksPerClass}
                </button>
              ) : null}
            </div>
            {decksError ? <p className="shell-note">Couldn&apos;t load your decks: {decksError}</p> : null}
          </div>

          <div className="lobby-play">
            <div className="lobby-play-secondary">
              <button type="button" className="lobby-btn" onClick={() => onPlayCpu(selected.id)}>
                Play vs CPU
              </button>
              <button
                type="button"
                className="lobby-btn"
                disabled={!onlineAvailable}
                onClick={() => onCreateOnline(selected.id)}
              >
                Create room
              </button>
              <button
                type="button"
                className="lobby-btn"
                disabled={!onlineAvailable}
                onClick={() => onJoinOnline(selected.id)}
              >
                Join with code
              </button>
            </div>
            <button
              type="button"
              className="lobby-btn primary"
              disabled={!onlineAvailable}
              onClick={() => onRandomOnline(selected.id)}
            >
              Random match
            </button>
          </div>
        </footer>
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
