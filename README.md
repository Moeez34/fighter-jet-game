# STAR LANCER

A retro 1980s arcade space shooter built with plain HTML, CSS, and vanilla JavaScript. No frameworks, no build step, no external runtime assets.

## Play

Open `index.html` in a modern browser.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | Arrow keys / WASD | Drag |
| Fire | Hold Space | Auto-fire |
| Pause | P | Tap |
| Start / Restart | Enter | Tap |
| Mute | M | - |

## Features

- 480 × 720 portrait canvas with pixel-art sprites and nearest-neighbor rendering
- Three-layer parallax starfield and CRT scanline overlay
- Three enemy types, power-ups, particle explosions, and persistent high score
- Fixed 60 Hz simulation, cached sprite bloom, pooled bullets/enemies, and pre-rendered star tiles
- Offline embedded arcade pixel font
- Web Audio chiptune sound effects after the first input

## Tweaking difficulty

All tunables live in the `CONFIG` object at the top of `game.js`:

- `player.speed`, `player.lives`, `player.invincibleTime`
- `enemies.*.hp`, `enemies.*.speed`, `enemies.*.score`
- `spawn.baseInterval`, `spawn.minInterval`, `spawn.heavyBaseChance`
- `level.scoreStep`, `level.maxLevel`, `level.speedStep`
- `powerup.dropChance`, `powerup.duration`

## Font license

The embedded subset of Press Start 2P is licensed under the SIL Open Font License 1.1. See `LICENSE-PRESS-START-2P.txt`.
