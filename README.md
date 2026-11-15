# STAR LANCER

A retro 1980s arcade space shooter built with plain HTML, CSS, and vanilla JavaScript. No frameworks and no build step.

## Run

Background music uses the official YouTube IFrame player, so the game must be served over HTTP. Opening `index.html` directly via `file://` shows a warning and falls back to a local track if one exists.

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

On load, the game shows a retro audio-loader. Progress follows real YouTube player milestones (with a 10-second timeout) and the bundled 37-second Star Wars-style entrance track. The bar cannot reach 100% before both finish, so the entrance plays for its full 37 seconds before the game is ready. Press any key or click once to unlock audio and reveal the title screen; press Enter (or tap) again to start the run.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | Arrow keys / WASD | Drag |
| Fire | Hold Space | Auto-fire |
| Pause | P (also pauses music) | Tap |
| Start / Restart | Enter | Tap |
| Mute sound + music | M | - |

## Features

- Full-viewport canvas: fixed 720px logical height with width derived from the screen aspect ratio, so the game fills the whole display without letterboxing or stretching
- Retro boot screen with a segmented neon progress bar driven by real audio-loading milestones
- 37-second entrance track (`assets/entrance.mp3`) plays while the boot bar fills
- Looping background music: the first 14 seconds of a YouTube video, with a local `assets/music.mp3` fallback
- Three-layer parallax starfield and CRT scanline overlay
- Three enemy types, power-ups, particle explosions, and persistent high score
- Fixed 60 Hz simulation, cached sprite bloom, pooled bullets/enemies, and pre-rendered star tiles
- UI scaling that follows the 480px design width while respecting safe-area insets
- Offline embedded arcade pixel font
- Web Audio chiptune sound effects after the first input

## Music

### Entrance track

The boot loader plays `assets/entrance.mp3` while the bar fills. It is a 37-second cut and gates the loader: 100% is only reached once the track (or its silent 37-second timer fallback) is finished. Its settings live in `CONFIG.ENTRANCE`:

- `SRC` — path to the entrance track
- `DURATION` — seconds the loader must wait (37)
- `VOLUME` — entrance volume 0–100

Browsers block autoplay until the page has been interacted with. If the track cannot start, the loader shows `PRESS ANY KEY OR CLICK TO BEGIN`; that first gesture starts the entrance and the bar continues from there. If the file is missing, the loader still waits 37 seconds silently so the boot sequence never gets stuck.

The bundled entrance clip is copyrighted film audio intended for personal use; replace it before publishing.

### Background loop

All background music settings live in `CONFIG.MUSIC` at the top of `game.js`:

- `VIDEO_ID` — YouTube video used for the embed
- `START` / `END` — loop bounds in seconds (default `0` to `14`)
- `VOLUME_TITLE` / `VOLUME_PLAY` — player volume during menus / gameplay

Audio is embedded via the official YouTube player. Copyrighted music is fine for personal use; replace it before publishing.

If the embed is blocked (offline, `file://`, an embed error, or the 10-second timeout), the game tries `assets/music.mp3` with the same start/end loop. If that file is missing, the game runs silently and shows `MUSIC UNAVAILABLE` on the title screen.

## Tweaking difficulty

All tunables live in the `CONFIG` object at the top of `game.js`:

- `player.speed`, `player.lives`, `player.invincibleTime`
- `enemies.*.hp`, `enemies.*.speed`, `enemies.*.score`
- `spawn.baseInterval`, `spawn.minInterval`, `spawn.heavyBaseChance`
- `level.scoreStep`, `level.maxLevel`, `level.speedStep`
- `powerup.dropChance`, `powerup.duration`

## Font license

The embedded subset of Press Start 2P is licensed under the SIL Open Font License 1.1. See `LICENSE-PRESS-START-2P.txt`.
