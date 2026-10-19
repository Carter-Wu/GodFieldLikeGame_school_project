// Random-match battle screen. Draws exactly like the vs-CPU BattleScene; the
// battle comes from the Colyseus server (src/online/randomMatch.ts), which
// resolves the round once both players have picked.

import { BattleScene, type BattleSceneData } from "./BattleScene.ts";
import { isBattleOver, passAction, type Action } from "../model/engine.ts";
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
  autoEnded = false; // already sent this round's turn when the timer ran out
  // What was planned when we locked in, to hand back if the server rejects it.
  planned: Pick<RandomBattleScene, "staged" | "stagedUltimate" | "stagedTargets" | "orders"> | null = null;

  constructor() {
    super("RandomBattleScene");
  }

  override setupBattle(data: BattleSceneData | RandomBattleData): BattleView {
    const { match } = data as RandomBattleData;
    this.match = match;
    this.pendingPick = null;
    this.errorMessage = null;
    this.opponentGone = false;
    this.autoEnded = false;

    const unsubscribe = [
      match.onView((view) => this.applyView(view)),
      match.onError((message) => {
        this.errorMessage = message;
        this.pendingPick = null;
        // The round never resolved: give the picked cards back to plan with.
        this.pendingTurn = null;
        if (this.planned) Object.assign(this, this.planned);
        this.planned = null;
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
      match.onConnectionChange(() => this.render()),
    ];
    // Countdown tick. A plain interval, not this.time: the recap speed
    // setting scales Phaser's clock.
    const tick = window.setInterval(() => this.onTick(), 250);
    this.events.once("shutdown", () => {
      window.clearInterval(tick);
      unsubscribe.forEach((off) => off());
    });
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
    return super.canAct() && !this.battle.myReady && !this.pendingPick && !this.match.closed && !this.match.reconnecting;
  }

  // Whole seconds left until the local deadline, or null.
  private secondsLeft(deadline: number | null): number | null {
    return deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }

  // Runs 4x a second: refresh the countdowns, and end the turn for the
  // player when time runs out (with whatever they had planned, if it can
  // still be paid for; otherwise a pass).
  private onTick(): void {
    if (!this.statusText?.active || isBattleOver(this.battle)) return;
    const left = this.match.turnDeadline === null ? null : this.match.turnDeadline - Date.now();
    if (left !== null && left <= 0 && !this.autoEnded && this.canAct()) {
      this.autoEnded = true;
      this.handHint = null;
      this.onEndTurnClick();
      if (!this.pendingPick) this.commitAction(passAction()); // plan couldn't be paid for
      return;
    }
    this.statusText.setText(this.statusMessage());
  }

  override commitAction(action: Action): void {
    this.planned = { staged: this.staged, stagedUltimate: this.stagedUltimate, stagedTargets: this.stagedTargets, orders: this.orders };
    this.clearPlanning();
    this.pendingTurn = { cards: action.cards, ultimate: action.ultimate, round: this.battle.round };
    this.errorMessage = null;
    const n = action.cards.length + (action.ultimate ? 1 : 0) + (action.orders?.length ?? 0);
    this.pendingPick = n === 0 ? "a pass" : n === 1 ? "1 play" : `${n} plays`;
    this.match.pick(action);
    this.render();
  }

  override async onLeave(): Promise<void> {
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
    if (this.match.reconnecting) return `Round ${b.round} — Connection lost. Reconnecting…`;
    const opponentLeft = this.secondsLeft(this.match.opponentDeadline);
    if (opponentLeft !== null) return `Round ${b.round} — Your opponent disconnected. They have ${opponentLeft}s to come back.`;
    if (this.errorMessage) return `Round ${b.round} — ${this.errorMessage}`;
    const turnLeft = this.secondsLeft(this.match.turnDeadline);
    const clock = turnLeft === null ? "" : ` (${turnLeft}s)`;
    if (this.pendingPick || b.myReady) {
      const what = this.pendingPick ?? "your move";
      return `Round ${b.round} — you locked in ${what}. ${b.opponentReady ? "Resolving…" : `Waiting for your opponent…${clock}`}`;
    }
    if (this.handHint) return `Round ${b.round} — ${this.handHint}${clock}`;
    return `Round ${b.round} — ${turnLeft === null ? "" : `${turnLeft}s · `}${this.plannedAp()}/${b.player.maxAp} AP left. Play cards, then End turn. ${
      b.opponentReady ? "Your opponent has already chosen." : "Your opponent is choosing at the same time."
    }`;
  }

  private applyView(view: RandomMatchView): void {
    if (!this.scene.isActive()) return;
    const previous = this.battle;
    const before = this.currentHp();
    this.battle = toBattleView(view);
    if (!this.battle.myReady) this.pendingPick = null;
    if (this.battle.round > previous.round) {
      this.planned = null;
      this.autoEnded = false;
    }

    // Replay the round if this update is the one that resolved it.
    const resolvedRound = this.battle.player.lastTurn?.round;
    const justResolved =
      resolvedRound === previous.round &&
      (this.battle.round > previous.round || (isBattleOver(this.battle) && !isBattleOver(previous)));
    if (justResolved) this.presentRound(before);
    else this.render();
  }
}
