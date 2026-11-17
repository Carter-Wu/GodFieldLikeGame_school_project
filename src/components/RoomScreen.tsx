import type { ReactElement, ReactNode } from "react";
import type { ClassDef } from "../model/classes.ts";

export interface RoomScreenProps {
  title: string;
  playerClass: ClassDef;
  deckName: string;
  onBack: () => void;
  /** Short message shown as a toast at the bottom (null = hidden). */
  toast?: string | null;
  children: ReactNode;
}

/**
 * Shared frame for the online waiting screens (private room, random match):
 * the title-screen hall behind, a Cinzel header with a glass Back pill, and
 * one glass panel in the middle. Same tokens as My Record / Card Gallery.
 */
export function RoomScreen({ title, playerClass, deckName, onBack, toast = null, children }: RoomScreenProps): ReactElement {
  return (
    <div className="shell-screen room-screen">
      <div className="gallery-backdrop" aria-hidden="true" />
      <header className="room-header">
        <div>
          <h1 className="room-title">{title}</h1>
          <p className="room-subtitle">
            <span>
              Playing as <span className="room-accent">{playerClass.name}</span>
            </span>
            <span className="room-sep" aria-hidden="true" />
            <span>{deckName}</span>
          </p>
        </div>
        <button type="button" className="room-back" onClick={onBack}>
          Back
        </button>
      </header>
      <section className="room-panel">{children}</section>
      <div className={`room-toast${toast ? " show" : ""}`} role="status" aria-live="polite">
        {toast ? (
          <>
            <span className="room-toast-icon" aria-hidden="true">✓</span>
            {toast}
          </>
        ) : null}
      </div>
    </div>
  );
}
