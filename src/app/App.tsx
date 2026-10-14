import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useCatalog } from "../hooks/useCatalog.ts";
import { useAuth } from "../hooks/useAuth.ts";
import { AuthScreen } from "../components/AuthScreen.tsx";
import { ClassSelect } from "../components/ClassSelect.tsx";
import { DeckBuilder } from "../components/DeckBuilder.tsx";
import { Gallery } from "../components/Gallery.tsx";
import { Lobby, type LobbyReady } from "../components/Lobby.tsx";
import { Dialog, type DialogProps } from "../components/Dialog.tsx";
import { PhaserBattle } from "../components/PhaserBattle.tsx";
import { PhaserOnlineBattle } from "../components/PhaserOnlineBattle.tsx";
import { findClassById } from "../model/catalog.ts";
import { validateDeckList, type DeckListEntry } from "../model/decks.ts";
import type { ClassDef } from "../model/classes.ts";
import { onlineAvailable } from "../online/supabaseClient.ts";
import { logOut } from "../online/authApi.ts";
import { listDecks, type SavedDeck } from "../online/decksApi.ts";

// The deck a player takes into a match: a saved deck, or the starter deck
// (id null, list null).
interface DeckChoice {
  id: string | null;
  name: string;
  list: DeckListEntry[] | null;
}

type Screen =
  | { name: "menu" }
  | { name: "gallery" }
  | { name: "decks"; classId: string }
  | { name: "battle"; playerClassId: string; deck: DeckChoice }
  | { name: "lobby-create"; playerClass: ClassDef; deck: DeckChoice }
  | { name: "lobby-join"; playerClass: ClassDef; deck: DeckChoice; code: string }
  | { name: "online-battle"; ready: LobbyReady };

