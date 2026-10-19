// Random-match PvP room. Colyseus fills each "battle" room with 2 players
// (joinOrCreate), so the matchmaking itself is built in. The game rules are
// the same src/model/* files the browser and the `game` Edge Function use.
import { Room, type Client, type Delayed } from "@colyseus/core";
import { createBattle, fromClientAction, passAction, resolveRound, isBattleOver } from "../src/model/engine.ts";
import type { Action, Battle, ClientAction, Fighter } from "../src/model/engine.ts";
import { findClassById } from "../src/model/catalog.ts";
import { buildDeckFromList, validateDeckList, type DeckListEntry } from "../src/model/decks.ts";
import { serializeFighter } from "../src/model/serialize.ts";
import type { ClassDef } from "../src/model/classes.ts";
import type { RandomMatchView } from "../src/online/randomMatchView.ts";
import { admin } from "./supabase.ts";

interface JoinOptions {
  token?: string;
  classId?: string;
  deckId?: string | null;
}

interface Seat {
  client: Client;
  userId: string;
  classDef: ClassDef;
  deckList: DeckListEntry[] | null;
  pick: Action | null;
  reconnectBy: number | null; // while dropped: when the seat is given up (ms)
}

const RECONNECT_SECONDS = 30;
const TURN_SECONDS = 30;
// Extra time after the turn ends before the server passes for a player, so a
// turn the browser auto-sends at 0s still arrives in time.
const TURN_GRACE_MS = 2000;

export class BattleRoom extends Room {
  maxClients = 2;
  private seats: Seat[] = [];
  private battle: Battle | null = null;
  private turnEndsAt: number | null = null;
  private turnTimer: Delayed | null = null;

  // Runs before onJoin: check the Supabase login and the chosen deck.
  async onAuth(_client: Client, options: JoinOptions) {
    const { data, error } = await admin.auth.getUser(options.token ?? "");
    if (error || !data.user || data.user.is_anonymous) throw new Error("Log in to an account to play online");
    const userId = data.user.id;
    if (this.seats.some((s) => s.userId === userId)) throw new Error("You're already in this match");

    const classDef = findClassById(String(options.classId));
    let deckList: DeckListEntry[] | null = null;
    if (options.deckId) {
      const { data: deck } = await admin
        .from("decks")
        .select("class_id, cards")
        .eq("id", options.deckId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!deck || deck.class_id !== classDef.id) throw new Error("Deck not found");
      const problem = validateDeckList(classDef, deck.cards);
      if (problem) throw new Error(`That deck can't be used: ${problem}`);
      deckList = deck.cards as DeckListEntry[];
    }
    return { userId, classDef, deckList };
  }

  onJoin(client: Client, _options: JoinOptions, auth: { userId: string; classDef: ClassDef; deckList: DeckListEntry[] | null }) {
    this.seats.push({ client, ...auth, pick: null, reconnectBy: null });
    if (this.seats.length < 2) {
      client.send("waiting");
      return;
    }
    const [p1, p2] = this.seats as [Seat, Seat];
    this.battle = createBattle(p1.classDef, p2.classDef, {
      playerDeck: p1.deckList ? buildDeckFromList(p1.deckList) : null,
      cpuDeck: p2.deckList ? buildDeckFromList(p2.deckList) : null,
    });
    this.startTurnTimer();
    this.sendViews();
  }

  onCreate() {
    this.onMessage("pick", (client, action: ClientAction) => {
      const seat = this.seatOf(client);
      if (!this.battle || !seat || seat.pick) return;
      const fighter = this.fighterOf(seat);
      const opponent = fighter === this.battle.player ? this.battle.cpu : this.battle.player;
      // The whole turn (cards, ultimate, targets, monster orders), re-checked
      // against the server's own copy of the battle.
      const picked = fromClientAction(fighter, opponent, action);
      if (!picked) return client.send("error", "You can't play that right now");
      seat.pick = picked;
      this.resolveIfReady();
    });
  }

