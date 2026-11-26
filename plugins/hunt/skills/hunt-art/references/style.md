# House style: numbers and reasons

## Colour (`theme.yaml`)

```yaml
screen: "#E8E35C"                                  # the one solid colour of the main screens, light theme
accent: {light: "#0B7A76", dark: "#2CC4BC"}        # maps only
detail: {light: "#C7951A", dark: "#E8B83A"}        # optional, small highlights on the map
```

- `screen` is light and saturated: black text `#151413` on it ≥ 9:1, secondary `#46433D` ≥ 4.5:1. Existing: Bali sun-lime `#E8E35C`, Kazakhstan sky `#9ED0F2`, Thailand orange `#FFB65C`. Taken by sections: mint `#8EE3C8` (money), coral `#FF8A5B` (what's on), lilac `#A98CFF` (orders), warm grey `#E6E4DF` (calm screens). Also taken: pink `#FF8FB1` (Thailand's daytime Афиша). Stay away from all of them; free hues are greens (grass, pistachio), rose, turquoise, peach, sky-violet. Countries after that share hues: then differ clearly in lightness.
- Not pastel, not neon, not beige, not two colours. At night every region is `#151413`; the region stays in the toys and in the sticker.
- `accent` has the same hue as `screen` or is the place's second colour, never red (red means risk). It is for rings and the chosen district on a map: ≥ 4.5:1 on paper (light) and on night (dark). Buttons, figures and focus are ink, never the accent.

## Animals

**Character.** A vinyl toy from a good shop: chunky, calm, friendly, a little funny. It looks at you. Not a cartoon with a grin, not a realistic animal, not an emoji.

**Canvas.** `viewBox="0 0 96 96"`, the animal sits inside the circle r 44 around (48, 48) and fills it: 70–88 units in its longer side. It is cut by a circle at 24–32 px, so nothing important in the corners.

**Pose.** Either a head (front, or three quarters) or a whole simple body. Choose the one that gives the clearest silhouette: a bear is a head, a gecko and a manta are bodies. Bust birds: round head + a body block that ends flat at y ≈ 84–86.

**Shapes.** Usually 8–20 drawn elements, eyes included (toes of a gecko may go up to 32) (`path circle ellipse rect polygon line polyline`, `g` only for a mirror or rotation). Curves with few points. Solid hex fills; 4–8 colours with the eyes. No gradients, filters, masks, clip paths, text, images, `style`, `currentColor`. A stroke is a tube: 4–8 units for limbs and tails, 1.6–2.4 for a smile or a wrinkle, always `stroke-linecap="round"`.

**Order is depth.** The renderer inflates shapes one after another, back to front:
- **body or plate.** Less than 60 % of a shape lies on everything drawn before it → a thick rounded body (ears, head, horns, a tail tube). 60 % or more → a raised plate one unit high (a muzzle, a belly, a mask); a plate up to 8.4 units wide → a bead. A big shape at 60–98 % is a torn flat plate, the most common failure: keep bodies' overlap under 40 %, plates 1.5 units inside the silhouette. `toys` prints the result for every shape;
- **behind first**: tail → back legs → ears, horns, hair → body → head. Anything that crosses the edge of the head goes before the head and peeks out; after it only what lies fully inside. A later body presses the earlier one down along the overlap, so a floppy ear drawn over the head makes a ribbed cliff. A muzzle that sticks out is wider than the head where they meet, or the head's corners show;
- **melting**: shapes melt into one piece when they follow each other in the file, have the same colour and overlap. Wool, curls and scallops = a run of overlapping circles of one colour. Nothing of another colour between them;
- **one surface**: an eye, a nose or a spot lies fully on a patch or at least a unit away from it, never across two;
- thin slivers (under 2 units) and needles look broken. A crest or a fan = one filled fan and a run of circles on its edge (tubes side by side read as fingers). A beard or a horn is one tapered filled shape, 10 units at the base.

