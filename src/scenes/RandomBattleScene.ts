// Random-match battle screen. Draws exactly like the vs-CPU BattleScene; the
// battle comes from the Colyseus server (src/online/randomMatch.ts), which
// resolves the round once both players have picked.

import { BattleScene, type BattleSceneData } from "./BattleScene.ts";
import { isBattleOver, type Action } from "../model/engine.ts";
import { deserializeFighter } from "../model/serialize.ts";
import type { BattleView } from "../online/matchApi.ts";
import type { RandomMatch, RandomMatchView } from "../online/randomMatch.ts";
import { confirmDialog } from "../ui/dialog.ts";

export interface RandomBattleData {
  match: RandomMatch;
  onExit?: (() => void) | null;
}

function toBattleView(view: RandomMatchView): BattleView {
  const me = deserializeFighter(view.me);
  const opponent = deserializeFighter(view.opponent, []);
  return {
    player: me,
    cpu: opponent,
    round: view.round,
    log: view.log,
    winner: view.result === "win" ? me : view.result === "lose" ? opponent : null,
    draw: view.result === "draw",
    status: view.over ? "finished" : "active",
    myReady: view.myReady,
    opponentReady: view.opponentReady,
  };
}

export class RandomBattleScene extends BattleScene {
  declare battle: BattleView;
  match!: RandomMatch;
  pendingPick: string | null = null;
  errorMessage: string | null = null;
  opponentGone = false;

  constructor() {
    super("RandomBattleScene");
  }

  override setupBattle(data: BattleSceneData | RandomBattleData): BattleView {
    const { match } = data as RandomBattleData;
    this.match = match;
    this.pendingPick = null;
    this.errorMessage = null;
    this.opponentGone = false;

    const unsubscribe = [
      match.onView((view) => this.applyView(view)),
      match.onError((message) => {
        this.errorMessage = message;
        this.pendingPick = null;
        this.pendingPlay = null;
        this.render();
      }),
      match.onClose(() => {
        // The server closes the room when the match ends; before that it means
        // we lost the connection for good.
        if (!isBattleOver(this.battle)) {
          this.errorMessage = "Lost connection to the match.";
          this.render();
        }
      }),
    ];
    this.events.once("shutdown", () => unsubscribe.forEach((off) => off()));
    return toBattleView(match.latest!);
  }

  override get playerLabel(): string {
    return "You";
  }

  override get opponentLabel(): string {
    return "Opponent";
  }

  override get leaveLabel(): string {
    return "Leave";
  }

  override resultSubtitle(): string {
    const b = this.battle;
    if (b.winner === b.player && b.log[0]?.includes("left the match")) return "Your opponent left the match.";
    return super.resultSubtitle();
  }

  override canAct(): boolean {
    return super.canAct() && !this.battle.myReady && !this.pendingPick && !this.match.closed;
  }

  override commitAction(action: Action): void {
    this.previewedCardId = null;
    this.previewedView = null;
    this.dismissTween?.stop();
    this.dismissTween = null;
    this.errorMessage = null;
    this.pendingPick = action.kind === "card" ? action.card.name : "your ultimate";
    this.match.pick(action);
    this.render();
  }

  override async onLeave(): Promise<void> {
    this.flightSeq++;
    this.finishFlight();
    if (!isBattleOver(this.battle) && !this.match.closed) {
      const leave = await confirmDialog({
        title: "Leave this match?",
        message: "It counts as a loss.",
        confirmLabel: "Leave",
        danger: true,
      });
      if (!leave || !this.sys.isActive()) return;
    }
    this.match.leave();
    if (this.onExit) {
      this.onExit();
      return;
    }
    this.scene.start("ClassSelectScene");
  }

  override statusMessage(): string {
    const b = this.battle;
    if (b.draw) return `Draw! Press "Leave" to go back.`;
    if (b.winner) return `${b.winner === b.player ? "You win!" : "Your opponent wins."} Press "Leave" to go back.`;
    if (this.errorMessage) return `Round ${b.round} — ${this.errorMessage}`;
    if (this.pendingPick || b.myReady) {
      const what = this.pendingPick ?? "your move";
      return `Round ${b.round} — you locked in ${what}. ${b.opponentReady ? "Resolving…" : "Waiting for your opponent…"}`;
    }
    return `Round ${b.round} — pick a card. ${
      b.opponentReady ? "Your opponent has already chosen." : "Your opponent is choosing at the same time."
    }`;
  }

  private applyView(view: RandomMatchView): void {
    if (!this.scene.isActive()) return;
    const previous = this.battle;
    const before = this.currentHp();
    this.battle = toBattleView(view);
    if (!this.battle.myReady) this.pendingPick = null;

    // Replay the round if this update is the one that resolved it.
    const resolvedRound = this.battle.player.lastAction?.round;
    const justResolved =
      resolvedRound === previous.round &&
      (this.battle.round > previous.round || (isBattleOver(this.battle) && !isBattleOver(previous)));
    if (justResolved) this.presentRound(before);
    else this.render();
  }
}
