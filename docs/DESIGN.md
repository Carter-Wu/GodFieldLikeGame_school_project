# Design Notes — Core Gameplay Mechanics (v2 concept)

Status: **partially implemented.** Simultaneous turn resolution and the class/synergy/
card system are playable now (`index.html`, `src/model/`) against a CPU opponent — see
the root [README](../README.md). PvP and fog of war are still just notes below; see
"Architecture implications" for why those two specifically need more than the current
single-page client.

## Turn resolution

- Both players take their turns at the same time; all actions resolve simultaneously.
  **Implemented for PvE**: each round the player commits a card and the CPU
  independently picks its own from state alone (never the player's pending choice),
  then both resolve together — see `src/model/engine.js` (`playRound`). Real PvP
  still needs a server; see "Architecture implications".
- Fog of war when placing troops. **Not implemented.**

## Class system / deck synergy system

- Each class has access to certain deck synergies.
- Synergy levels
  - Synergies can include passive effects or active effects (buffs/debuffs).
  - Open question: can a class have multiple active synergies at once?
- Each class has access to a unique ultimate.
  - Naming idea: something themed around an "all-in" concept — needs a real name.

## Base stats

Class-based, and modified by synergies.

- HP
- DEF
- MR (Magic Resist)
- ER (Element Resistance)
- UR (Ultimate Regen)
- Crit? (open question — not decided whether crit is in scope)
- Passives
  - Class-based
  - Synergy-based

## Card types

### Attack

- Damage types: Physical / Magic / Element / True / etc.

### Defend

- Flat reduction
- Percent reduction
- Typed: Physical / Magic / Element
- Stackable vs. non-stackable
- Lasts X turns

### Buff

- Energy regen increase
- Conditional effects
- Summoning?
- etc.

### Debuff

- Damage / defense / MR reduction
- Disables a synergy
- Meter siphon? (drains an opponent's ultimate/energy meter)

### Monster

- HP, ATK, Speed; up to 3 on a side's field. Can take orders from the round after it's summoned.
- Acts only when ordered, once per turn, paid with AP: **attack** (`attackCost`, default 1) or its
  **ability** (own AP cost; damage to a target and/or buff/debuff effects, e.g. Fortify,
  Fire Breath, Overdrive, Infectious Bite, Grave Ward). Ordered monsters act after the attack
  cards, fastest first (ties: dice). Hits on the enemy fighter ignore DEF/MR/ER.
- **Targeting** (attack cards and monster orders): the player picks the enemy fighter or an enemy
  monster. A *guard* monster must be targeted while it's on the field. A hit whose target is
  gone when it lands goes to a guard, else the fighter.

## Card Design doc additions (implemented)

From the team's "Card Design" doc; see `src/model/engine.ts` for the exact rules.

- **AP and multi-card turns** (Hearthstone-style): a turn is any number of cards, in the order
  picked, plus optionally the ultimate. Max AP is 2 in round 1 and grows by 1 per round up to
  10; AP refills to the max each turn and unspent AP is lost. "Gain AP" effects (Dark Pact,
  Mana Tap, Tinker, Soul Siphon) add AP at once, so they pay for cards picked after them. The
  whole turn has to stay payable in pick order (AP, HP above 0, ultimate meter, field slots) —
  `checkPlan` in `engine.ts`, re-run by the server. Some cards also cost HP or ultimate meter
  (Black Mage). The hand refills to 6 cards every round.
- **Card selection** (doc "Card Position"): hand fanned at the bottom center; hover expands a
  card; click shows it in the middle at ≤⅓ screen height with space above and below; clicking
  it again plays it onto your arena slot (only your client sees it until the turn ends),
  clicking anywhere else cancels. Picked cards can be clicked to take them back.
- **UA charge**: cards can add extra ultimate meter when played (Master Craftsman).
- **Priority and dice**: every attack card and ultimate of both sides goes in one queue by
  priority (fast cards first, Slow lowers it). Where the two sides tie on priority, each side
  rolls one die for the round and the higher roll goes first on every tie; a side's own
  strikes keep their pick order. A fighter knocked out mid-queue gets none of their remaining
  strikes, and a landed "interrupts" card cancels the opponent's next attack card — the doc's
  "some players' turns can be blocked".
- **Elements and statuses**: fire / water / electric affinity; Burn, Poison (stacks), Wet
  (electric +50%, fire −50% and dries), Acid (−DEF/ER), Slow, Blind (half damage). Water puts
  out Burn; Burn can't catch on a Wet target.
- **General cards** in every deck; **classes**: Guardian, Pyromancer, Black Mage, Master
  Craftsman, Necromancer.
- **ATK stat**: flat bonus to attack cards (weapons, Craftsman's ultimate).

Not done yet from that doc:

- QTE / clash when both players fire their ultimate in the same round.
- Best Friend class (one special monster + evolution card), and the other Summoner / Mage /
  Black Mage sub-classes (Warlock, Vampire, Entomologist, Zoologist, Botanist, Mycologist,
  Plague Doctor).

## Architecture implications

The game is a single static-HTML page with no server: one browser tab runs both the
player and a scripted CPU, and all state (both hands, both HP bars) is visible in the
same page object. That turned out to be enough for **simultaneous resolution against a
CPU**: the CPU's code simply never reads the player's pending action before choosing
its own (see `chooseCpuAction` in `src/model/engine.js`), so "neither side sees the
other's move first" holds even though both live in the same JS object — there was
never a real information-hiding problem, just an AI that had to not peek.

**Fog of war, and simultaneous resolution against a human PvP opponent, are different
because a human can inspect page state a scripted CPU won't:** a real second player
sitting at their own browser tab absolutely would read `battle.player.hand` or
`battle.cpu.activeDefends` out of the page if the whole game state lived in one place
they both loaded. Those two need a source of truth outside a single browser tab that
actually withholds each player's hand/pending action from the other's client until
resolution — a server, or something like a shared session both clients poll/connect
to — before PvP or fog of war can be built.

**PvP now does this with Supabase** (see "Online PvP" in README.md): the full battle,
both hands, and both pending moves live in a table only the `game` Edge Function can
read; each browser can read only the public match state plus its own hand. Fog of war
would build on the same split.

## Open questions to resolve before implementation

- Can a class have more than one synergy active at once?
- Is crit in scope for v1 of this system?
- What counts as "troops" for fog-of-war placement, and how is placement resolved
  when hidden from the opponent?
- Ultimate name/theme.
