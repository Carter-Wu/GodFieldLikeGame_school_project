// The online-PvP server: every write to a match goes through here. It is the
// only code holding the service-role key, so it's the only thing that can
// read match_secrets (both hands, both decks, both pending moves) -- the
// browser only ever sees `matches` and its own row of `match_hands`. See
// supabase/migrations/*_online_pvp.sql for the tables.
//
// The game rules are the exact same src/model/* files the browser uses for
// vs-CPU play, imported straight from the repo.
//
// POST body is { op, ...args }:
//   { op: "create", classId }            -> { id, code }
//   { op: "join", code, classId }        -> { id }
//   { op: "submit", matchId, action }    -> { resolved }
//       action: { kind: "card", cardId } | { kind: "ultimate" }
//   { op: "leave", matchId }             -> {}

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createBattle,
  cardAction,
  ultimateAction,
  resolveRound,
  isBattleOver,
  type Action,
  type ClientAction,
  type Fighter,
} from "../../../src/model/engine.ts";
import { findClassById, loadCatalog } from "../../../src/model/catalog.ts";
import { serializeBattle, deserializeBattle, publicFighters } from "../../../src/model/serialize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// No ambiguous characters (0/O, 1/I) so a code read out loud still works.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Classes/cards come from the catalog tables (see src/model/catalog.ts).
// Each function instance caches them and re-reads after CATALOG_TTL_MS, so a
// balance change made in the dashboard reaches new matches within a few
// minutes without a redeploy. Matches already running keep the cards they
// were dealt -- those are copied into match_secrets.
const CATALOG_TTL_MS = 5 * 60 * 1000;
let catalogLoad: Promise<unknown> | null = null;
let catalogLoadedAt = 0;
let haveCatalog = false;

function ensureCatalog() {
  if (!catalogLoad || Date.now() - catalogLoadedAt > CATALOG_TTL_MS) {
    catalogLoadedAt = Date.now();
    catalogLoad = loadCatalog(admin).then(
      () => {
        haveCatalog = true;
      },
      (err) => {
        catalogLoad = null; // retry on the next request instead of caching the failure
        if (!haveCatalog) throw err;
        console.error("Catalog refresh failed, keeping the previous one:", err); // a stale catalog beats an outage
      }
    );
  }
  return catalogLoad;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

async function authenticate(req: Request): Promise<string> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Not signed in");
  return data.user.id;
}