**The turn.** The still is turned 30° to the viewer's left and seen a little from above: the left third is foreshortened. A one-eyed profile faces **right**. Front faces: both eyes at least 10 units inside the head's outline at their height (about a quarter of the head's width from its centre), or the far eye falls behind the rim with its white dot in the air.

**Light.** Colours come out about a step lighter and warmer (`#CF6240` → salmon): draw mid-tones darker than you want and judge the toy, not the hex.

**Eyes** decide everything: `<circle r="2.8…4.5" fill="#1F2623"/>` plus a white `<circle r="0.36 × r"/>` up and to the right of the centre (`+0.35r, −0.38r`). The pair becomes a glossy bead with a catch-light, 1.2× bigger. At or below the middle of the head: low eyes read as young and kind. The white circle is at most r 1.8 (a bigger one stays as a blob), the pair is not inside a transformed group. Two eyes at the front, one in profile. Coloured iris = a bigger circle under the bead. Slit or almond eyes only where the animal needs them (cats, tokay); then no bead.

**Face.** Nose, mouth and cheeks are small. A smile is one thin stroke, barely curved. No teeth, no tongue, no eyebrows unless the animal has them.

**Colour.** True to the animal, a step cleaner and brighter. One clear main colour, one light belly or muzzle, one dark. Big white areas need a coloured mark or a darker wing, or the toy disappears on a light screen. The main colour must stand out on the region's `screen` and on night; if it doesn't, choose another animal.

**Discs.** `bg_light`: the animal's own hue, very pale (luminance ≥ 0.55). `bg_dark`: the same hue, deep (luminance ≤ 0.08). A white or cream animal takes the hue of its face or horns, luminance 0.55–0.7, or it drowns in the disc. Eight discs in a row should not all be the same colour. The app shows the flat drawing below 32 px and the toy from 32 px up: the flat one must read as a blot, the toy must be beautiful.

**Names.** Short, the way people call it, `en` and `ru`. Slug: `snow_leopard`.

## The sign (`motif-mark.svg`, 64 × 64)

One thing from local craft, plants or everyday life: a frangipani flower, a shanyrak, a fan. Reads at 24 px as a blot of one colour. Root `fill="currentColor"`; parts are separated by gaps of 2–2.5 units (a mask with black strokes), not by a second colour. Inside a mask plain `#000` / `#fff` / `#666` are fine. Ids start with the region: `bali-mark-m`. Not a flag, coat of arms, religious symbol or a company's sign.

## The skyline (`motif-scene.svg`, 360 × 160)

It stands at the bottom of empty states. Three or four layers of `currentColor`, far to near with opacity about .16 → .42 → .22 ground → 1 for the one building. Left two thirds: nature (mountain line, palms, sea, steppe). Right third: one building everyone knows, simple and generic (a split gate, a yurt, a stilt house), drawn in 5–10 shapes. Layers overlap, so the ground (.22) adds to the hills and comes out darker. Windows are holes: one path with `fill-rule="evenodd"`. Ground reaches the bottom edge; the top 25 % stays almost empty (a sun or a bird). No people, no text.

## The land (`island.webp`)

Made by the tool: a thick piece of the region's colour with a darker side and soft grooves between areas, on transparency. On screen the sea is sky `#9ED0F2` (or deep blue when the region itself is sky). Put area names from `districts.yaml` on it with `island.json` (pixel centres and the projection). Pick neighbouring areas only.

## Goods

Same shapes, same order, no eyes. The thing from the side or three quarters, one recognisable detail (the leaf on an orange, the cap on a bottle). No labels, brands or words.

## Before you say it is done

Look at the sheet (once with `--no-names`) and at `zoom`, light and night, and answer honestly:

1. Cover the names: do you recognise all eight at 24 px? Which two could be mixed up?
2. Does every toy look at you, and is every one kind? Any with a broken eye, a dent, a spike, a seam through the face, a floating piece?
3. Do they look like one series next to `examples/regions.webp`: the same chunkiness, the same eye size, the same amount of detail?
4. Squint at the screen colour with the toys on it: does any toy drown?
5. Would someone from there smile at the choice, or is it a tourist poster?
6. Is there anything you copied?
