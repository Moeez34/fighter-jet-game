# STAR LANCER

A retro 1980s arcade space shooter built with plain HTML, CSS, and vanilla JavaScript. No frameworks and no build step.

## Run

Open `index.html` in a modern browser. You can also serve the folder locally:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

On load, the game shows a retro boot loader. Progress follows the bundled 37-second entrance track, so the bar fills in real time and the game is flagged ready only once the track ends. Press any key or click once to reveal the title screen; press Enter (or tap) again to start the run.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | Arrow keys / WASD | Drag |
| Fire | Hold Space | Auto-fire |
| Pause | P | Tap |
| Start / Restart | Enter | Tap |
| Mute sound | M | - |

## Features

- Full-viewport canvas: fixed 720px logical height with width derived from the screen aspect ratio, so the game fills the whole display without letterboxing or stretching
- Retro boot screen with a segmented neon progress bar driven by the real audio clock
- 37-second entrance track (`assets/entrance.mp3`) plays while the boot bar fills
- Three-layer parallax starfield and CRT scanline overlay
- Three enemy types, power-ups, particle explosions, and persistent high score
- Fixed 60 Hz simulation, cached sprite bloom, pooled bullets/enemies, and pre-rendered star tiles
- UI scaling that follows the 480px design width while respecting safe-area insets
- Offline embedded arcade pixel font
- Web Audio chiptune sound effects after the first input

## Entrance music

The boot loader plays `assets/entrance.mp3` while the bar fills. It is a 37-second cut and gates the loader: 100% is only reached once the track (or its silent 37-second timer fallback) is finished. There is no background music during the game itself. Its settings live in `CONFIG.ENTRANCE`:

- `SRC` — path to the entrance track
- `DURATION` — seconds the loader must wait (37)
- `VOLUME` — entrance volume 0–100

Browsers block autoplay until the page has been interacted with. If the track cannot start, the loader shows `PRESS ANY KEY OR CLICK TO BEGIN`; that first gesture starts the entrance and the bar continues from there. If the file is missing, the loader still waits 37 seconds silently so the boot sequence never gets stuck.

The bundled entrance clip is copyrighted film audio intended for personal use; replace it before publishing.

## Tweaking difficulty

All tunables live in the `CONFIG` object at the top of `game.js`:

- `player.speed`, `player.lives`, `player.invincibleTime`
- `enemies.*.hp`, `enemies.*.speed`, `enemies.*.score`
- `spawn.baseInterval`, `spawn.minInterval`, `spawn.heavyBaseChance`
- `level.scoreStep`, `level.maxLevel`, `level.speedStep`
- `powerup.dropChance`, `powerup.duration`

## Font license

The embedded subset of Press Start 2P is licensed under the SIL Open Font License 1.1. See `LICENSE-PRESS-START-2P.txt`.
