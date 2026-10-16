# GodFieldLikeGame_school_project

A card battle game prototype based on the browser game [Godfield](https://godfield.net/).
Each card has a simple SVG illustration (see "Card art" below) plus a category and some numbers. Classes have their own stats, a synergy that gets stronger the
more you lean into it, and an ultimate that charges up over time. See
[docs/DESIGN.md](docs/DESIGN.md) for the full design notes this is built from.

## Running it

Built with [Vite](https://vitejs.dev/) + [React](https://react.dev/) + [Phaser](https://phaser.io/) — menus and popups are React DOM, battle frames are drawn on a Phaser canvas; see "Architecture" below. Requires Node.js.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`). Vite serves `index.html`,
`model-demo.html`, and `legacy/index.html` directly — navigate to whichever you want.

```bash
npm run build     # production build to dist/ (index.html + model-demo.html)
npm run preview   # serve that production build locally
npm run lint      # ESLint
npm run typecheck # tsc --noEmit (strict)
npm test          # Vitest (tests/)
```

`legacy/` isn't part of the production build — its scripts are plain global `<script>` tags with
no build step by design (see `legacy/` below), so there's nothing for Rollup to bundle. It's only
served during `npm run dev`; if you need it in `dist/` too, copy `legacy/` over by hand.

`src/**` is plain ES modules now (`import`/`export`), so Vite handles bundling and cache-busting
(hashed filenames) automatically — the old `?v=N` query-string convention is gone from `index.html`
and `model-demo.html`. `legacy/` is untouched (still global `<script>` tags with no build step);
Vite serves it as-is.

## How it plays

1. Pick a class: **Guardian** (tanky, physical, guard monsters), **Pyromancer** (fire, burning),
   **Black Mage** (pays HP / ultimate meter for AP and cards, lifesteal, curses), **Master
   Craftsman** (weapons that raise ATK, lots of ultimate charge) or **Necromancer** (fills the
   field with monsters, poison). The CPU gets a different one. Every deck also has the six
   general cards (Quick Jab, Splash, Spark, Healing Potion, Meditate, Smoke Bomb).
2. Each round, you and the CPU plan a turn **at the same time** — the CPU commits without
   knowing yours, and then both resolve together. Every card costs **AP** (the gem in its
   corner), Hearthstone-style: you have 2 AP in round 1, one more max AP every round (up to 10),
   and AP refills each turn (unspent AP is lost). Play as many cards as your AP pays for: click a
   card to see it big in the middle of the screen, click it again to put it on your arena slot
   (click one there to take it back), add your ultimate if it's charged, then press
   **End turn** (with nothing picked, that's a pass).
   - Attacks and ultimates go in **priority** order (fast cards first; where the two sides tie,
     each side's die roll for the round decides). A fighter knocked out mid-way gets none of
     their remaining strikes, and a landed "interrupts" card cancels the opponent's next attack
     card.
   - Attacks and monsters can have an **element** (fire / water / electric) and put
     **statuses** on the target: Burn and Poison deal damage each round, Wet makes electric hit
     harder (and fire weaker), Acid lowers DEF/ER, Slow lowers priority, Blind halves damage.
   - **Monster**: summons a monster to your field (3 slots). From the next round on it attacks
     each round, fastest first: the enemy's monsters (a *guard* monster first), or the enemy
     fighter once their field is empty. A guard monster also takes attack cards aimed at you.
   - **Attack**: deals damage of a type (physical / magic / element / true). The defender's
     matching resistance stat (DEF / MR / ER — true ignores all of them) reduces it, and so does
     any active defend card of the same type — including one committed this same round.
   - **Defend**: blocks incoming damage of one type, flat or percent, for a number of rounds.
     Because it's simultaneous, a defend you commit this round can block an attack the CPU
     commits this same round.
   - **Buff**: a positive effect on yourself (e.g. more ultimate regen).
   - **Debuff**: a negative effect on the opponent (e.g. drain their ultimate meter, or disable
     one of their synergies for a few rounds).
3. Your class's synergy gets stronger tiers the more you play the card type it rewards (e.g.
   Guardian's Bulwark synergy raises DEF further the more defend cards you've played).
4. Every round your ultimate meter fills by your UR (ultimate regen) stat. Once it's full, "Use
   Ultimate" becomes available as an extra action instead of playing a card.
5. Reduce the opponent's HP to 0 to win. If a round drops both fighters to 0 HP at once (e.g.
   from Burn/Poison), it's a draw.

Card names/numbers are first-pass values for wiring the system together, not tuned game
balance — see the open questions in `docs/DESIGN.md`.

## Architecture

`src/model/*` is the entire game engine (classes, cards, synergies, the round loop, TypeScript) and knows
nothing about rendering — no DOM, no Phaser. Rendering is split in two:
`src/app/` + `src/components/` + `src/hooks/` is the React shell (class select, lobby, card gallery,
dialogs), while `src/scenes/*` is the Phaser battle stage mounted by `<PhaserBattle>` /
`<PhaserOnlineBattle>` into a div. The shell and the canvas talk through one narrow bridge —
scene data in (`playerClass`, `match`/`hand`), an `onExit` callback out — so React never touches
HP/cards/rounds and Phaser never touches routing. `src/phaserIcons.ts` bridges the hand-authored
SVG strings from `src/icons.ts` into Phaser textures (base64 data URI → `this.load.svg`), so the
icon art didn't need to be redrawn with Phaser's Graphics API. (No `StrictMode`: its dev
double-effect would boot and destroy a whole `Phaser.Game` on every battle mount.)

## Online PvP (Supabase)

Log in (or sign up), pick a class and a deck, then **Create online room** (you get a 5-letter
code to send a friend) or **Join with code**. The login is kept per browser tab, so two tabs on
one machine can log in to two different accounts and play each other for testing.

### Accounts and decks

- **Accounts** are Supabase Auth email + password (`src/online/authApi.ts`, `src/components/AuthScreen.tsx`).
  The username is stored in the user's metadata and is only for display. When Supabase has
  **Confirm email** on (the default), a new account has to click the emailed link before logging
  in; turn it off under Authentication → Sign In / Providers → Email for quicker testing.
- **Decks**: every class has its **starter deck** (`class_deck_cards`), which every player has
  and can't edit. Each player can also build **up to 3 custom decks per class** in the deck
  builder (**Edit decks** on the class-select screen). A custom deck uses the class's own cards
  (the ones in its starter deck), 12–24 cards, at most 4 copies of each — see `DECK_RULES` in
  `src/model/decks.ts`.
- Custom decks live in the `decks` table (`supabase/migrations/*_player_decks.sql`): each player
  can read/write only their own rows, and a trigger rejects a 4th deck for the same class. The
  deck you pick on the class-select screen is used for vs-CPU and online matches; for online
  matches the `game` function re-checks it with `validateDeckList()` and copies it into
  `match_decks` (server-only), so editing a deck mid-match changes nothing and the opponent
  never sees your list.

The same `src/model/` engine runs on the server instead of in the browser:

- `supabase/functions/game/` — an Edge Function that imports `src/model/*` directly. Creating /
  joining a room and submitting a move all go through it; it checks the move is legal and, once
  both players have locked in, resolves the round with `resolveRound()`.
- `supabase/migrations/` — the tables. `matches` (what both players may see) and
  `match_hands` (each player can read only their own row) are readable from the browser;
  `match_secrets` (both decks/hands and the pending moves) has no RLS policies at all, so only
  the Edge Function can read it. That's what keeps a player from reading the other side's hand or
  move out of the page.
- `src/online/matchApi.ts` — the browser side: calls to the function, and Realtime
  updates (plus a slow poll as a fallback).
- `.env` — the project URL and *publishable* key. Both are public by design and committed.
  Never put the secret / service_role key there.

### Game catalog (classes, synergies, cards)

Classes, synergies, cards, and each class's deck live in Supabase tables (`classes`, `synergies`,
`class_synergies`, `cards`, `class_deck_cards`, see `supabase/migrations/*_game_catalog.sql`),
readable by anyone and writable only from the dashboard / service role.
`src/model/catalog.ts` loads them into the engine: the browser once at startup (falling back to
the bundled `src/model/catalogData.ts` if Supabase can't be reached, so vs-CPU still works
offline), the Edge Function per instance (re-read every 5 minutes).

- **Tweaking numbers / adding cards or classes**: edit the rows in the Table Editor. No redeploy.
  Matches already in progress keep the cards they were dealt.
- **New card attributes**: put them in `cards.props` (jsonb). Common fields are columns;
  anything category-specific is JSON, so it doesn't need a migration.
- **Ids are permanent** (`shield_bash`, `guardian`): rename with `name`, never change an `id`.
- **Changing the table shape**: always a new file in `supabase/migrations/`, never by hand in
  the dashboard. For renames/removals: add the new column → ship code that uses it → drop the
  old one.
- Older code skips card categories it doesn't know and ignores unknown effect kinds / stats, so
  adding new kinds of data first doesn't break the running game.
- `src/model/catalogData.ts` does not update itself from the database. `npm run catalog:sql` turns it into
  upsert SQL (that's how `*_seed_game_catalog.sql` was made).

After changing anything under `supabase/` (or `src/model/`, which the function bundles), push it
from the repo root, logged in with `npx supabase login`. **Pushes go to the sandbox (dev)
project by default**:

```bash
npm run db:push      # link the sandbox project and apply new migrations there
npm run fn:deploy    # redeploy the server on the sandbox project
```

Both projects need **Authentication → Sign In / Providers → Email** enabled in the Supabase
dashboard (it is by default). Anonymous sign-ins are no longer used.

### Sandbox project (separate dev database)

A second Supabase project (`jwhdynpvsojlpkwfxhou`, values in `.env.sandbox`) is where table /
data / Edge Function changes are tried out, so the main project (`vygltqnmontwxyyeyfyb`, in
`.env`) is left alone.

```bash
npm run dev:sandbox      # local dev server against the sandbox project
npm run build:sandbox    # production build against the sandbox project
```

`npm run dev` and `npm run build` still use the main project in `.env`.

**Pushing to the main project** is deliberately manual. Only do it once a change works on the
sandbox, and link back to the sandbox afterwards:

```bash
npx supabase link --project-ref vygltqnmontwxyyeyfyb
npx supabase db push
npx supabase functions deploy game --project-ref vygltqnmontwxyyeyfyb --use-api
npx supabase link --project-ref jwhdynpvsojlpkwfxhou
```

Card art (`npm run cards:art -- --upload`) uploads to the project in `.env`. To upload it to
the sandbox, put the sandbox's secret key in `.env.sandbox.local` (gitignored) as
`SUPABASE_SERVICE_ROLE_KEY=...` and run `npm run cards:art -- --upload --sandbox`.

## Card art

There's no tool in this environment that generates illustrations, so cards, classes, and the
ultimate each get a small hand-authored SVG icon instead (`src/icons.ts`):

- **Cards**: one base shape per category — sword (attack), shield (defend), upward spark (buff),
  downward drain (debuff) — plus a small colored corner dot on attack/defend cards showing their
  damage type (grey physical, violet magic, orange element, gold true). Driven by the card's data
  (`category`/`damageType`), not its name, so any new card automatically gets a sensible icon
  without adding one by hand.
- **Classes**: one emblem per class id (a blue crest-shield for Guardian, a two-tone flame for
  Pyromancer), shown on the class-select card and the fighter panel heading. A class with no
  entry in `CLASS_ICON_BODY` just renders without an icon rather than erroring, so adding a new
  class doesn't require adding its icon at the same time.
- **Ultimate**: a single generic gold "burst" icon shared by every class, next to the "Use
  Ultimate" button, each class-select card's ultimate line, and the ultimate meter label. It's
  shared rather than per-class because the ultimate's actual theme/name is still an open question
  (see `docs/DESIGN.md`) — a per-class ultimate icon would be guessing at design that hasn't
  happened yet.

### Card artwork and the card gallery

The **Card gallery** button (top right of the class-select screen) lists every card in the
catalog, filterable by category. A card can have its own artwork via the optional `image_url`
column on the `cards` table (`supabase/migrations/*_card_images.sql`); cards without one keep
showing their category icon, as does any card whose image fails to load. `image_url` can be:

- a file in the public **`card-images`** Storage bucket (upload it in the Supabase dashboard,
  then paste its public URL), or
- a path served by the site itself, e.g. `/cards/shield_bash.png` for a file at
  `public/cards/shield_bash.png`.

Every current card has an illustration in `card-art/*.svg`, generated from
`scripts/card-art.ts` (one emblem per card id, plus a generic per-category emblem for cards
without one). Edit the script, then:

```bash
npm run cards:art                 # regenerate card-art/*.svg
npm run cards:art -- --upload     # ...and upload them to the card-images bucket + set cards.image_url
```

Uploading needs the project's secret key in `.env.local` (gitignored) as
`SUPABASE_SERVICE_ROLE_KEY=...` — never in `.env` or anything under `src/`. Artwork shows up in
the gallery, on hand cards, and in the round recap.

## Backgrounds

The class-select, lobby and card-gallery screens (a castle on a hill at dusk; dimmed in the
gallery) and the battle screen (a torch-lit castle
hall) have medieval-fantasy background illustrations, `public/backgrounds/*.svg`, generated by
`scripts/backgrounds.ts` (`npm run backgrounds` after editing it). They're kept dark where the UI
sits and detailed where the screen is empty; the battle screen adds a flickering glow over the
painted torches (positions in `TORCHES`, mirrored in `BattleScene.ts`) and a dark backing
behind the battle log. They ship with the site (Vite copies `public/` into `dist/`), so they
also work offline.

## Round recap (animation + sound)

When a round resolves, the battle screen replays it before handing control back
(`src/scenes/roundRecap.ts`): each side's card flies out of its panel, then an effect per card
type — a projectile, hit flash and floating damage number for attacks (HP bars count down as hits
land, and a "Shield −5 · DEF −2" note shows what the target's defend card and resistance soaked
up), a big "GUARD +5" with shield rings for defends, rising/falling sparks for buffs/debuffs.
Steps follow the engine's own order (both sides' defend/buff/debuff cards, then both sides'
attacks). The **Speed** button at the top right sets the playback speed (1x / 1.5x / 2x / 3x,
remembered per browser, applies even mid-replay); clicking during the recap fast-forwards it.

**Ultimates** (`src/scenes/ultimateFx.ts`) look and sound different from normal cards: a
full-width cut-in banner with the class emblem and ultimate name, then a per-class effect —
Guardian drops a giant gold crest that slams the target (light column, shockwave rings, debris,
metallic crash), Pyromancer charges a fireball that arcs across the screen and explodes into flame
pillars (heat haze, roar, crackling blast). A class without an entry in `THEMES` there gets a
generic gold effect, so adding a class never breaks the recap.

When the game ends, a **VICTORY / DEFEAT / DRAW** screen appears in the middle of the screen
(rays and confetti for a win), with the final HP, a Back to menu button, and "View
board" to close it and look at the final state.

Sound effects are synthesized in the browser with Web Audio (`src/fx/sound.ts`), so there are no
audio files. The **Sound** button at the top right mutes them; the choice is remembered per browser.

While a defend card is up, that fighter's panel gets a pulsing blue frame, a "GUARD +5" badge,
and the matching resistance chip (DEF for physical, MR for magic, ER for element) turns blue with
the guard amount. Any stat above or below the class's base value is outlined green or red.

The recap reads each fighter's `lastAction`, which `resolveRound()` records and the server
includes in the public match state — so online matches need the `game` function redeployed
(`npx supabase functions deploy game`) before they show it; until then they just skip the recap.

## File layout

| Path | Purpose |
| --- | --- |
| `index.html` | The game — a `#root` div; React owns the shell, Phaser owns the battle canvas inside it |
| `src/main.tsx` | React-shell bootstrap (catalog load, then `<App />`) |
| `src/app/App.tsx` | Screen state machine: menu / battle / lobby / online-battle / gallery |
| `src/components/ClassSelect.tsx` | Class-select screen (was `ClassSelectScene`) |
| `src/components/Gallery.tsx` | Card gallery (was `CardGalleryScene`) |
| `src/components/Lobby.tsx` | Online: create/join a room, wait for the opponent (was `LobbyScene`) |
| `src/components/Dialog.tsx` | Join-code / confirm popups (React; the canvas-era `src/ui/dialog.ts` still serves `OnlineBattleScene`'s leave confirm) |
| `src/components/PhaserBattle.tsx` | vs-CPU battle mount: creates a scoped `Phaser.Game`, starts `BattleScene`, destroys on unmount |
| `src/components/PhaserOnlineBattle.tsx` | Online battle mount — same, for `OnlineBattleScene` |
| `src/components/phaserGame.ts` | Shared `createPhaserGame()` helper (HiDPI text patch, FIT scaling) |
| `src/hooks/useCatalog.ts` | Catalog load with Supabase → local fallback (was inline in old `main.js`) |
| `src/scenes/BattleScene.ts` | Battle stage: renders the model's battle state, turns clicks into `playRound()` calls; `onExit` returns to the React menu |
| `src/scenes/OnlineBattleScene.ts` | Online battle stage — `BattleScene`'s drawing, fed by the server instead of a local engine |
| `src/online/matchApi.ts` | Supabase client for online PvP (see "Online PvP" above) |
| `supabase/` | Supabase config, database migrations, and the `game` Edge Function |
| `src/scenes/roundRecap.ts` | End-of-round animation + sound effects (see "Round recap" above) |
| `src/scenes/ultimateFx.ts` | Per-class ultimate cut-in and effects |
| `src/scenes/recapUtil.ts` | Small animation helpers shared by the recap and ultimate effects |
| `src/scenes/cardFace.ts` | Draws one card (art/icon, name, effect text) — hand and recap |
| `src/cardArt.ts` | Loads `cards.image_url` artwork into Phaser textures |
| `src/fx/sound.ts` | Synthesized sound effects + mute switch |
| `src/ui/dialog.ts` | Leave-match confirm inside the Phaser battle (join-code input now lives in React `Dialog`) |
| `scripts/backgrounds.ts`, `public/backgrounds/` | Scene background illustrations (SVG) and their generator |
| `scripts/card-art.ts`, `card-art/` | Card illustrations (SVG) and their generator/uploader |
| `src/scenes/theme.ts` | Shared colors/fonts + small draw helpers (`roundedRect`, `createButton`) |
| `src/icons.ts` | Small hand-authored SVG icon per card category (+ a damage-type accent dot) — see "Card art" below |
| `src/phaserIcons.ts` | Loads `src/icons.ts`'s SVG markup as Phaser textures — see "Architecture" below |
| `src/style.css` | React shell styles + Phaser canvas positioning |
| `src/model/` | The class/stat/synergy/card data model + battle engine (see below) |
| `docs/DESIGN.md` | Design notes this is built from, including what's still open/unimplemented |
| `model-demo.html` | Standalone smoke test for `src/model/`, independent of the UI |
| `legacy/` | The original simple attack/defense-only prototype (no classes/synergies), kept for reference |

### `src/model/`

| File | Purpose |
| --- | --- |
| `util.ts` | Shuffle helper |
| `stats.ts` | Stat block shape (`hp, def, mr, er, ur, crit`) |
| `damageTypes.ts` | Damage types and which stat resists each one |
| `effects.ts` | Shared effect shapes used by synergies, class passives, buffs, and debuffs |
| `cardTypes.ts` | The 4 card categories (attack/defend/buff/debuff) and defend-vs-attack resolution |
| `synergies.ts` | Tiered synergy definitions and resolution |
| `classes.ts` | Class definitions and effective-stat calculation |
| `catalog.ts` | Loads classes/synergies/cards (Supabase or local copy); `findClassById`, `allClasses`, `buildDeckForClass` |
| `catalogData.ts` | Local copy of the catalog rows: offline fallback and the source for `npm run catalog:sql` |
| `engine.ts` | The round loop: simultaneous card/ultimate resolution, damage/effects, a simple CPU |
| `serialize.ts` | Battle state ↔ plain JSON, and the public (no hands/decks) view of it, for online PvP |
| `demo.ts` | The assertions rendered by `model-demo.html` |

## Known simplifications (see docs/DESIGN.md for the full list)

- Online PvP has no matchmaking, reconnect-after-closing-the-tab, or turn timer: a room is
  joined by code, and a player who never picks a card stalls the match until they press Leave.
- No fog of war / troop placement.
- A defend card fully replaces an earlier one of the same damage type rather than stacking
  amounts, even when marked stackable.
- `CONDITIONAL` and `SUMMON` effects are accepted by the data model but are no-ops in the engine.

## Ideas for next steps

- Online PvP: turn timer, matchmaking, rejoining a match after closing the tab
- Fog of war
- More classes/synergies/cards with real (not placeholder) names and balance
- Real stacking for stackable defend cards
- Draw only 1 card per turn to add a resource-management element
- Animations / sound effects
- Tests for the rules logic (currently just the in-browser checks in `model-demo.html`; now that
  the project has npm via Vite, a real test runner like Vitest is an option)

