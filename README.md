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
- **Bend sharpness**: the steepest bend demands a growing share of the ship's turn rate, and tighter bends fade in.
- **Narrowing**: the canyon walls close in and the rim drops.
- **Physical hazards** (all part of the canyon, nothing floats in it):
  - **Raised floor**: the floor rises, forcing you up.
  - **Tunnels**: the canyon is roofed over; stay low, then burst back into the open.
  - **Pinch gaps**: both walls move in to a gap narrower than the ship's wings. Hold click / Space (or BANK on touch) to turn the ship sideways to fit.
  - **Shoulders**: one wall pushes inward.

Scraping the walls, floor, roof or rim drains shield and breaks your multiplier; forcing through a gap you
cannot fit drains it much faster. Clean flying builds a multiplier (up to x8) and clearing a hazard cleanly
scores and repairs shield. Cadet / Pilot / Ace scale speed, damage, bend demand and narrowing.

## Controls
- **Mouse**: flight stick; move toward a side of the screen to turn that way. Hold click to bank (turn sideways)
- **Keyboard**: WASD / arrows, hold Space or Shift to bank, P / Esc to pause
- **Touch**: drag anywhere (floating stick), hold BANK to turn sideways
- **Gamepad**: left stick / D-pad, A or triggers to bank, Start to pause

## Files
- `js/course.js`: the course function, baked lookup texture, and the vertex-shader bend
- `js/game.js`: flight model, contact, rings, gates, scoring, camera
- `js/trench.js`: procedural greebled trench chunks (bent by the shader)
- `js/fx.js`: particles and the post pass
- `js/ship.js`: the original Ember interceptor model
- `js/audio.js`: synthesized SFX and the sequencer soundtrack
- `js/input.js`: keyboard, mouse, touch and gamepad
- `sw.js`, `manifest.webmanifest`, `icons/`: PWA