function parseClass(classId: unknown) {
  try {
    return findClassById(String(classId));
  } catch {
    throw new HttpError(400, "Unknown class");
  }
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// Client action -> engine action for this fighter, or null if the fighter
// can't actually play it (card not in hand, ultimate not charged).
function toEngineAction(fighter: Fighter, action: ClientAction | null | undefined): Action | null {
  if (action?.kind === "card") return cardAction(fighter, Number(action.cardId));
  if (action?.kind === "ultimate") return ultimateAction(fighter);
  return null;
}

// --- ops -----------------------------------------------------------------

async function createMatch(userId: string, body: { classId?: unknown }) {
  const classDef = parseClass(body.classId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await admin
      .from("matches")
      .insert({ code: randomCode(), p1: userId, p1_class: classDef.id })
      .select("id, code")
      .single();
    if (!error) return data;
    if (error.code !== "23505") throw new Error(error.message); // 23505 = code collision, retry
  }
  throw new Error("Couldn't generate a free room code");
}

async function joinMatch(userId: string, body: { code?: unknown; classId?: unknown }) {
  const code = String(body.code ?? "").trim().toUpperCase();
  const classDef = parseClass(body.classId);

  const existing = check(await admin.from("matches").select("id, p1").eq("code", code).maybeSingle());
  if (!existing) throw new HttpError(404, `No room with code ${code}`);
  if (existing.p1 === userId) {
    throw new HttpError(400, "That's your own room -- join it from another browser or a private window.");
  }

  // Claiming the p2 seat is one conditional UPDATE, so two people joining
  // the same code at once can't both get in.
  const match = check(
    await admin
      .from("matches")
      .update({ p2: userId, p2_class: classDef.id, status: "active" })
      .eq("id", existing.id)
      .eq("status", "waiting")
      .is("p2", null)
      .select()
      .maybeSingle()
  );
  if (!match) throw new HttpError(409, "That room is already full");

  const p1Class = findClassById(match.p1_class);
  const labels =
    p1Class.id === classDef.id ? { playerLabel: `${p1Class.name} (P1)`, cpuLabel: `${classDef.name} (P2)` } : {};
  const battle = createBattle(p1Class, classDef, labels);

  check(await admin.from("match_secrets").insert({ match_id: match.id, battle: serializeBattle(battle), round: battle.round }));
  check(
    await admin.from("match_hands").insert([
      { match_id: match.id, player: match.p1, hand: battle.player.hand },
      { match_id: match.id, player: userId, hand: battle.cpu.hand },
    ])
  );
  // Written last: the browser treats `fighters` being set as "battle ready".
  check(
    await admin
      .from("matches")
      .update({ round: battle.round, fighters: publicFighters(battle), log: battle.log, updated_at: new Date().toISOString() })
      .eq("id", match.id)
  );
  return { id: match.id };
}

async function submitAction(userId: string, body: { matchId?: unknown; action?: unknown }) {
  const matchId = String(body.matchId ?? "");
  const match = check(await admin.from("matches").select("*").eq("id", matchId).maybeSingle());
  if (!match || (match.p1 !== userId && match.p2 !== userId)) throw new HttpError(404, "Match not found");
  if (match.status !== "active") throw new HttpError(409, "This match isn't in progress");

  const side = match.p1 === userId ? "p1" : "p2";
  const secrets = check(await admin.from("match_secrets").select("battle, round").eq("match_id", matchId).single());
  const battle = deserializeBattle(secrets.battle);
  const fighter = side === "p1" ? battle.player : battle.cpu;
  const action = body.action as ClientAction | undefined;
  if (!toEngineAction(fighter, action)) throw new HttpError(400, "You can't play that right now");
  const stored = action.kind === "card" ? { kind: "card", cardId: Number(action.cardId) } : { kind: "ultimate" };

  // Flag "ready" BEFORE storing the move: whichever request ends up resolving
  // the round only does so after seeing this move stored, so its reset of
  // both ready flags always lands after this write, never before it.
  check(await admin.from("matches").update({ [`${side}_ready`]: true }).eq("id", matchId).eq("round", secrets.round));

  // One conditional UPDATE per side. Postgres serializes the two players'
  // updates on this row, so exactly one of them sees both moves present and
  // goes on to resolve the round.
  const row = check(
    await admin
      .from("match_secrets")
      .update({ [`${side}_action`]: stored })
      .eq("match_id", matchId)
      .eq("round", secrets.round)
      .is(`${side}_action`, null)
      .select("battle, round, p1_action, p2_action")
      .maybeSingle()
  );
  if (!row) throw new HttpError(409, "You already picked a move this round");
  if (!row.p1_action || !row.p2_action) return { resolved: false };

  await resolveMatchRound(match, row);
  return { resolved: true };
}

interface MatchRow {
  id: string;
  p1: string;
  p2: string | null;
  p1_class?: string;
  p2_class?: string;
  status: string;
  log: string[];
}

interface SecretsRow {
  battle: Parameters<typeof deserializeBattle>[0];
  round: number;
  p1_action: ClientAction | null;
  p2_action: ClientAction | null;
  match_id?: string;
}

async function resolveMatchRound(match: MatchRow, row: SecretsRow): Promise<void> {
  const battle = deserializeBattle(row.battle);
  const p1Action = toEngineAction(battle.player, row.p1_action);
  const p2Action = toEngineAction(battle.cpu, row.p2_action);
  if (!p1Action || !p2Action) return; // stale row -- the other resolver already cleared it
  resolveRound(battle, p1Action, p2Action);

  const saved = check(
    await admin
      .from("match_secrets")
      .update({ battle: serializeBattle(battle), round: battle.round, p1_action: null, p2_action: null })
      .eq("match_id", match.id)
      .eq("round", row.round)
      .select("match_id")
      .maybeSingle()
  );
  if (!saved) return; // already resolved by someone else

  check(await admin.from("match_hands").update({ hand: battle.player.hand }).eq("match_id", match.id).eq("player", match.p1));
  check(await admin.from("match_hands").update({ hand: battle.cpu.hand }).eq("match_id", match.id).eq("player", match.p2));

  const over = isBattleOver(battle);
  const winner = battle.draw ? "draw" : battle.winner === battle.player ? "p1" : battle.winner === battle.cpu ? "p2" : null;
  check(
    await admin
      .from("matches")
      .update({
        round: battle.round,
        fighters: publicFighters(battle),
        log: battle.log,
        p1_ready: false,
        p2_ready: false,
        status: over ? "finished" : "active",
        winner,
        updated_at: new Date().toISOString(),
      })
      .eq("id", match.id)
  );
}

// Leaving a waiting room closes it; leaving a battle forfeits it.
async function leaveMatch(userId: string, body: { matchId?: unknown }) {
  const matchId = String(body.matchId ?? "");
  const match = check(await admin.from("matches").select("*").eq("id", matchId).maybeSingle());
  if (!match || (match.p1 !== userId && match.p2 !== userId)) throw new HttpError(404, "Match not found");
  if (match.status === "finished") return {};

  const side = match.p1 === userId ? "p1" : "p2";
  const update =
    match.status === "waiting"
      ? { status: "finished" }
      : {
          status: "finished",
          winner: side === "p1" ? "p2" : "p1",
          log: [`Player ${side === "p1" ? 1 : 2} left the match.`, ...match.log],
        };
  check(
    await admin
      .from("matches")
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("id", matchId)
      .neq("status", "finished")
  );
  return {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userId = await authenticate(req);
    await ensureCatalog();
    const body = await req.json();
    switch (body?.op) {
      case "create":
        return json(await createMatch(userId, body));
      case "join":
        return json(await joinMatch(userId, body));
      case "submit":
        return json(await submitAction(userId, body));
      case "leave":
        return json(await leaveMatch(userId, body));
      default:
        throw new HttpError(400, `Unknown op "${body?.op}"`);
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, status);
  }
});
