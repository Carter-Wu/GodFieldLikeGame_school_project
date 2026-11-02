# Card art prompts

Prompts for generating card artwork with an external image model
(Midjourney, DALL·E / GPT Image, Stable Diffusion, etc.). Covers every card in
`src/model/catalogData.ts` (55 cards). The output replaces the SVG emblems from
`scripts/card-art.ts`, so it keeps the same frame: **4:3 landscape, 480×360 or
larger** (e.g. 1440×1080), uploaded to the `card-images` bucket and pointed at by
`cards.image_url`.

## How to use

Paste the **base style prompt** first, then one card line after it. Keep the
base prompt identical for every card so the set looks like one game. Guardian
cards use their own style prompt instead (see the Guardian section).

### Base style prompt

```
Fantasy card game illustration, 4:3 landscape, single centered subject,
bold readable silhouette that still reads at thumbnail size, painterly
digital art with clean dark outlines, dramatic rim lighting, soft vignette,
background is a smooth gradient in the category colors given below with
subtle magical particles, no frame, no border, no text, no letters,
no numbers, no UI, no watermark.
```

Negative prompt (for SD / models that take one):

```
text, letters, words, numbers, logo, watermark, signature, card frame,
border, UI, multiple panels, cropped subject, blurry, photo, realistic photo
```

Midjourney suffix: `--ar 4:3 --style raw --no text,letters,frame,border`

### Category colors

Matches `PALETTE` in `scripts/card-art.ts` / `COLORS.card` in `theme.ts`.
Add the line for the card's category after the card line.

| Category | Add to prompt |
|---|---|
| attack | `color palette: deep crimson #2a0b09 to red #b5423a, glowing peach highlights #ffb199` |
| defend | `color palette: deep navy #081a25 to steel blue #2f6f8f, icy cyan highlights #a8e1ff` |
| buff | `color palette: deep forest #08200f to emerald #3a8f5a, mint glow #b6ffcf` |
| debuff | `color palette: deep indigo #150b24 to violet #6a4a94, lavender glow #e0c2ff` |
| monster | `color palette: dark umber #1f1606 to bronze #8a6a2a, warm gold glow #ffe0a0` |

---

## Cards

### General (in every starter deck)

| id | Category | Card prompt |
|---|---|---|
| quick_jab | attack | A gauntleted fist snapping forward in a fast jab, motion streaks, small impact flash |
| splash | attack | A burst of magical water splashing outward from a palm, droplets and ripples, water element |
| spark | attack | A crackling electric spark leaping between two fingertips, small lightning arcs |
| healing_potion | buff | A round glass potion bottle with glowing red-pink liquid and a cork, soft healing sparkles rising |
| meditate | buff | A calm cloaked figure meditating cross-legged, a soft aura of energy swirling around them |
| smoke_bomb | debuff | A small black bomb bursting into a thick cloud of grey smoke that obscures vision |

### Guardian

Guardian cards use this style prompt in place of the base style prompt. Replace
`[SUBJECT / ACTION DESCRIPTION]` with the card's line below, then add the
category color line.

```
[SUBJECT / ACTION DESCRIPTION], high-fantasy digital painting, trading card
game key art, dark fantasy aesthetic. Detailed steel plate armor with intricate
metallic textures and subtle worn engravings, dramatic volumetric rim lighting,
deep atmospheric shadows, cinematic chiaroscuro, subtle glowing magical embers
and particles floating in the air, rich dark color palette with vivid accent
highlights, highly detailed fantasy illustration, 8k resolution.
```

This prompt has no "no text / no frame" wording, so use the negative prompt or
Midjourney suffix above to keep letters and borders out of the image.

| id | Category | Card prompt |
|---|---|---|
| shield_bash | attack | A heavy steel kite shield slamming forward with a starburst impact flash, speed lines behind it |
| heavy_slam | attack | A massive war hammer crashing into the ground, cracks and debris flying, shockwave |
| shield_rush | attack | An armored knight charging shoulder-first behind a raised shield, dust kicked up, fast forward momentum |
| iron_wall | defend | A towering wall of riveted iron plates and stone bricks, solid and unbreakable |
| brace | defend | An armored warrior crouched low, bracing behind a planted shield, feet dug into the ground |
| barrier_field | defend | A translucent glowing hexagonal magic dome deflecting incoming spells |
| second_wind | buff | A tired warrior standing back up as a fresh gust of wind and light swirls around them |
| iron_skin | buff | A forearm whose skin is turning into polished metal, metallic sheen spreading |
| purify | buff | A hand releasing a cleansing white-gold light that dissolves dark wisps |
| taunt | debuff | A defiant armored warrior beckoning the enemy with one hand, red angry glow aimed at them |
| stone_sentinel | monster | A hulking stone golem guardian with a glowing rune core, standing protectively with a stone shield |

