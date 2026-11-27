---
name: hunt-art
description: Draw a region's art in the Hunt house style — the eight local animals (flat SVG avatars rendered into glossy vinyl toys), the region's screen colour, the local sign and the skyline, the toy land for the map, and goods or stickers. Use when a region pack has no `art/`, when someone asks for a new country's animals, colours or look, for a new animal, for a goods toy in the orders shop, or asks to make something "in Hunt style".
---

# Region art in the Hunt style

A region looks like Hunt when three things are true: **one solid bright colour** fills the screen, **glossy toy animals of that place** stand on it as the people, and **one or two things everybody there recognises** are drawn as plain shapes. Nothing else is needed. No photos of other people, no generated images, no logos, no gradients.

Read `references/style.md` before drawing. Look at `examples/regions.webp` (what good looks like) and at the SVGs in `examples/` (a front head, a profile, a bust, a body, a sign, a skyline).

Files you make, inside `regions/<country>/art/`:

```
theme.yaml               screen colour + accent for maps
avatars/index.yaml       8 animals: slug, name {en, ru}, bg_light, bg_dark
avatars/<slug>.svg       flat animal, 96 × 96, 8–20 shapes
toys/<slug>[-full]-192|384.webp   made by `art.py toys`, never by hand
motif-mark.svg           the local sign, 64 × 64, one colour
motif-scene.svg          the skyline, 360 × 160, one colour with opacity
island-<city>.webp/.json the 3D city map, made by `citymap.py` (settings: art/citymap.yaml); `art.py island` is the old flat one
```

Tool (`${CLAUDE_PLUGIN_ROOT}/skills/hunt-art` = this skill's folder; in Codex, where that variable is not set, use the folder of this SKILL.md): `uv run --script ${CLAUDE_PLUGIN_ROOT}/skills/hunt-art/scripts/art.py <check|toys|zoom|island|sheet|toy> …` (its header has the arguments). Nothing is uploaded; the first `toys` run fetches three.js once. No headless Chromium → ask the user before installing it.

Work on the folder the hunter gave you. An installed pack lives in `~/.config/hunt/packs/regions/<country>` and `packs_update` replaces it, so draw in a checkout of the data repository (`git clone` of hunt-data, with the hunter's OK) or in a new folder `regions/<country>/` anywhere else.

## Steps

1. **Choose.** Eight animals people of that place would name themselves: loved, wild or street, different silhouettes (one tall, one round, one with wings, one from the water, one small and funny…). Check each one really lives there (a page about the local fauna; keep the Latin name). No two that read the same at 24 px. Better not one that is already taken: Bali gecko, macaque, sea turtle, manta, kingfisher, myna, civet, frog; Kazakhstan snow leopard, golden eagle, horse, saiga, camel, marmot, corsac, hedgehog; Thailand elephant, gibbon, hornbill, Siamese cat, buffalo, dolphin, tokay, fishing cat. The generic set (owl, fox, bear, raccoon, otter, penguin, panda, rabbit, koala, hedgehog, whale, parrot) may be repeated only when the place is really known for it. Skip animals that are sacred in a way that makes a toy rude, symbols of parties or armies, and anything that is only a national emblem.
   One sign (a flower, an ornament, a hat) and one skyline (a mountain line plus one building). Say the list to the hunter in two lines; go on unless they object; nobody to ask: go on and list the choice in the report.
2. **Colour.** Take it from the place in daylight: sun on a wall, water, a market. Bright, light, one hue. Write `theme.yaml`, run `check` until the colour passes.
3. **Draw the animals** one by one by the rules. Render often: `toys PACK slug …` (read its `look:` lines), then `zoom`, **open the PNG and look**. The flat drawing is the source, the toy is the result: a drawing that is nice flat and ugly as a toy is wrong.
4. **Draw the sign and the skyline.**
5. **Land.** If the pack has `districts.geojson`: `uv run --script ${CLAUDE_PLUGIN_ROOT}/skills/hunt-art/scripts/citymap.py all PACK <city>` (one per city). It downloads OpenStreetMap streets, buildings, water, parks and the Kontur population (public, read-only, 10–20 min a city), cuts the pack's areas into blocks by the real streets, raises them by their buildings and renders the toy land in 3D without words: the app draws the district signs, river names and prices through the affine map in the JSON. Per city in `art/citymap.yaml`: `country` (Kontur id), `join` (close gaps between areas), `extend` (boxes where populated land joins, e.g. a river bank), short `names` / `names_en`, extra `labels`, `rivers`, `landmarks` (kinds in `scripts/citymap/houses.js`, coordinates lon, lat; only places you are sure of). Look at the picture: no crumbs, rivers cut, signs readable. Without Chromium or network: `art.py island` makes the old flat land.
6. **Check**: `check PACK` without errors. Every `look` line needs a look with your own eyes.
7. **Last look**: `sheet PACK -o …` light and night. Go through the questions at the end of `references/style.md`; fix and repeat at least once. Show the sheet to the hunter.
8. In a checkout of the hunt repository only: `node crm/scripts/copy-art.mjs` puts everything into the Mini App (it finds `hunt-data` next to `hunt`; `HUNT_REGIONS=<regions folder>` for another place). An ordinary plugin user stops at step 7: the folder is the result, they can offer it to everyone (skill `hunt-region`, "Sharing"). Publishing (deploy, pull request to hunt-data) only when the hunter says so.

## Only one thing

- **A new animal**: steps 3, 6, 7. Slugs never change later: a member keeps their animal.
- **A goods toy** (orders shop): one SVG by the same rules, `toy FILE.svg -o crm/public/goods`. The thing itself, no packaging brands, no text.
- **A sticker, an object for a screen**: the same `toy`. One hero per screen.

## Rights

Draw everything yourself from shapes. Never trace or copy a mascot, a brand, an emoji set, a stock picture or someone's drawing; never take a character. Real things (a kind of bird, a kind of house) are free, pictures of them are not.
