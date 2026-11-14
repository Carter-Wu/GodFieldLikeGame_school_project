import type { ReactElement } from "react";
import { cardCost, cardRarity, RARITY_LABEL } from "../model/cardTypes.ts";
import type { CatalogCardEntry } from "../model/catalog.ts";

export interface FramedCardProps {
  card: CatalogCardEntry;
  description: string;
}

/**
 * A catalog card in the card frame art, laid out like the battle screen's
 * cards (src/scenes/cardFace.ts): name on the top plate, AP cost in the
 * medallion, art in the window, category on the banner, effect text at the
 * bottom. Sized by its container's width; see .framed-card in style.css.
 */
export function FramedCard({ card, description }: FramedCardProps): ReactElement {
  // Strike priority, on an amber badge atop the text (attack cards above 0).
  const raw = card.category === "attack" ? Number(card.props.priority ?? 0) : 0;
  const priority = raw > 0 ? raw : null;
  const rarity = cardRarity(card.props);
  return (
    <div className={`framed-card ${card.category} rarity-${rarity}`} title={`${RARITY_LABEL[rarity]} card`}>
      {card.imageUrl ? (
        <img className="framed-card-art" src={card.imageUrl} alt={`${card.name} artwork`} loading="lazy" draggable={false} />
      ) : (
        <div className="framed-card-art fallback" />
      )}
      {rarity !== "normal" && <span className="framed-card-rarity-frame" />}
      <div className="framed-card-name">{card.name}</div>
      {rarity !== "normal" && <span className="framed-card-gem" aria-label={RARITY_LABEL[rarity]} />}
      <div className="framed-card-cost">{cardCost(card.props)}</div>
      <div className="framed-card-category">{card.category}</div>
      <div className={`framed-card-text${priority !== null ? " has-priority" : ""}`}>
        {priority !== null && <span className="framed-card-priority">PRIORITY {priority}</span>}
        <span>{description}</span>
      </div>
    </div>
  );
}
