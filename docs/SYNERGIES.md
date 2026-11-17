# Class synergies

Every class has a **synergy**: a bonus that grows the more cards of one type you play during a
match. It's the main way a class rewards playing to its identity — the Guardian gets tougher by
defending, the Pyromancer charges its ultimate faster by attacking, and so on.

This page covers how synergies work, what each class's synergy does, how they show up in the game,
and how to change or add one. The numbers come from the bundled catalog
(`src/model/catalogData.ts`); the live game reads the same values from Supabase.

## How they work

- **One card type per synergy.** Each synergy counts one category: attack, defend, buff, debuff or
  monster. Every card of that category you play adds 1 to the count.
- **The count lasts the whole match.** It never resets or decays, so a tier, once reached, stays
  for the rest of the game (unless the synergy is disabled, see below).
- **Tiers.** Each synergy has tiers at set counts (all of them at 2 and 4 cards right now). Only the
  highest tier you've reached applies — tier 2 *replaces* tier 1, it doesn't stack on top of it.
- **It kicks in the same round.** All the cards in a turn are counted at the start of that round,
  before any damage. So if the card that reaches a tier is played this round, the bonus already
  applies to this round's attacks and blocks.
- **Cards count even if they fizzle.** An attack cancelled by an interrupt, or one aimed at a monster
  that's already gone, still counts — you played it.