  // Resolve the round once both players have locked in; otherwise just show
  // "opponent has chosen".
  private resolveIfReady(note?: string) {
    const [p1, p2] = this.seats as [Seat, Seat];
    if (!this.battle || !p1.pick || !p2.pick) return this.sendViews();

    resolveRound(this.battle, p1.pick, p2.pick);
    if (note) this.battle.log.unshift(note);
    p1.pick = p2.pick = null;
    if (isBattleOver(this.battle)) {
      this.stopTurnTimer();
      this.sendViews();
      this.disconnect();
      return;
    }
    this.startTurnTimer();
    this.sendViews();
  }

  // Each round has TURN_SECONDS; whoever hasn't ended their turn by then
  // passes (plays nothing).
  private startTurnTimer() {
    this.stopTurnTimer();
    this.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
    this.turnTimer = this.clock.setTimeout(() => {
      if (!this.battle || isBattleOver(this.battle)) return;
      for (const seat of this.seats) seat.pick ??= passAction();
      this.resolveIfReady("Time's up! Players who hadn't ended their turn passed.");
    }, TURN_SECONDS * 1000 + TURN_GRACE_MS);
  }

  private stopTurnTimer() {
    this.turnTimer?.clear();
    this.turnTimer = null;
    this.turnEndsAt = null;
  }

  // Lost connection (closed tab, wifi drop): hold the seat for a while.
  // If they don't come back in time, onLeave counts it as a forfeit.
  async onDrop(client: Client) {
    const seat = this.seatOf(client);
    if (seat) seat.reconnectBy = Date.now() + RECONNECT_SECONDS * 1000;
    if (this.battle) this.sendViews(); // the opponent sees the countdown
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client: Client) {
    const seat = this.seats.find((s) => s.client.sessionId === client.sessionId);
    if (seat) {
      seat.client = client;
      seat.reconnectBy = null;
    }
    if (this.battle) this.sendViews();
  }

  // Left for good (pressed Leave, or didn't come back in time) = forfeit.
  onLeave(client: Client) {
    const seat = this.seatOf(client);
    if (seat) seat.reconnectBy = null;
    if (!this.battle || isBattleOver(this.battle)) return;
    this.stopTurnTimer();
    const other = this.otherSeat(seat);
    if (other) {
      this.battle.winner = this.fighterOf(other);
      this.battle.log.unshift("Opponent left the match.");
      this.sendViews();
    }
    this.disconnect();
  }

  private seatOf(client: Client) {
    return this.seats.find((s) => s.client.sessionId === client.sessionId);
  }

  private otherSeat(seat: Seat | undefined) {
    return seat && this.seats.find((s) => s !== seat);
  }

  private fighterOf(seat: Seat): Fighter {
    return seat === this.seats[0] ? this.battle!.player : this.battle!.cpu;
  }

  // Each player sees both fighters' public stats but only their own hand.
  private sendViews() {
    const battle = this.battle!;
    const now = Date.now();
    for (const seat of this.seats) {
      if (seat.reconnectBy !== null) continue; // dropped: gets a fresh view on reconnect
      const other = this.otherSeat(seat);
      const me = this.fighterOf(seat);
      const opponent = me === battle.player ? battle.cpu : battle.player;
      seat.client.send("state", {
        round: battle.round,
        me: { ...serializeFighter(me), hand: me.hand }, // own hand only, never the deck order
        opponent: serializeFighter(opponent),
        log: battle.log,
        over: isBattleOver(battle),
        myReady: seat.pick !== null,
        opponentReady: other?.pick != null,
        // Time left, not a timestamp, so the browser's clock doesn't matter.
        turnMsLeft: this.turnEndsAt === null ? null : Math.max(0, this.turnEndsAt - now),
        opponentReconnectMsLeft: other?.reconnectBy == null ? null : Math.max(0, other.reconnectBy - now),
        result: battle.draw ? "draw" : battle.winner === me ? "win" : battle.winner ? "lose" : null,
      } satisfies RandomMatchView);
    }
  }
}