### Pyromancer

| id | Category | Card prompt |
|---|---|---|
| ember_dart | attack | A small sharp dart of glowing ember fire streaking through the air, fire element |
| fire_lance | attack | A long spear made of concentrated flame thrusting forward, fire element |
| fireball | attack | A roaring fireball hurtling forward, trailing flames and burning embers |
| flare | attack | A sudden blinding flash of fire bursting outward, interrupting, quick and bright |
| inferno | attack | A wide sea of flames engulfing the whole battlefield, towering fire columns |
| heat_shroud | defend | A shimmering cloak of heat haze and flame wrapping around a figure as protection |
| stoke_the_flame | buff | Hands fanning a small fire in a brazier into a bigger roaring blaze |
| scorch | debuff | Scorched, blackened ground with smoldering cinders and a weakened, drained aura |
| ignite | debuff | A target catching fire, flames licking up from below, lingering burn |
| flame_imp | monster | A small mischievous imp made of living fire with a wicked grin and ember wings |

### Black Mage

| id | Category | Card prompt |
|---|---|---|
| shadow_bolt | attack | A bolt of dark purple-black shadow magic shooting forward, crackling darkness |
| vampiric_touch | attack | A pale clawed hand draining a red stream of life energy from a target |
| eldritch_blast | attack | A huge beam of eldritch otherworldly energy erupting from a cracked arcane sigil, caster's blood droplets feeding it |
| hex_ward | defend | A ring of glowing occult hex runes forming a protective circle |
| dark_pact | buff | A shadowy contract scroll sealed with a drop of blood, dark energy rising from it |
| mana_tap | buff | A glowing blue mana crystal being tapped, energy flowing out into an open hand |
| curse_of_weakness | debuff | A drooping, chained figure as a purple curse sigil saps their strength |
| acid_rain | debuff | Corrosive green-purple acid raining from a dark cloud, sizzling on the ground |
| soul_siphon | debuff | A ghostly wisp of soul energy being pulled out of a target toward a dark orb |
| nightmare | debuff | A shadowy nightmare creature looming over a sleeping figure, eyes glowing, distorted dreamlike haze |

### Master Craftsman

| id | Category | Card prompt |
|---|---|---|
| forge_hammer | attack | A blacksmith's forge hammer swinging down, glowing hot sparks flying from impact |
| rivet_gun | attack | A brass steampunk rivet gun firing a hot rivet, quick muzzle flash |
| riveted_plate | defend | A thick armor plate studded with rows of rivets, bolted together, sturdy |
| spring_trap | defend | A mechanical spring-loaded trap snapping shut, gears and coiled spring visible |
| whetstone | buff | A sword blade being sharpened on a whetstone, bright sparks along the edge |
| masterwork_blade | buff | A flawless ornate sword resting on an anvil, gleaming with a radiant shine |
| tinker | buff | Gloved hands adjusting tiny gears in an open clockwork mechanism, small tools around it |
| caltrops | debuff | Spiky iron caltrops scattered across the ground, slowing the path forward |
| clockwork_golem | monster | A large brass clockwork golem with exposed gears, steam vents and glowing eyes |

### Necromancer

| id | Category | Card prompt |
|---|---|---|
| bone_spear | attack | A sharp spear made of fused bones hurled forward |
| death_coil | attack | A spiraling coil of sickly green death energy, draining life back to the caster |
| bone_shield | defend | A shield made of interlocked ribs and skulls, held up defensively |
| dark_ritual | buff | A glowing necromantic summoning circle on the ground with skeletal hands rising from it |
| plague_cloud | debuff | A thick toxic green plague cloud with floating spores, poison |
| wither | debuff | A plant and a hand withering and decaying, grey rot spreading, slowed time |
| soul_harvest | debuff | A spectral scythe reaping glowing souls into a dark lantern |
| raise_skeleton | monster | A skeleton warrior clawing up out of a grave, rusty sword in hand, glowing eye sockets |
| shambling_zombie | monster | A shambling rotting zombie with outstretched arms, green poison drip |
| grave_guard | monster | An armored undead knight standing guard in front of a tombstone with a tower shield |

---

## After generating

1. Save each image as `<card id>.png` (or `.webp`), 4:3.
2. Upload to the `card-images` Storage bucket and set `cards.image_url` to its
   public URL. `src/cardArt.ts` already loads non-SVG images with
   `scene.load.image`, so no code change is needed.
3. Check the image at thumbnail size in the Gallery and battle hand — the
   subject should still read when small.