- **Only cards count.** Your ultimate doesn't, and neither do monsters summoned by an effect rather
  than a monster card (Dark Ritual, the Necromancer's ultimate).
- **Bonuses are stat changes.** Every current tier raises one or two stats (DEF, MR, UR or ATK). They
  add to the class's base stats and to any buffs or debuffs, and show up in the stat row like any
  other change.

## The five synergies

| Class | Synergy | Counts | Tier 1 (2 cards) | Tier 2 (4 cards) |
| --- | --- | --- | --- | --- |
| Guardian | Bulwark | Defend cards | DEF +5 | DEF +12 |
| Pyromancer | Kindling | Attack cards | UR +2 | UR +5 |
| Black Mage | Dark Arts | Debuff cards | UR +2 | UR +4, MR +3 |
| Master Craftsman | Forge | Buff cards | ATK +1 | ATK +3 |
| Necromancer | Horde | Monster cards | DEF +2 | DEF +4, UR +2 |

UR is how much the ultimate meter fills each round, so a UR bonus means more frequent ultimates.

### Guardian — Bulwark

*Rewards playing defend cards.*

- **Tier 1 (2 defends):** DEF +5. On top of the Guardian's base DEF 6, that's 11 — most physical
  attacks barely scratch it.
- **Tier 2 (4 defends):** DEF +12, for 18 DEF in total. Physical damage is all but shut off.
- **In the starter deck:** 5 of 24 cards count — Iron Wall ×2, Brace ×2, Barrier Field ×1.
- Bulwark is slow to build: the Guardian plays defends when it needs them, not every turn. It
  pays off in long games, and does nothing against magic, element or monster damage (monsters get
  past DEF).

### Pyromancer — Kindling

*Aggression fuels ultimate charge.*

- **Tier 1 (2 attacks):** UR +2.
- **Tier 2 (4 attacks):** UR +5, which nearly doubles the Pyromancer's base UR of 6.
- **In the starter deck:** 12 of 24 cards count — Ember Dart ×2, Fire Lance ×3, Fireball ×2, Flare,
  Inferno, and the general Quick Jab, Splash and Spark.
- The easiest synergy to fill: half the deck counts, so it's usually at tier 2 by round 3 or 4,
  and the Pyromancer's ultimate (18 damage) comes around fast.

### Black Mage — Dark Arts

*Every curse feeds the Black Mage.*

- **Tier 1 (2 debuffs):** UR +2.
- **Tier 2 (4 debuffs):** UR +4 and MR +3. The MR stacks with the Black Mage's base MR 5, already the
  highest in the game, so magic attackers struggle.
- **In the starter deck:** 8 of 23 cards count — Acid Rain ×3, Nightmare ×2, Curse of Weakness,
  Soul Siphon, and the general Smoke Bomb.

### Master Craftsman — Forge

*Each tool the Craftsman readies sharpens every attack.*

- **Tier 1 (2 buffs):** ATK +1.
- **Tier 2 (4 buffs):** ATK +3. ATK is added to every attack card, so on top of the Craftsman's base
  ATK 3 and buffs like Whetstone, its attacks hit very hard.
- **In the starter deck:** only 3 of 19 cards count — Whetstone, and the general Healing Potion and
  Meditate. Tinker and Masterwork Blade are buffs too, but they were left out of the starter deck
  to fit the rarity budget. A custom deck can add them.
- Tier 2 needs a fourth buff, so with the starter deck it only happens once the discard pile is
  shuffled back in — rarely, in practice (see the numbers below).

### Necromancer — Horde

*The more the Necromancer summons, the harder they are to put down.*

- **Tier 1 (2 monsters):** DEF +2.
- **Tier 2 (4 monsters):** DEF +4 and UR +2.
- **In the starter deck:** 7 of 24 cards count — Raise Skeleton ×3, Shambling Zombie ×2,
  Grave Guard ×2.
- Monster cards are the Necromancer's favorite play, so tier 1 comes early. Only monster *cards*
  count: Dark Ritual (a buff) and the ultimate summon skeletons without adding to the count.

## How often they're reached

From 2,000 simulated CPU-vs-CPU matches per class (`npm run balance`'s match setup, starter decks,
current stats):

| Synergy | Tier 1 reached | Usually by round | Tier 2 reached | Usually by round |
| --- | --- | --- | --- | --- |
| Bulwark | 79% of games | 5.5 | 47% | 7.4 |
| Kindling | 100% | 1.9 | 86% | 3.4 |
| Dark Arts | 74% | 3.8 | 50% | 5.3 |
| Forge | 77% | 3.6 | 13% | 7.2 |
| Horde | 96% | 2.9 | 55% | 5.8 |

The CPU plays by simple rules (its favorite card types first, defends when low on HP), so a person
building toward their synergy on purpose will reach the tiers sooner. Treat these as a comparison
between synergies, not as targets.

## In the game

- **Home screen:** the class inspector has a Synergy box with the name, description, and its tiers
  as tags — `T1 · 2` and `T2 · 4` mean tier 1 at 2 cards, tier 2 at 4.
- **In a match:** each fighter's band has a synergy chip next to its statuses:
  - `Kindling 1/2` — 1 attack played, tier 1 at 2 (grey: no tier yet).
  - `Kindling T1 3/4` — tier 1 active, 3 of the 4 needed for tier 2 (gold: a tier is active).
  - `Kindling T2 max` — the top tier.
  - `Kindling off · 2t` — disabled for 2 more rounds.
- **Tutorial:** round 5 has a step on synergies, pointing at the chip on your band.

## Disabling a synergy

The engine supports a `synergy_disable` effect (`EFFECT_KIND.SYNERGY_DISABLE` in
`src/model/effects.ts`): it switches one of the target's synergies off for the card's duration, and
the chip shows `off` with the rounds left. The count keeps going while it's off; the bonus just
doesn't apply. **No card uses it yet** — it's ready for a future debuff.

## Open questions and known issues

- **Bulwark and Kindling are placeholders.** Their names still say "(example)" and their
  descriptions start with "Placeholder synergy". They need real names and flavor text.
- **Forge's tier 2 is almost out of reach.** The Craftsman's starter deck has 3 buffs and tier 2
  needs 4, so it's reached in about 13% of games. Options: lower tier 2 to 3 buffs, count Tinker
  and Masterwork Blade by fitting them into the starter deck, or accept it as a custom-deck reward.
- **Bulwark's tier 2 is very strong.** 18 DEF makes the Guardian close to immune to physical
  attacks. It's balanced today by how late it arrives (round 7 on average, in under half of games).
- **One synergy per class.** The data model allows a pool of several synergies per class
  (`class_synergies`), and `docs/DESIGN.md` asks whether more than one can be active at once.
  Every class has exactly one today.
- **Tier counts are all 2 and 4.** Fine for now, but a class whose card type is rarer in its deck
  (Guardian, Craftsman) fills its synergy much more slowly than one built around it (Pyromancer).

## Changing or adding a synergy

1. **Edit the data** in `src/model/catalogData.ts`: the `synergies` list (id, name, description,
   `counts_category`, and `tiers` as `{ count, effects }`), and `class_synergies` to give it to a
   class. Effects are built with the helpers in `src/model/effects.ts`, e.g.
   `statModifier("def", FLAT, 5)`.
2. **Update Supabase** with a new migration — `npm run catalog:sql` prints upserts for the whole
   catalog to start from. Never edit an old migration.
3. **Check balance** with `npm run balance`, which plays every class against every other and prints
   each one's win rate. Synergies change how strong a class is, so rerun it after any change and
   retune base stats if a class drifts far from 50%.
4. **Run the tests** (`npm test`). The tutorial's synergy step reads the name and card type from the
   data, so it follows along on its own.

No engine changes are needed for a new synergy that grants stat bonuses: the engine counts cards
by category and applies whichever tier is reached (`computeCurrentStats` in `src/model/engine.ts`,
`resolveSynergies` in `src/model/synergies.ts`).
