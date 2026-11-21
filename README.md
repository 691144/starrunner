# STARRUNNER: Deep-Trench Interceptor

A high-speed trench-runner PWA. Fly the *Ember* interceptor down a winding canyon at
ever-increasing speed. The challenge is the course itself: there are no obstacles,
only the canyon, which bends, climbs, dives and closes in. Built with Three.js
(vendored, so it works fully offline). No build step.

## Run locally
```powershell
python -m http.server 5173
```
Open http://localhost:5173. (A service worker needs `http://localhost` or HTTPS.)

## Deploy
Static hosting (this repo is served by GitHub Pages). After changing files, bump `VERSION` in `sw.js` so installed copies update.

## How difficulty works
Difficulty is one continuous value `d` that rises along the run (+1 per sector), driving:

- **Speed**: 90 + 15·d units/s, always accelerating (capped at 250).
- **Bend sharpness**: the steepest bend demands a growing share of the ship's turn rate, and tighter, shorter-wavelength bends fade in.
- **Narrowing**: the canyon walls close in and the rim (ceiling) drops, so the margin for error shrinks.

Scraping the walls, floor or rim drains shield and breaks your multiplier. Rings mark a racing line
(×8 multiplier, PERFECT in the centre); cyan rings restore shield, and each sector gate gives a bonus.
Cadet / Pilot / Ace scale speed, damage, bend demand and narrowing.

## Controls
- **Mouse**: flight stick; move toward a side of the screen to turn that way
- **Keyboard**: WASD / arrows, P / Esc to pause
- **Touch**: drag anywhere (floating stick)
- **Gamepad**: left stick / D-pad, Start to pause

## Files
- `js/course.js`: the course function, baked lookup texture, and the vertex-shader bend
- `js/game.js`: flight model, contact, rings, gates, scoring, camera
- `js/trench.js`: procedural greebled trench chunks (bent by the shader)
- `js/fx.js`: particles and the post pass
- `js/ship.js`: the original Ember interceptor model
- `js/audio.js`: synthesized SFX and the sequencer soundtrack
- `js/input.js`: keyboard, mouse, touch and gamepad
- `sw.js`, `manifest.webmanifest`, `icons/`: PWA
