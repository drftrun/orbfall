# Build log

One line per `npm run check` / `npm run look`, and every time the PNGs were opened.

- 14:30:48 started; read AGENTS.md, the driftengine skill and its references, the first-game example and manual page, and the installed `.d.ts` files.
- 14:33:22 `npm run check` on the untouched starter (baseline) — pass: typecheck ok, no tests, look drew webgpu and webgl2 on the RX 9070 XT (ANGLE/Vulkan).
- 14:35:39 `npx vitest run` after writing `run.drs` (clock, crystals, falls, best, boulder difficulty) and `run.test.ts` — 7 tests pass.
- 14:38:43 `npm run check` after writing the whole game in `src/main.ts` (island, orb, boulders, crystals, input, sound, HUD) and adding `@driftengine/audio` — pass (typecheck, 7 tests, look ok on webgpu and webgl2).
- 14:39 opened both PNGs: the island, the orb, two boulders, five crystals and the HUD are there on both backends, but the grass reads as mud, the turf discs carry jagged shadow artefacts, two distant islands hang above the horizon (one behind the HUD), and a dark wedge cuts across the island's lower-right edge.
- 14:40:09 `npm run check` after a higher, brighter sun, greener grass, tufts and flowers instead of turf discs, lower distant islands, less emissive on orb and crystals — pass. Opened both PNGs: green island at dusk, glowing pink crystals, cyan orb; the wedge is still there on both backends.
- 14:40:45 `npm run look` with the shadow box widened from 17 to 24 m — pass; opened webgpu.png: the wedge did not move, so it is not the shadow map's edge.
- 14:41:11 `npm run look` with the rock underside's tube path made straight — pass; opened webgl2.png and webgpu.png: the wedge is gone. It was the tube's widest ring, tilted by the leaning path, poking up through the grass.
- 14:41:38 scratch play-through (`.driftengine/playtest.mjs`, not committed: holds WASD over CDP for 64 s on WebGPU, then presses Space). Opened its shots: score 2 at 50 s, boulders dropping onto the rim and rolling at the orb, the orb knocked off the edge (score back to 0 by 29 s), the clock turning red under ten, the "NEW BEST 1" screen at zero, and Space starting a new run with BEST 1 kept. No console errors or warnings.
- 14:43:26 `npm run check` after documenting the controls in README.md (and the shadow-box and tube fixes above, which had only been through `look`) — pass: typecheck clean, 7 tests, look ok on both backends.
- 14:43 opened both PNGs: the island at dusk under an orange and violet sky, the hovering cyan orb in the middle, five pink crystals, two boulders on the left, distant islands, the HUD (SCORE 0, TIME 59/58, BEST 0) and the hint line. The two backends agree; the boulders sit a frame apart because the captures are a second apart.
