import { useMemo, useState, type ReactElement } from "react";
import { allCards, deckEntriesForCard, getCatalog, type CatalogCardEntry } from "../model/catalog.ts";
import { CARD_CATEGORY } from "../model/cardTypes.ts";
import { describeCard } from "../model/engine.ts";
import type { Card } from "../model/cardTypes.ts";

const CATEGORY_ORDER = [CARD_CATEGORY.ATTACK, CARD_CATEGORY.DEFEND, CARD_CATEGORY.BUFF, CARD_CATEGORY.DEBUFF];
const ALL = "all";
const PAGE_SIZE = 10;

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export interface GalleryProps {
  onBack: () => void;
}

/** Card gallery (React shell): every catalog card, filterable by category, paged. */
export function Gallery({ onBack }: GalleryProps): ReactElement {
  const [filter, setFilter] = useState<string>(ALL);
  const [page, setPage] = useState(0);

  const cards = useMemo(
    () =>
      allCards().sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
          a.name.localeCompare(b.name)
      ),
    []
  );
  const source = getCatalog().source === "supabase" ? "loaded from the database" : "local copy (database not reachable)";
  const filtered = filter === ALL ? cards : cards.filter((c) => c.category === filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const pickFilter = (f: string): void => {
    setFilter(f);
    setPage(0);
  };

  return (
    <div className="shell-screen">
      <div className="shell-topbar">
        <span className="shell-title">Card Gallery</span>
        <button type="button" className="shell-button" onClick={onBack}>
          ← Back
        </button>
      </div>
      <p className="shell-subtitle">
        {cards.length} cards · {source}
      </p>
      <div className="gallery-tabs" role="tablist">
        {[ALL, ...CATEGORY_ORDER].map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={filter === c}
            className={`gallery-tab${filter === c ? " selected" : ""}`}
            onClick={() => pickFilter(c)}
          >
            {c === ALL ? "All" : capitalize(c)}
          </button>
        ))}
      </div>
      <div className="gallery-grid">
        {visible.map((card) => (
          <GalleryCard key={card.id} card={card} />
        ))}
      </div>
      <div className="gallery-pager">
        <button type="button" className="shell-button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
          ← Prev
        </button>
        <span className="shell-note">
          Page {safePage + 1} of {pageCount}
        </span>
        <button
          type="button"
          className="shell-button"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage(safePage + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function GalleryCard({ card }: { card: CatalogCardEntry }): ReactElement {
  const entries = deckEntriesForCard(card.id);
  // Describe via a battle instance shape (props spread flat like createCardInstance).
  const description = describeCard({ ...card.props, category: card.category, name: card.name } as Card);
  return (
    <div className="gallery-card">
      {card.imageUrl ? (
        <img className="gallery-art" src={card.imageUrl} alt={`${card.name} artwork`} loading="lazy" />
      ) : (
        <div className={`gallery-art fallback ${card.category}`}>{capitalize(card.category)}</div>
      )}
      <div className="gallery-name">{card.name}</div>
      <div className="gallery-desc">{description}</div>
      <div className="gallery-decks">
        {entries.length > 0
          ? entries.map((e) => `${e.classDef.name} ×${e.copies}`).join(" · ")
          : "Not in any deck"}
      </div>
    </div>
  );
}
