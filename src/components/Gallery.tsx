import { useMemo, useState, type ReactElement } from "react";
import { allCards, deckEntriesForCard, getCatalog, type CatalogCardEntry } from "../model/catalog.ts";
import { CARD_CATEGORY } from "../model/cardTypes.ts";
import { describeCard, describeMonsterOrders } from "../model/engine.ts";
import type { Card } from "../model/cardTypes.ts";
import { FramedCard } from "./FramedCard.tsx";

const CATEGORY_ORDER = [CARD_CATEGORY.ATTACK, CARD_CATEGORY.DEFEND, CARD_CATEGORY.BUFF, CARD_CATEGORY.DEBUFF, CARD_CATEGORY.MONSTER];
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

  const countFor = (f: string): number => (f === ALL ? cards.length : cards.filter((c) => c.category === f).length);

  return (
    <div className="shell-screen gallery-screen">
      <div className="gallery-backdrop" aria-hidden="true" />
      <header className="gallery-header">
        <div className="gallery-heading">
          <h1 className="gallery-title">Card Gallery</h1>
          <p className="gallery-subtitle">
            <span className="gallery-count">{cards.length} cards</span>
            <span className="gallery-sep" aria-hidden="true" />
            <span>{source}</span>
          </p>
        </div>
        <button type="button" className="gallery-pill gallery-back" onClick={onBack}>
          ← Back
        </button>
      </header>
      <div className="gallery-filters" role="tablist" aria-label="Card category">
        {[ALL, ...CATEGORY_ORDER].map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={filter === c}
            className={`gallery-pill gallery-filter ${c}${filter === c ? " active" : ""}`}
            onClick={() => pickFilter(c)}
          >
            {c === ALL ? "All" : capitalize(c)}
            <span className="gallery-filter-count">{countFor(c)}</span>
          </button>
        ))}
      </div>
      <div className="gallery-grid" key={`${filter}-${safePage}`}>
        {visible.map((card) => (
          <GalleryCard key={card.id} card={card} />
        ))}
      </div>
      <nav className="gallery-pager" aria-label="Pages">
        <button type="button" className="gallery-pill" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
          ← Prev
        </button>
        <div className="gallery-pages">
          <span className="gallery-page-label">
            <strong>{safePage + 1}</strong> / {pageCount}
          </span>
          <span className="gallery-dots">
            {Array.from({ length: pageCount }, (_, i) => (
              <button
                key={i}
                type="button"
                className={`gallery-dot${i === safePage ? " active" : ""}`}
                aria-label={`Page ${i + 1}`}
                aria-current={i === safePage ? "page" : undefined}
                onClick={() => setPage(i)}
              />
            ))}
          </span>
        </div>
        <button
          type="button"
          className="gallery-pill"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage(safePage + 1)}
        >
          Next →
        </button>
      </nav>
    </div>
  );
}

function GalleryCard({ card }: { card: CatalogCardEntry }): ReactElement {
  const entries = deckEntriesForCard(card.id);
  // Describe via a battle instance shape (props spread flat like createCardInstance).
  const description = describeCard({ ...card.props, category: card.category, name: card.name } as Card, { priority: false });
  const orders = describeMonsterOrders({ ...card.props, category: card.category } as Card);
  return (
    <div className={`gallery-card ${card.category}`}>
      <FramedCard card={card} description={description} />
      {orders ? <div className="gallery-desc">{orders}</div> : null}
      <div className={`gallery-decks${entries.length === 0 ? " none" : ""}`}>
        {entries.length > 0
          ? entries.map((e) => (
              <span key={e.classDef.id} className="gallery-deck">
                {e.classDef.name}
                <span className="gallery-deck-copies">{e.copies > 0 ? `×${e.copies}` : "custom"}</span>
              </span>
            ))
          : "Not in any deck"}
      </div>
    </div>
  );
}
