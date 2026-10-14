// Online PvP battle screen. Draws exactly like the vs-CPU BattleScene -- it
// only swaps where the battle comes from: instead of running engine.ts
// locally, it shows the server's copy (via src/online/matchApi.ts) and sends
// each click to the `game` Edge Function, which resolves the round once both
// players have picked.

import { BattleScene, type BattleSceneData } from "./BattleScene.ts";
import { isBattleOver, type Action } from "../model/engine.ts";
import type { Card } from "../model/cardTypes.ts";
import {
  buildBattleView,
  fetchHand,
  fetchMatch,
  fetchMatchVersion,
  leaveMatch,
  submitAction,
  watchMatch,
  type BattleView,
  type MatchRow,
  type MatchVersion,
} from "../online/matchApi.ts";
import { confirmDialog } from "../ui/dialog.ts";

export interface OnlineBattleData {
  matchId: string;
  userId: string;
  match: MatchRow;
  hand: Card[];
  onExit?: (() => void) | null;
}

function versionOf(match: MatchRow): MatchVersion {
  const { updated_at, status, round, p1_ready, p2_ready } = match;
  return { updated_at, status, round, p1_ready, p2_ready };
}

export class OnlineBattleScene extends BattleScene {
  declare battle: BattleView;
  matchId!: string;
  userId!: string;
  submitting = false;
  pendingPick: string | null = null; // name of what we just locked in, until the round resolves
  errorMessage: string | null = null;
  refreshSeq = 0;
  version!: MatchVersion;
  mySide: "p1" | "p2" = "p1";
  stopWatching: (() => void) | null = null;

  constructor() {
    super("OnlineBattleScene");
  }

  // data: { matchId, userId, match, hand } from the React shell's Lobby.
  // Takes the union with BattleSceneData so the override stays assignable
  // to the base signature; the cast is safe because Phaser only ever starts
  // this scene with online data (see PhaserOnlineBattle).
  override setupBattle(data: BattleSceneData | OnlineBattleData): BattleView {
    const online = data as OnlineBattleData;
    this.matchId = online.matchId;
    this.userId = online.userId;
    this.submitting = false;
    this.pendingPick = null; // name of what we just locked in, until the round resolves
    this.errorMessage = null;
    this.refreshSeq = 0;
    this.version = versionOf(online.match);
    this.mySide = online.match.p1 === this.userId ? "p1" : "p2";

    this.stopWatching = watchMatch(this.matchId, () => void this.refresh());
    this.events.once("shutdown", () => this.stopWatching?.());
    // A finished match can't change any more, so stop listening for updates.
    if (online.match.status === "finished") this.stopWatching();

    return buildBattleView(online.match, online.hand, this.userId);
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
    // The server logs "Player N left the match." when someone forfeits.
    if (b.winner === b.player && b.log[0]?.includes("left the match")) return "Your opponent left the match.";
    return super.resultSubtitle();
  }

  override canAct(): boolean {
    return super.canAct() && !this.battle.myReady && !this.submitting && !this.pendingPick;
  }

  override commitAction(action: Action): void {
    this.previewedCardId = null;
    this.previewedView = null;
    this.dismissTween?.stop();
    this.dismissTween = null;
    this.submitting = true;
    this.errorMessage = null;
    this.pendingPick = action.kind === "card" ? action.card.name : "your ultimate";
    this.render();

    submitAction(this.matchId, action)
      .catch((err: Error) => {
        this.errorMessage = err.message;
        this.pendingPick = null;
        // The round never resolved: drop the pending slots (the flight, if
        // any, already landed or was superseded -- its guards no-op).
        this.pendingPlay = null;
      })
      .finally(() => {
        this.submitting = false;
        void this.refresh();
        this.render();
      });
  }

  override async onLeave(): Promise<void> {
    // Abandon any commit flight first (same guard as the base onLeave).
    this.flightSeq++;
    this.finishFlight();
    if (!isBattleOver(this.battle)) {
      const leave = await confirmDialog({
        title: "Leave this match?",
        message: "It counts as a loss.",
        confirmLabel: "Leave",
        danger: true,
      });
      if (!leave || !this.sys.isActive()) return;
      // The match may have ended while the dialog was open.
      if (!isBattleOver(this.battle)) leaveMatch(this.matchId).catch(() => {});
    }
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

  // Check for changes and redraw if there are any. Called by Realtime events,
  // the fallback poll, and after our own submit. Asks for the tiny "version"
  // columns first and only pulls the full row + hand when a round actually
  // resolved (or the match ended). Only the newest call's result is applied,
  // so a slow response can't roll the screen back.
  async refresh(): Promise<void> {
    const seq = ++this.refreshSeq;
    const isStale = (): boolean => seq !== this.refreshSeq || !this.scene.isActive();

    let version: MatchVersion;
    try {
      version = await fetchMatchVersion(this.matchId);
    } catch {
      return; // transient network error; the next poll will try again
    }
    if (isStale()) return;

    if (version.updated_at === this.version.updated_at && version.status === this.version.status) {
      // At most someone locked in a move -- patch the flags, no full fetch.
      if (version.p1_ready === this.version.p1_ready && version.p2_ready === this.version.p2_ready) return;
      this.version = version;
      this.battle.myReady = version[`${this.mySide}_ready`];
      this.battle.opponentReady = version[this.mySide === "p1" ? "p2_ready" : "p1_ready"];
      this.render();
      return;
    }

    let match: MatchRow;
    let hand: Card[];
    try {
      [match, hand] = await Promise.all([fetchMatch(this.matchId), fetchHand(this.matchId, this.userId)]);
    } catch {
      return;
    }
    if (isStale()) return;

    const previous = this.battle;
    const before = this.currentHp();
    this.version = versionOf(match);
    this.battle = buildBattleView(match, hand, this.userId);
    if (!this.battle.myReady && !this.submitting) this.pendingPick = null;
    if (match.status === "finished") this.stopWatching?.();

    // Replay the round if this update is the one that resolved it (not, say,
    // the opponent leaving).
    const resolvedRound = this.battle.player.lastAction?.round;
    const justResolved =
      resolvedRound === previous.round && (this.battle.round > previous.round || (isBattleOver(this.battle) && !isBattleOver(previous)));
    if (justResolved) this.presentRound(before);
    else this.render();
  }
}