/** React shell: menus and popups. The Phaser canvas owns all battle frames. */
export function App(): ReactElement {
  const catalog = useCatalog();
  const auth = useAuth();
  const [screen, setScreen] = useState<Screen>({ name: "menu" });
  const [dialog, setDialog] = useState<DialogProps | null>(null);
  const [lastClassId, setLastClassId] = useState<string | null>(null);
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [decksError, setDecksError] = useState<string | null>(null);
  const [selectedDeckIds, setSelectedDeckIds] = useState<Record<string, string | null>>({});

  const accountId = auth.account?.id ?? null;

  const reloadDecks = useCallback(async (): Promise<void> => {
    if (!accountId) return;
    try {
      setDecks(await listDecks());
      setDecksError(null);
    } catch (err) {
      setDecksError((err as Error).message);
    }
  }, [accountId]);

  // A different (or no) account: drop the old one's decks and go back to the menu.
  useEffect(() => {
    setDecks([]);
    setDecksError(null);
    setSelectedDeckIds({});
    setScreen({ name: "menu" });
    void reloadDecks();
  }, [accountId, reloadDecks]);

  if (!catalog.ready || !auth.ready) {
    return (
      <div className="shell-screen">
        <p className="shell-subtitle">Loading game data…</p>
      </div>
    );
  }

  if (onlineAvailable && !auth.account) return <AuthScreen />;

  const showError = (title: string, message: string): void => {
    setDialog({ kind: "confirm", title, message, confirmLabel: "OK", onConfirm: () => setDialog(null), onCancel: () => setDialog(null) });
  };

  const askConfirm = (title: string, message: string, confirmLabel: string, onYes: () => void): void => {
    setDialog({
      kind: "confirm",
      title,
      message,
      confirmLabel,
      danger: true,
      onConfirm: () => {
        setDialog(null);
        onYes();
      },
      onCancel: () => setDialog(null),
    });
  };

  // The deck picked for a class, checked against the deck rules (the catalog
  // may have changed since it was saved). null = not playable, error shown.
  const deckFor = (classDef: ClassDef): DeckChoice | null => {
    const id = selectedDeckIds[classDef.id] ?? null;
    const saved = id ? decks.find((d) => d.id === id) : undefined;
    if (!saved) return { id: null, name: "Starter deck", list: null };
    const problem = validateDeckList(classDef, saved.cards);
    if (problem) {
      showError("Deck can't be used", `"${saved.name}": ${problem} Edit it in the deck builder or pick another deck.`);
      return null;
    }
    return { id: saved.id, name: saved.name, list: saved.cards };
  };

  const startWith = (classId: string, go: (playerClass: ClassDef, deck: DeckChoice) => void): void => {
    setLastClassId(classId);
    const playerClass = findClassById(classId);
    const deck = deckFor(playerClass);
    if (deck) go(playerClass, deck);
  };

  const askJoinCode = (playerClass: ClassDef, deck: DeckChoice): void => {
    setDialog({
      kind: "prompt",
      title: "Join a room",
      message: "Enter the room code your friend sent you.",
      input: { placeholder: "ABCDE", maxLength: 5, uppercase: true },
      confirmLabel: "Join",
      onConfirm: (code: string) => {
        setDialog(null);
        setScreen({ name: "lobby-join", playerClass, deck, code });
      },
      onCancel: () => setDialog(null),
    });
  };

  const toMenu = (): void => setScreen({ name: "menu" });

  let body: ReactElement;
  switch (screen.name) {
    case "gallery":
      body = <Gallery onBack={toMenu} />;
      break;
    case "decks": {
      const classDef = findClassById(screen.classId);
      body = (
        <DeckBuilder
          classDef={classDef}
          decks={decks.filter((d) => d.classId === classDef.id)}
          initialDeckId={selectedDeckIds[classDef.id] ?? null}
          onDecksChanged={(deckId) => {
            setSelectedDeckIds((s) => ({ ...s, [classDef.id]: deckId }));
            void reloadDecks();
          }}
          confirm={askConfirm}
          onBack={toMenu}
        />
      );
      break;
    }
    case "battle":
      body = <PhaserBattle playerClassId={screen.playerClassId} playerDeckList={screen.deck.list} onExit={toMenu} />;
      break;
    case "lobby-create":
      body = (
        <Lobby
          mode="create"
          playerClass={screen.playerClass}
          deckId={screen.deck.id}
          deckName={screen.deck.name}
          onReady={(ready) => setScreen({ name: "online-battle", ready })}
          onBack={toMenu}
        />
      );
      break;
    case "lobby-join":
      body = (
        <Lobby
          mode="join"
          playerClass={screen.playerClass}
          deckId={screen.deck.id}
          deckName={screen.deck.name}
          code={screen.code}
          onReady={(ready) => setScreen({ name: "online-battle", ready })}
          onBack={toMenu}
        />
      );
      break;
    case "online-battle":
      body = (
        <PhaserOnlineBattle
          matchId={screen.ready.matchId}
          userId={screen.ready.userId}
          match={screen.ready.match}
          hand={screen.ready.hand}
          onExit={toMenu}
        />
      );
      break;
    case "menu":
    default:
      body = (
        <ClassSelect
          classes={catalog.classes}
          initialClassId={lastClassId}
          account={auth.account}
          decks={decks}
          decksError={decksError}
          selectedDeckIds={selectedDeckIds}
          onSelectDeck={(classId, deckId) => setSelectedDeckIds((s) => ({ ...s, [classId]: deckId }))}
          onEditDecks={(classId) => {
            setLastClassId(classId);
            setScreen({ name: "decks", classId });
          }}
          onLogout={() => {
            logOut().catch((err: Error) => showError("Couldn't log out", err.message));
          }}
          onPlayCpu={(classId) =>
            startWith(classId, (playerClass, deck) => setScreen({ name: "battle", playerClassId: playerClass.id, deck }))
          }
          onCreateOnline={(classId) =>
            startWith(classId, (playerClass, deck) => setScreen({ name: "lobby-create", playerClass, deck }))
          }
          onJoinOnline={(classId) => startWith(classId, askJoinCode)}
          onOpenGallery={() => setScreen({ name: "gallery" })}
        />
      );
      break;
  }

  return (
    <>
      {body}
      {dialog ? <Dialog {...dialog} /> : null}
    </>
  );
}
