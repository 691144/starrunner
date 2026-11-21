# STARRUNNER — Deep-Trench Interceptor

A high-speed trench-runner PWA: fly the *Ember* interceptor down a greebled canyon,
thread obstacles, shoot turrets and mines, and survive escalating sectors.
Built with Three.js (vendored, so it works fully offline). No build step.

## Run locally
```powershell
python -m http.server 5173
```
Open http://localhost:5173. (A service worker needs `http://localhost` or HTTPS, so opening `index.html` as a file won't register it.)

## Deploy
Copy the folder to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages…).
Browsers will offer **Install**, or use the in-game **INSTALL APP** button.
After changing files, bump `VERSION` in `sw.js` so installed copies update.

## Difficulty
| Sector | Name | New threat |
|---|---|---|
| 1 | Outer Channel | Crossbeams |
| 2 | Bulkhead Run | Pillars, slabs |
| 3 | Gun Deck | Wall turrets (shoot back) |
| 4 | Blast Doors | Doors with openings, slots |
| 5 | Sweeper Line | Moving barriers |
| 6 | Minefield | Homing mines |
| 7+ | Deep Core | Everything, ever faster |

Each sector is faster, packs obstacles tighter, and makes turrets fire more often.
Choose **Cadet / Pilot / Ace** on the title screen to scale speed, damage and spacing.
Best scores are saved per difficulty.

## Controls
- **Mouse**: steer (ship follows cursor), click to fire
- **Keyboard**: WASD / arrows, Space to fire, P / Esc to pause
- **Touch**: drag anywhere to steer, hold FIRE (or enable auto-fire on lock)
- **Gamepad**: left stick / D-pad, A or RT to fire, Start to pause

## Files
- `js/game.js`: flight model, sectors, obstacles, collisions, scoring, camera
- `js/trench.js`: procedural greebled trench chunks
- `js/fx.js`: particles and the post pass (radial speed blur, aberration, vignette)
- `js/ship.js`: the original Ember interceptor model
- `js/audio.js`: synthesized SFX and the original sequencer soundtrack
- `js/input.js`: keyboard, mouse, touch and gamepad
- `sw.js`, `manifest.webmanifest`, `icons/`: PWA
