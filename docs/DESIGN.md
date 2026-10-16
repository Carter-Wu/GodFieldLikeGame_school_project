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

- HP, ATK, Speed; up to 3 on a side's field. Acts from the round after it's summoned.
- Attacks enemy monsters first (a *guard* monster before the others), then the enemy fighter,
  ignoring their DEF/MR/ER. A guard monster also takes the enemy's single-target attack cards.

## Card Design doc additions (implemented)

From the team's "Card Design" doc; see `src/model/engine.ts` for the exact rules.

- **AP**: every card has a cost. Start 3, +2 per round, cap 10, unspent AP carries over.
  "Rest" plays nothing for +1 extra AP. Some cards also cost HP or ultimate meter (Black Mage).
- **UA charge**: cards can add extra ultimate meter when played (Master Craftsman).
- **Priority and dice**: attacks/ultimates resolve by priority (fast cards first, Slow lowers
  it); equal priority → both roll a die. A knockout or a landed "interrupts" card cancels the
  slower attack — this is the doc's "some players' turns can be blocked".
- **Elements and statuses**: fire / water / electric affinity; Burn, Poison (stacks), Wet
  (electric +50%, fire −50% and dries), Acid (−DEF/ER), Slow, Blind (half damage). Water puts
  out Burn; Burn can't catch on a Wet target.
- **General cards** in every deck; **classes**: Guardian, Pyromancer, Black Mage, Master
  Craftsman, Necromancer.
- **ATK stat**: flat bonus to attack cards (weapons, Craftsman's ultimate).

Not done yet from that doc:

- Playing several cards per turn with your AP (still one card per round — the recap UI and the
  online protocol are built around one move per side).
- QTE / clash when both players fire their ultimate in the same round.
- Best Friend class (one special monster + evolution card), and the other Summoner / Mage /
  Black Mage sub-classes (Warlock, Vampire, Entomologist, Zoologist, Botanist, Mycologist,
  Plague Doctor).
- The new hand layout (card moves to the center at ⅓ screen, confirm by clicking again).

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
