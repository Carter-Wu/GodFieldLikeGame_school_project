import { useState, type ReactElement } from "react";
import { useCatalog } from "../hooks/useCatalog.ts";
import { ClassSelect } from "../components/ClassSelect.tsx";
import { Gallery } from "../components/Gallery.tsx";
import { Lobby, type LobbyReady } from "../components/Lobby.tsx";
import { Dialog, type DialogProps } from "../components/Dialog.tsx";
import { PhaserBattle } from "../components/PhaserBattle.tsx";
import { PhaserOnlineBattle } from "../components/PhaserOnlineBattle.tsx";
import type { ClassDef } from "../model/classes.ts";

type Screen =
  | { name: "menu" }
  | { name: "gallery" }
  | { name: "battle"; playerClassId: string }
  | { name: "lobby-create"; playerClass: ClassDef }
  | { name: "lobby-join"; playerClass: ClassDef; code: string }
  | { name: "online-battle"; ready: LobbyReady };

/** React shell: menus and popups. The Phaser canvas owns all battle frames. */
export function App(): ReactElement {
  const catalog = useCatalog();
  const [screen, setScreen] = useState<Screen>({ name: "menu" });
  const [dialog, setDialog] = useState<DialogProps | null>(null);

  if (!catalog.ready) {
    return (
      <div className="shell-screen">
        <p className="shell-subtitle">Loading game data…</p>
      </div>
    );
  }

  const askJoinCode = (playerClass: ClassDef): void => {
    setDialog({
      kind: "prompt",
      title: "Join a room",
      message: "Enter the room code your friend sent you.",
      input: { placeholder: "ABCDE", maxLength: 5, uppercase: true },
      confirmLabel: "Join",
      onConfirm: (code: string) => {
        setDialog(null);
        setScreen({ name: "lobby-join", playerClass, code });
      },
      onCancel: () => setDialog(null),
    });
  };

  let body: ReactElement;
  switch (screen.name) {
    case "gallery":
      body = <Gallery onBack={() => setScreen({ name: "menu" })} />;
      break;
    case "battle":
      body = <PhaserBattle playerClassId={screen.playerClassId} onExit={() => setScreen({ name: "menu" })} />;
      break;
    case "lobby-create":
      body = (
        <Lobby
          mode="create"
          playerClass={screen.playerClass}
          onReady={(ready) => setScreen({ name: "online-battle", ready })}
          onBack={() => setScreen({ name: "menu" })}
        />
      );
      break;
    case "lobby-join":
      body = (
        <Lobby
          mode="join"
          playerClass={screen.playerClass}
          code={screen.code}
          onReady={(ready) => setScreen({ name: "online-battle", ready })}
          onBack={() => setScreen({ name: "menu" })}
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
          onExit={() => setScreen({ name: "menu" })}
        />
      );
      break;
    case "menu":
    default:
      body = (
        <ClassSelect
          classes={catalog.classes}
          onPlayCpu={(classId) => setScreen({ name: "battle", playerClassId: classId })}
          onCreateOnline={(classId) => {
            const playerClass = catalog.classes.find((c) => c.id === classId);
            if (playerClass) setScreen({ name: "lobby-create", playerClass });
          }}
          onJoinOnline={(classId) => {
            const playerClass = catalog.classes.find((c) => c.id === classId);
            if (playerClass) askJoinCode(playerClass);
          }}
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
