'use strict';

/* ==========================================================================
   STAR LANCER
   A single-file retro space shooter. Sections:
     1. CONFIG        — every tunable value lives here
     2. UTIL          — small math / DOM helpers
     3. SPRITES       — pixel maps + cached canvas renderer
     4. AUDIO         — Web Audio chiptune SFX
     5. STARFIELD     — three parallax star layers
     6. ENTITIES      — Player, Bullet, Enemy, Particle, PowerUp
     7. GAME          — state machine, spawning, collisions, rendering
     8. ENTRANCE      — 37-second boot track played behind the loader
     9. LOADER        — retro boot screen / progress UI
    10. INPUT + BOOT  — keyboard / pointer handling and startup
   ========================================================================== */

/* ==========================================================================
   1. CONFIG
   ========================================================================== */

const CONFIG = {
  // The playfield uses a fixed logical height so the world always fills the
  // viewport vertically; width is derived from the viewport aspect ratio at
  // boot and on resize (see Game.applyViewport).
  height: 720,
  width: 480,             // provisional — replaced by the real viewport width
  designWidth: 480,       // reference width for star density and spawn pacing
  step: 1 / 60,           // fixed 60 Hz simulation (arcade-authentic + cheaper)
  maxFrame: 0.25,         // clamp huge tab-switch deltas

  highScoreKey: 'starlancer.highScore.v1',
  muteKey: 'starlancer.muted.v1',

  player: {
    speed: 355,           // px / second
    fireCooldown: 0.18,   // seconds between shots while held
    lives: 3,
    invincibleTime: 2.0,
    startX: 240,
    startY: 638,
    hitboxW: 20,
    hitboxH: 24,
    topLimit: 132,        // how far up the jet may fly
    bottomMargin: 58,
    touchFollow: 26,      // pointer follow smoothing
    deathDelay: 1.25,     // pause before game-over overlay
  },

  bullet: {
    speed: 860,
    width: 4,
    height: 18,
    hitW: 6,
    hitH: 20,
    doubleOffset: 9,
    max: 80,
  },

  enemies: {
    scout: {
      hp: 1, speed: 128, score: 100,
      sprite: 'scout', hitboxW: 20, hitboxH: 16,
      sway: 0, swaySpeed: 0, glow: '#ff3d6e',
    },
    zigzag: {
      hp: 2, speed: 88, score: 200,
      sprite: 'zigzag', hitboxW: 24, hitboxH: 20,
      sway: 58, swaySpeed: 2.25, glow: '#a75bff',
    },
    heavy: {
      hp: 4, speed: 54, score: 500,
      sprite: 'heavy', hitboxW: 46, hitboxH: 42,
      sway: 8, swaySpeed: 1.15, glow: '#ff9f1c',
    },
  },

  spawn: {
    initialDelay: 0.9,
    baseInterval: 1.05,
    minInterval: 0.36,
    intervalDecay: 0.94,    // interval multiplier per level
    jitterMin: 0.8,
    jitterMax: 1.2,
    margins: { scout: 26, zigzag: 92, heavy: 54 },
    heavyStartLevel: 2,
    heavyBaseChance: 0.06,
    heavyStep: 0.05,
    heavyMaxChance: 0.34,
    zigzagBaseChance: 0.28,
    zigzagStep: 0.018,
    zigzagMaxChance: 0.50,
  },

  level: {
    scoreStep: 1500,        // points per level
    maxLevel: 20,
    speedStep: 0.085,       // enemy speed multiplier per level
    maxSpeedScale: 2.15,
  },

  powerup: {
    dropChance: 0.10,
    fallSpeed: 95,
    duration: 8,
    sway: 12,
    hitW: 26,
    hitH: 22,
  },

  particles: { max: 420 },

  starfield: {
    layers: [
      { count: 38, speed: 14, size: 1, color: '#5d7fb8', alpha: 0.50 },
      { count: 26, speed: 38, size: 1, color: '#b6d9ff', alpha: 0.72 },
      { count: 18, speed: 82, size: 2, color: '#ffffff', alpha: 0.95 },
    ],
  },

  shake: { enemy: 2.5, heavy: 6, player: 15, decay: 9 },
  flashDecay: 4.2,

  colors: {
    beam: '#5ff8ff',
    beamCore: '#ffffff',
    playerGlow: '#ffc857',
    warm: '#ffd166',
    white: '#ffffff',
  },

  // Entrance track played on the boot loader. The loader will not reach
  // READY until this 37-second piece finishes. There is no in-game music.
  ENTRANCE: {
    SRC: 'assets/entrance.mp3',
    DURATION: 37,
    VOLUME: 80,
  },
};

/* ==========================================================================
   2. UTIL
   ========================================================================== */

const TAU = Math.PI * 2;

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
const rand = (min = 0, max = 1) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const padScore = (n) => String(Math.max(0, Math.floor(n))).padStart(6, '0');
const padLevel = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** Axis-aligned overlap for {x, y, w, h} boxes (top-left origin). */
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Remove index i without preserving order (cheap, no splice). */
function swapRemove(arr, i) {
  const last = arr.length - 1;
  if (i !== last) arr[i] = arr[last];
  arr.pop();
}

/* ==========================================================================
   3. SPRITES — tiny pixel maps rendered once into offscreen canvases
   ========================================================================== */

const PIXEL_MAPS = {
  // Player fighter points up (X-wing inspired). o=outline, w=hull, g=gray shade,
  // b=yellow accent, c=cockpit, r=red stripe.
  player: {
    scale: 3,
    palette: {
      o: '#1a2233',
      w: '#f4f7fb',
      g: '#9aa8be',
      b: '#ffc857',
      c: '#fff4c9',
      r: '#ff4d5a',
    },
    rows: [
      '........o........',
      '.......owo.......',
      '.......oco.......',
      '......owcwo......',
      '......owcwo......',
      '...o..owwwo..o...',
      '..owo.owgwo.owo..',
      '.owwo.owgwo.owwo.',
      'obwwoowwwwwoowwbo',
      'obwwoowwwwwoowwbo',
      '.owroowwwwwoorwo.',
      '..owwoowgwooowwo.',
      '..ogwooowooowgo..',
      '..oowo..o..owoo..',
      '.oboo...o...oobo.',
      '.oo.....o.....oo.',
    ],
  },

  // Scout — small pink interceptor, nose pointing down
  scout: {
    scale: 3,
    palette: { o: '#4b1024', a: '#ff4f79', w: '#ffd9a8' },
    rows: [
      'o.......o',
      'oo.....oo',
      'oaa...aao',
      '.oaaaaao.',
      '..oaaao..',
      '...owo...',
      '....o....',
    ],
  },

  // Zigzag — violet raider with a bright eye
  zigzag: {
    scale: 3,
    palette: { o: '#2a0b3d', a: '#c06bff', w: '#f4e6ff' },
    rows: [
      'o.........o',
      'oo.......oo',
      'oaa.....aao',
      '.oaa...aao.',
      '..oaaaaao..',
      '..oaawaao..',
      '...oaaao...',
      '....oao....',
      '.....o.....',
    ],
  },

  // Heavy — wide amber gunship, 4 HP
  heavy: {
    scale: 4,
    palette: { o: '#3d1c00', a: '#ff9f1c', w: '#fff4cf' },
    rows: [
      'oo...........oo',
      'oaa.........aao',
      'oaaa.......aaao',
      'oaaaa.....aaaao',
      '.oaaaa...aaaao.',
      '.oaaaaaaaaaaao.',
      'oaaaaaaaaaaaaao',
      'oaaaawwwwwaaaao',
      'oaaaawwwwwaaaao',
      'oaaaaaaaaaaaaao',
      '.oaaaaaaaaaaao.',
      '..oaa.ooo.aao..',
      '...oo.....oo...',
    ],
  },

  // Power-up — mint capsule with a white "II" for double shot
  powerup: {
    scale: 3,
    palette: { o: '#0a5a3c', y: '#57ffc2', w: '#f0fffa' },
    rows: [
      '...ooooo...',
      '..oyyyyyo..',
      '.oyyyyyyyo.',
      '.oywwywwyo.',
      '.oywwywwyo.',
      '.oyyyyyyyo.',
      '..oyyyyyo..',
      '...ooooo...',
    ],
  },
};

/** Render a pixel map to a cached canvas at an integer scale. */
function buildSprite(rows, palette, scale, solidColor) {
  const width = Math.max(...rows.map((r) => r.length));
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = rows.length * scale;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;

  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const color = solidColor || palette[ch];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas;
}

/** Pre-render a colored bloom around a sprite so draw() never needs shadowBlur. */
function buildAura(sprite, color, blur) {
  const pad = Math.ceil(blur * 1.4) + 2;
  const canvas = document.createElement('canvas');
  canvas.width = sprite.width + pad * 2;
  canvas.height = sprite.height + pad * 2;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.shadowColor = color;
  g.shadowBlur = blur;
  g.drawImage(sprite, pad, pad);
  g.globalAlpha = 0.7;
  g.drawImage(sprite, pad, pad);
  canvas.pad = pad;
  return canvas;
}

/** One-call beam sprite: neon shaft, hot core, and baked-in bloom. */
function buildBulletSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 34;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;

  g.shadowColor = CONFIG.colors.beam;
  g.shadowBlur = 9;
  g.fillStyle = 'rgba(80, 240, 255, 0.85)';
  g.fillRect(10, 8, 4, 18);

  g.fillStyle = CONFIG.colors.beam;
  g.fillRect(10, 8, 4, 18);
  g.fillStyle = CONFIG.colors.beamCore;
  g.fillRect(11, 10, 2, 14);
  return canvas;
}

/** Build every sprite once (normal + white flash variant). */
function buildSpriteCache() {
  const cache = {};
  for (const [key, def] of Object.entries(PIXEL_MAPS)) {
    cache[key] = buildSprite(def.rows, def.palette, def.scale);
    cache[key + 'White'] = buildSprite(def.rows, def.palette, def.scale, '#ffffff');
  }
  // Smaller version for HUD life icons.
  cache.playerIcon = buildSprite(PIXEL_MAPS.player.rows, PIXEL_MAPS.player.palette, 2);

  // Cached neon halos (replaces expensive per-frame shadowBlur).
  cache.playerAura = buildAura(cache.player, CONFIG.colors.playerGlow, 11);
  cache.enemyAuras = {
    scout: buildAura(cache.scout, CONFIG.enemies.scout.glow, 9),
    zigzag: buildAura(cache.zigzag, CONFIG.enemies.zigzag.glow, 10),
    heavy: buildAura(cache.heavy, CONFIG.enemies.heavy.glow, 14),
  };
  cache.bullet = buildBulletSprite();
  cache.powerupAura = buildAura(cache.powerup, '#57ffc2', 12);
  return cache;
}

/** Soft radial glow, reused by power-ups and engine FX. */
function buildGlow(color, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const half = size / 2;
  const grad = g.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.85;
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return canvas;
}

/* ==========================================================================
   4. AUDIO — Web Audio oscillator / noise SFX (no files)
   ========================================================================== */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.lastShoot = 0;
    this.muted = this.loadMuted();
  }

  loadMuted() {
    try { return localStorage.getItem(CONFIG.muteKey) === '1'; }
    catch (err) { return false; }
  }

  persistMute() {
    try { localStorage.setItem(CONFIG.muteKey, this.muted ? '1' : '0'); }
    catch (err) { /* storage unavailable — ignore */ }
  }

  /** Called from the first real user gesture (autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return false;
      this.ctx = new AudioCtor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.015);
    }
    this.persistMute();
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  createNoiseBuffer() {
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, rate, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Short oscillator blip with an exponential pitch + volume envelope. */
  tone(from, to, duration, type = 'square', volume = 0.1, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + Math.max(0, delay);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, from), t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, volume), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  /** Filtered white-noise burst. */
  noise(duration, volume, cutoffStart, cutoffEnd, delay = 0) {
    if (!this.ctx || this.muted || !this.noiseBuffer) return;
    const t = this.ctx.currentTime + Math.max(0, delay);
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    src.buffer = this.noiseBuffer;
    src.loop = true;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffStart, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, cutoffEnd), t + duration);
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(Math.max(0.0001, volume), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.03);
  }

  shoot() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShoot < 0.05) return;
    this.lastShoot = now;
    this.tone(1080, 260, 0.07, 'square', 0.045);
    this.tone(1900, 700, 0.04, 'triangle', 0.02);
  }

  hit() {
    this.tone(420, 150, 0.055, 'square', 0.055);
    this.noise(0.05, 0.05, 2600, 800);
  }

  explosion(big = false) {
    this.noise(big ? 0.55 : 0.30, big ? 0.34 : 0.20, big ? 1900 : 1300, 110);
    this.tone(big ? 130 : 170, 38, big ? 0.50 : 0.26, 'sine', big ? 0.28 : 0.16);
    if (big) this.noise(0.35, 0.12, 700, 90, 0.08);
  }

  powerup() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => this.tone(freq, freq, 0.10, 'square', 0.055, i * 0.055));
  }

  levelUp() {
    const notes = [440, 554, 659, 880];
    notes.forEach((freq, i) => this.tone(freq, freq, 0.09, 'triangle', 0.06, i * 0.06));
  }

  /** Bright coin-op "credit accepted" flourish when a run starts. */
  startGame() {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((freq, i) => this.tone(freq, freq, 0.08, 'square', 0.045, i * 0.055));
    this.tone(131, 131, 0.34, 'triangle', 0.05, 0.01);
  }

  /** Victory jingle when the cabinet records a new high score. */
  highScore() {
    const notes = [784, 988, 1175, 1568];
    notes.forEach((freq, i) => this.tone(freq, freq, 0.11, 'square', 0.05, i * 0.075));
    this.tone(1568, 1568, 0.3, 'triangle', 0.04, 0.3);
  }

  playerHit() {
    this.noise(0.7, 0.38, 2200, 80);
    this.tone(180, 30, 0.7, 'sawtooth', 0.2);
    this.tone(90, 25, 0.9, 'sine', 0.24, 0.05);
  }

  gameOver() {
    const seq = [
      [392, 0.0], [329.6, 0.17], [261.6, 0.34], [196, 0.52], [130.8, 0.74],
    ];
    seq.forEach(([freq, delay]) => {
      this.tone(freq, freq * 0.94, 0.24, 'sawtooth', 0.07, delay);
    });
    this.tone(65, 32, 1.3, 'sine', 0.12, 0.72);
  }
}

/* ==========================================================================
   5. STARFIELD — three parallax layers scrolling at different speeds
   ========================================================================== */

class Starfield {
  constructor() {
    this.time = 0;
    // Each layer bakes its stars into one tall tile, so drawing is a pair of
    // wrapped drawImage calls instead of hundreds of fillRect calls per frame.
    this.layers = CONFIG.starfield.layers.map((cfg) => ({
      cfg,
      tile: this.buildTile(cfg),
      offset: 0,
    }));
  }

  buildTile(cfg) {
    const canvas = document.createElement('canvas');
    canvas.width = CONFIG.width;
    canvas.height = CONFIG.height;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;

    // Keep star density constant as the playfield gets wider.
    const count = Math.max(6, Math.round(cfg.count * CONFIG.width / CONFIG.designWidth));

    for (let i = 0; i < count; i++) {
      const x = Math.round(rand(0, CONFIG.width - cfg.size));
      const y = Math.round(rand(0, CONFIG.height - cfg.size));
      g.globalAlpha = cfg.alpha * rand(0.5, 1);
      g.fillStyle = cfg.color;
      g.fillRect(x, y, cfg.size, cfg.size);

      // A few close stars get a tiny cross flare, baked in for free.
      if (cfg.size >= 2 && Math.random() < 0.34) {
        g.globalAlpha *= 0.42;
        g.fillRect(x - 2, y + (cfg.size >> 1), cfg.size + 4, 1);
        g.fillRect(x + (cfg.size >> 1), y - 2, 1, cfg.size + 4);
      }
    }
    return canvas;
  }

  /** Re-bake tiles after the playfield width changes, keeping scroll state. */
  rebuild() {
    for (const layer of this.layers) {
      layer.tile = this.buildTile(layer.cfg);
      layer.offset %= CONFIG.height;
    }
  }

  update(dt) {
    this.time += dt;
    for (const layer of this.layers) {
      layer.offset += layer.cfg.speed * dt;
      if (layer.offset >= CONFIG.height) layer.offset -= CONFIG.height;
    }
  }

  draw(ctx) {
    const height = CONFIG.height;
    for (const layer of this.layers) {
      const y = Math.round(layer.offset);
      // Layered alpha pulse keeps the field alive without per-star work.
      ctx.globalAlpha = 0.9 + 0.1 * Math.sin(this.time * 1.6 + layer.cfg.speed);
      ctx.drawImage(layer.tile, 0, y - height);
      ctx.drawImage(layer.tile, 0, y);
    }
    ctx.globalAlpha = 1;
  }
}

/* ==========================================================================
   6. ENTITIES
   ========================================================================== */

/* ---------- Player fighter ---------- */

class Player {
  constructor(game) {
    this.game = game;
    this.sprite = game.sprites.player;
    this.w = this.sprite.width;
    this.h = this.sprite.height;
    this.reset();
  }

  reset() {
    this.x = CONFIG.player.startX;
    this.y = CONFIG.player.startY;
    this.lives = CONFIG.player.lives;
    this.fireTimer = 0;
    this.invincible = 0;
    this.alive = true;
  }

  getHitbox() {
    const p = CONFIG.player;
    return {
      x: this.x - p.hitboxW / 2,
      y: this.y - p.hitboxH / 2,
      w: p.hitboxW,
      h: p.hitboxH,
    };
  }

  update(dt) {
    const cfg = CONFIG.player;
    const input = this.game.input;

    this.invincible = Math.max(0, this.invincible - dt);
    this.fireTimer = Math.max(0, this.fireTimer - dt);

    if (input.pointerActive && input.pointerTarget) {
      // Smoothly chase the drag target (gentle easing keeps it analog).
      const k = 1 - Math.exp(-cfg.touchFollow * dt);
      this.x += (input.pointerTarget.x - this.x) * k;
      this.y += (input.pointerTarget.y - this.y) * k;
    } else {
      let dx = 0;
      let dy = 0;
      if (input.left) dx -= 1;
      if (input.right) dx += 1;
      if (input.up) dy -= 1;
      if (input.down) dy += 1;
      if (dx || dy) {
        const len = Math.hypot(dx, dy) || 1;
        // Wider playfields need a little more horizontal speed to stay nimble;
        // vertical speed is unchanged because the world height never changes.
        const hScale = clamp(Math.sqrt(CONFIG.width / CONFIG.height), 1, 1.4);
        this.x += (dx / len) * cfg.speed * hScale * dt;
        this.y += (dy / len) * cfg.speed * dt;
      }
    }

    this.x = clamp(this.x, this.w / 2, CONFIG.width - this.w / 2);
    this.y = clamp(this.y, cfg.topLimit, CONFIG.height - cfg.bottomMargin);

    const wantFire = input.shoot || input.pointerActive;
    if (wantFire && this.fireTimer <= 0) {
      this.fire();
      this.fireTimer = cfg.fireCooldown;
    }
  }

  fire() {
    const g = this.game;
    const b = CONFIG.bullet;
    const double = g.doubleTimer > 0;
    const offsets = double ? [-b.doubleOffset, b.doubleOffset] : [0];
    const muzzleY = this.y - this.h / 2 + 4;

    for (const ox of offsets) {
      if (g.bullets.length >= b.max) break;
      g.spawnBullet(this.x + ox, muzzleY);
    }

    // Tiny muzzle sparks (pooled).
    for (const ox of offsets) {
      g.particles.spawn({
        x: this.x + ox,
        y: muzzleY + 2,
        vx: rand(-24, 24),
        vy: rand(30, 90),
        life: rand(0.08, 0.16),
        size: 2,
        color: '#c9fdff',
        drag: 4,
      });
    }

    g.audio.shoot();
  }

  draw(ctx) {
    if (!this.alive) return;

    // Blink while invincible.
    let alpha = 1;
    if (this.invincible > 0) {
      alpha = Math.floor(this.game.time * 12) % 2 === 0 ? 0.26 : 1;
    }

    const sx = Math.round(this.x - this.w / 2);
    const sy = Math.round(this.y - this.h / 2);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Engine glow.
    const glow = this.game.glows.blue;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * 0.5;
    ctx.drawImage(glow, this.x - 34, this.y + 6, 28, 34);
    ctx.drawImage(glow, this.x + 6, this.y + 6, 28, 34);
    ctx.restore();

    // Pre-rendered neon halo (no runtime shadowBlur).
    const aura = this.game.sprites.playerAura;
    ctx.globalAlpha = alpha * 0.85;
    ctx.drawImage(aura, sx - aura.pad, sy - aura.pad);
    ctx.globalAlpha = alpha;

    // Twin animated exhaust flames.
    const t = this.game.time;
    for (const ox of [6, this.w - 6]) {
      const flick = Math.sin(t * 34 + ox * 1.7) * 3 + Math.random() * 4;
      const len = 10 + flick;
      const fx = sx + ox;
      const fy = sy + this.h - 7;
      ctx.fillStyle = '#ff6a1a';
      ctx.fillRect(fx - 3, fy, 6, len);
      ctx.fillStyle = '#ffc857';
      ctx.fillRect(fx - 2, fy, 4, len * 0.68);
      ctx.fillStyle = '#fff6d0';
      ctx.fillRect(fx - 1, fy, 2, len * 0.32);
    }

    ctx.drawImage(this.sprite, sx, sy);
    ctx.restore();
  }
}

/* ---------- Beam bolt ---------- */

class Bullet {
  constructor(game) {
    this.game = game;
    this.x = 0;
    this.y = 0;
    this.dead = true;
  }

  /** Re-arm a pooled bolt. */
  init(x, y) {
    this.x = x;
    this.y = y;
    this.dead = false;
    return this;
  }

  update(dt) {
    this.y -= CONFIG.bullet.speed * dt;
    if (this.y + CONFIG.bullet.height < 0) this.dead = true;
  }

  getHitbox() {
    const b = CONFIG.bullet;
    return { x: this.x - b.hitW / 2, y: this.y - b.hitH / 2, w: b.hitW, h: b.hitH };
  }

  draw(ctx) {
    // One pre-rendered sprite: halo, shaft, hot core and bloom are baked in.
    const sprite = this.game.sprites.bullet;
    ctx.drawImage(
      sprite,
      Math.round(this.x - sprite.width / 2),
      Math.round(this.y - sprite.height / 2)
    );
  }
}

/* ---------- Enemy ships ---------- */

class Enemy {
  constructor(game) {
    this.game = game;
    this.type = 'scout';
    this.dead = true;
  }

  /** Re-arm a pooled ship for the given type. */
  init(type, x, y) {
    this.type = type;
    this.cfg = CONFIG.enemies[type];
    this.sprite = this.game.sprites[this.cfg.sprite];
    this.w = this.sprite.width;
    this.h = this.sprite.height;
    this.baseX = x;
    this.x = x;
    this.y = y;
    this.hp = this.cfg.hp;
    this.maxHp = this.cfg.hp;
    this.time = rand(0, TAU);
    this.flash = 0;
    this.dead = false;
    return this;
  }

  getHitbox() {
    return {
      x: this.x - this.cfg.hitboxW / 2,
      y: this.y - this.cfg.hitboxH / 2,
      w: this.cfg.hitboxW,
      h: this.cfg.hitboxH,
    };
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    this.y += this.cfg.speed * g.speedScale * dt;
    if (this.cfg.sway > 0) {
      this.x = this.baseX + Math.sin(this.time * this.cfg.swaySpeed) * this.cfg.sway;
    }
    this.flash = Math.max(0, this.flash - dt);
    if (this.y - this.h / 2 > CONFIG.height + 24) this.dead = true;
  }

  /** Returns true if this hit destroyed the ship. */
  damage(amount) {
    this.hp -= amount;
    this.flash = 0.09;
    return this.hp <= 0;
  }

  draw(ctx) {
    const sprite = this.flash > 0 ? this.game.sprites[this.cfg.sprite + 'White'] : this.sprite;
    const x = Math.round(this.x - this.w / 2);
    const y = Math.round(this.y - this.h / 2);

    // Cached colored bloom; dimmed while the white hit flash plays.
    const aura = this.game.sprites.enemyAuras[this.type];
    if (this.flash <= 0) {
      ctx.drawImage(aura, x - aura.pad, y - aura.pad);
    }
    ctx.drawImage(sprite, x, y);
  }
}

/* ---------- Particle + pool ---------- */

class Particle {
  constructor() {
    this.life = 0;
  }

  set(x, y, vx, vy, life, size, color, drag) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = life;
    this.size = size;
    this.color = color;
    this.drag = drag === undefined ? 2.4 : drag;
    return this;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) return;
    const damp = Math.exp(-this.drag * dt);
    this.vx *= damp;
    this.vy *= damp;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  draw(ctx) {
    const ratio = clamp(this.life / this.maxLife, 0, 1);
    const size = Math.max(1, Math.round(this.size * (0.35 + ratio * 0.65)));
    ctx.globalAlpha = ratio;
    ctx.fillStyle = this.color;
    ctx.fillRect(Math.round(this.x), Math.round(this.y), size, size);
  }
}

class ParticleSystem {
  constructor(max) {
    this.pool = [];
    this.active = [];
    for (let i = 0; i < max; i++) this.pool.push(new Particle());
  }

  spawn(opts) {
    let p = this.pool.pop();
    if (!p) p = this.active.pop(); // pool exhausted: recycle oldest
    if (!p) return;
    p.set(
      opts.x, opts.y, opts.vx || 0, opts.vy || 0,
      opts.life || 0.4, opts.size || 3,
      opts.color || '#ffffff', opts.drag
    );
    this.active.push(p);
  }

  /** Square-pixel explosion burst. */
  explosion(x, y, palette, count = 16, speed = 180, life = 0.55, size = 3) {
    for (let i = 0; i < count; i++) {
      const angle = rand(0, TAU);
      const power = rand(0.15, 1) * speed;
      const color = Math.random() < 0.24 ? '#ffffff' : pick(palette);
      this.spawn({
        x, y,
        vx: Math.cos(angle) * power,
        vy: Math.sin(angle) * power,
        life: rand(life * 0.45, life),
        size: rand(size * 0.7, size * 1.45),
        color,
        drag: rand(1.8, 3.4),
      });
    }
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.update(dt);
      if (p.life <= 0) {
        swapRemove(this.active, i);
        this.pool.push(p);
      }
    }
  }

  draw(ctx) {
    for (const p of this.active) p.draw(ctx);
    ctx.globalAlpha = 1;
  }

  clear() {
    while (this.active.length) this.pool.push(this.active.pop());
  }
}

/* ---------- Double-shot power-up ---------- */

class PowerUp {
  constructor(game, x, y) {
    this.game = game;
    this.sprite = game.sprites.powerup;
    this.w = this.sprite.width;
    this.h = this.sprite.height;
    this.baseX = clamp(x, this.w / 2 + 10, CONFIG.width - this.w / 2 - 10);
    this.x = this.baseX;
    this.y = y;
    this.time = rand(0, TAU);
  }

  getHitbox() {
    const p = CONFIG.powerup;
    return { x: this.x - p.hitW / 2, y: this.y - p.hitH / 2, w: p.hitW, h: p.hitH };
  }

  update(dt) {
    this.time += dt;
    this.y += CONFIG.powerup.fallSpeed * dt;
    this.x = this.baseX + Math.sin(this.time * 2.6) * CONFIG.powerup.sway;
    if (this.y - this.h / 2 > CONFIG.height + 20) this.dead = true;
  }

  draw(ctx) {
    const pulse = 0.55 + 0.25 * Math.sin(this.time * 6);
    const glow = this.game.glows.mint;
    const scale = 2.1 + Math.sin(this.time * 6) * 0.18;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pulse;
    ctx.drawImage(glow, this.x - (glow.width * scale) / 2, this.y - (glow.height * scale) / 2, glow.width * scale, glow.height * scale);
    ctx.restore();

    const x = Math.round(this.x - this.w / 2);
    const y = Math.round(this.y - this.h / 2);
    const aura = this.game.sprites.powerupAura;
    ctx.drawImage(aura, x - aura.pad, y - aura.pad);
    ctx.drawImage(this.sprite, x, y);

    // Sparkle pixels orbiting the capsule.
    ctx.save();
    ctx.fillStyle = '#eafff7';
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(this.time * 9);
    ctx.fillRect(x + 4, y - 4, 2, 2);
    ctx.fillRect(x + this.w - 6, y + this.h + 1, 2, 2);
    ctx.restore();
  }
}

/* ==========================================================================
   7. GAME — state machine, spawning, collisions, rendering
   ========================================================================== */

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this.dom = {
      stage: document.getElementById('stage'),
      score: document.getElementById('score'),
      high: document.getElementById('high'),
      level: document.getElementById('level'),
      lives: document.getElementById('lives'),
      power: document.getElementById('power'),
      powerFill: document.getElementById('power-fill'),
      soundState: document.getElementById('sound-state'),
      titleHigh: document.getElementById('title-high'),
      finalScore: document.getElementById('final-score'),
      newHigh: document.getElementById('new-high'),
      banner: document.getElementById('banner'),
      screens: {
        title: document.getElementById('screen-title'),
        paused: document.getElementById('screen-pause'),
        gameover: document.getElementById('screen-over'),
      },
    };

    // Measure the viewport before building anything that depends on world width.
    this.applyViewport();

    this.sprites = buildSpriteCache();
    this.glows = {
      blue: buildGlow('rgba(255, 200, 87, 0.55)', 96),
      mint: buildGlow('rgba(87, 255, 194, 0.55)', 96),
    };
    this.audio = new AudioEngine();
    this.starfield = new Starfield();
    this.particles = new ParticleSystem(CONFIG.particles.max);
    this.player = new Player(this);

    this.bullets = [];
    this.enemies = [];
    this.powerups = [];
    this.bulletPool = [];
    this.enemyPool = [];

    this.state = 'loading';
    this.time = 0;              // animation clock (seconds)
    this.score = 0;
    this.highScore = this.loadHighScore();
    this.startHighScore = this.highScore;
    this.level = 1;
    this.speedScale = 1;
    this.spawnTimer = CONFIG.spawn.initialDelay;
    this.doubleTimer = 0;
    this.shake = 0;
    this.flash = 0;
    this.gameOverTimer = 0;
    this.loopStarted = false;
    this.inputGuardUntil = 0;
    this.entrance = null;

    this.input = {
      left: false, right: false, up: false, down: false,
      shoot: false,
      pointerActive: false,
      pointerTarget: { x: CONFIG.player.startX, y: CONFIG.player.startY },
    };
    this.pointerId = null;
    this.dragOffset = { x: 0, y: 0 };

    this.hudCache = { score: -1, high: -1, level: -1, lives: -1, power: null, powerPct: null, mute: null };

    this.background = this.buildBackground();
    this.accumulator = 0;
    this.lastTimestamp = 0;
    this.frameBound = this.frame.bind(this);

    this.bindEvents();
    this.updateHighScoreDisplay();
    this.updateMuteLabel();
    this.setState('loading');
    this.updateHUD(true);
    this.updateLivesDisplay(true);
    this.updatePowerHUD();

    // Draw one static frame of the existing starfield behind the boot loader.
    // The fixed-timestep loop only starts after the user initialises audio.
    this.renderStatic();
  }

  /** Leave the loader: show the title screen and start the game loop. */
  begin(guardUntil = 0) {
    if (this.loopStarted) return;
    this.loopStarted = true;
    this.inputGuardUntil = Math.max(this.inputGuardUntil, guardUntil);
    this.audio.unlock();
    this.setState('title');
    this.updateHUD(true);
    this.accumulator = 0;
    this.lastTimestamp = 0;
    requestAnimationFrame(this.frameBound);
  }

  /** Static backdrop for LOADING / READY (no simulation, no entities). */
  renderStatic() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
    ctx.drawImage(this.background, 0, 0);
    this.starfield.draw(ctx);
  }

  /* ---------- persistence ---------- */

  loadHighScore() {
    try {
      const value = parseInt(localStorage.getItem(CONFIG.highScoreKey), 10);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (err) {
      return 0;
    }
  }

  saveHighScore() {
    try { localStorage.setItem(CONFIG.highScoreKey, String(this.highScore)); }
    catch (err) { /* storage unavailable — ignore */ }
  }

  /* ---------- viewport / responsive playfield ---------- */

  /**
   * Fit the logical playfield to the viewport. Height stays fixed so the world
   * always fills the screen vertically, while width follows the real aspect
   * ratio — no letterboxing, no stretched sprites.
   */
  applyViewport() {
    const vw = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const vh = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);

    const width = Math.max(1, Math.round(CONFIG.height * (vw / vh)));
    const changed = width !== CONFIG.width
      || this.canvas.width !== width
      || this.canvas.height !== CONFIG.height;

    CONFIG.width = width;
    if (changed) {
      this.canvas.width = width;
      this.canvas.height = CONFIG.height;
      this.ctx.imageSmoothingEnabled = false;
    }

    CONFIG.player.startX = width / 2;
    return changed;
  }

  /** Rebuild width-dependent caches and keep entities inside the new world. */
  handleResize() {
    const oldWidth = CONFIG.width;
    if (!this.applyViewport() || oldWidth === CONFIG.width) return;

    const ratio = CONFIG.width / oldWidth;

    this.background = this.buildBackground();
    this.starfield.rebuild();

    const halfW = this.player.w / 2;
    this.player.x = clamp(this.player.x * ratio, halfW, CONFIG.width - halfW);

    this.input.pointerTarget.x = clamp(
      this.input.pointerTarget.x * ratio,
      halfW,
      CONFIG.width - halfW
    );
    this.input.pointerTarget.y = this.player.y;

    for (const enemy of this.enemies) {
      const ew = enemy.w / 2;
      enemy.baseX = clamp(enemy.baseX * ratio, ew, CONFIG.width - ew);
      enemy.x = clamp(enemy.x * ratio, ew, CONFIG.width - ew);
    }

    for (const powerup of this.powerups) {
      const pw = powerup.w / 2 + 10;
      powerup.baseX = clamp(powerup.baseX * ratio, pw, CONFIG.width - pw);
      powerup.x = clamp(powerup.x * ratio, pw, CONFIG.width - pw);
    }

    this.render();
  }

  /* ---------- background (rendered once) ---------- */

  buildBackground() {
    const c = document.createElement('canvas');
    c.width = CONFIG.width;
    c.height = CONFIG.height;
    const g = c.getContext('2d');

    const base = g.createLinearGradient(0, 0, 0, CONFIG.height);
    base.addColorStop(0, '#000000');
    base.addColorStop(0.52, '#000002');
    base.addColorStop(1, '#000000');
    g.fillStyle = base;
    g.fillRect(0, 0, c.width, c.height);

    // Barely-there nebula haze keeps the void from feeling flat. Positions and
    // radii are proportional so the haze spreads across wide playfields.
    const ax = CONFIG.width * 0.1875;
    const ay = CONFIG.height * 0.208;
    const radiusA = CONFIG.height * 0.35;
    const nebulaA = g.createRadialGradient(ax, ay, 0, ax, ay, radiusA);
    nebulaA.addColorStop(0, 'rgba(30, 78, 130, 0.11)');
    nebulaA.addColorStop(0.55, 'rgba(24, 46, 96, 0.04)');
    nebulaA.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = nebulaA;
    g.fillRect(0, 0, c.width, c.height);

    // A whisper of violet in the lower corner.
    const bx = CONFIG.width * 0.896;
    const by = CONFIG.height * 0.778;
    const radiusB = CONFIG.height * 0.375;
    const nebulaB = g.createRadialGradient(bx, by, 0, bx, by, radiusB);
    nebulaB.addColorStop(0, 'rgba(72, 20, 82, 0.09)');
    nebulaB.addColorStop(0.6, 'rgba(44, 14, 62, 0.035)');
    nebulaB.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = nebulaB;
    g.fillRect(0, 0, c.width, c.height);

    return c;
  }

  /* ---------- state transitions ---------- */

  setState(next) {
    this.state = next;
    this.dom.stage.dataset.state = next;

    for (const [name, el] of Object.entries(this.dom.screens)) {
      el.classList.toggle('active', name === next);
    }

    if (next !== 'playing') {
      this.releasePointer();
      this.dom.banner.classList.remove('show');
    }
    if (next === 'title') {
      this.updateHighScoreDisplay();
      this.updateHUD(true);
    }
    if (next === 'gameover') {
      this.saveHighScore();
      this.updateHighScoreDisplay();
    }
    this.updatePowerHUD();
  }

  startRun() {
    this.audio.unlock();
    this.resetRun();
    this.setState('playing');
    this.audio.startGame();
    this.showBanner('LEVEL 1');
  }

  resetRun() {
    this.player.reset();
    while (this.bullets.length) this.bulletPool.push(this.bullets.pop());
    while (this.enemies.length) this.enemyPool.push(this.enemies.pop());
    this.powerups.length = 0;
    this.particles.clear();

    this.score = 0;
    this.level = 1;
    this.speedScale = 1;
    this.spawnTimer = CONFIG.spawn.initialDelay;
    this.doubleTimer = 0;
    this.shake = 0;
    this.flash = 0;
    this.gameOverTimer = 0;
    this.startHighScore = this.highScore;
    this.pointerId = null;
    this.input.pointerActive = false;

    this.updateHUD(true);
    this.updateLivesDisplay(true);
    this.updatePowerHUD();
    this.dom.banner.classList.remove('show');
  }

  togglePause() {
    if (this.state === 'playing') this.setState('paused');
    else if (this.state === 'paused') this.setState('playing');
  }

  finishGameOver() {
    this.gameOverTimer = 0;
    this.dom.finalScore.textContent = padScore(this.score);
    const isNew = this.score > this.startHighScore && this.score > 0;
    this.dom.newHigh.classList.toggle('hidden', !isNew);
    this.saveHighScore();
    this.setState('gameover');
    this.audio.gameOver();
    if (isNew) this.audio.highScore();
  }

  /* ---------- HUD ---------- */

  updateHUD(force = false) {
    const c = this.hudCache;
    if (force || c.score !== this.score) {
      this.dom.score.textContent = padScore(this.score);
      c.score = this.score;
    }
    if (force || c.high !== this.highScore) {
      this.dom.high.textContent = padScore(this.highScore);
      c.high = this.highScore;
    }
    if (force || c.level !== this.level) {
      this.dom.level.textContent = padLevel(this.level);
      c.level = this.level;
    }
  }

  updateHighScoreDisplay() {
    this.dom.titleHigh.textContent = padScore(this.highScore);
    this.dom.high.textContent = padScore(this.highScore);
    this.hudCache.high = this.highScore;
  }

  updateLivesDisplay(force = false) {
    if (!force && this.hudCache.lives === this.player.lives) return;
    this.hudCache.lives = this.player.lives;

    const host = this.dom.lives;
    while (host.firstChild) host.removeChild(host.firstChild);

    for (let i = 0; i < this.player.lives; i++) {
      const icon = document.createElement('canvas');
      icon.width = this.sprites.playerIcon.width;
      icon.height = this.sprites.playerIcon.height;
      const g = icon.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(this.sprites.playerIcon, 0, 0);
      host.appendChild(icon);
    }
  }

  updatePowerHUD() {
    const active = this.doubleTimer > 0 && (this.state === 'playing' || this.state === 'paused');
    if (active !== this.hudCache.power) {
      this.dom.power.classList.toggle('is-active', active);
      this.hudCache.power = active;
    }
    if (active) {
      // Integer percent + cache keeps this off the DOM hot path.
      const pct = Math.round(clamp(this.doubleTimer / CONFIG.powerup.duration, 0, 1) * 100);
      if (pct !== this.hudCache.powerPct) {
        this.hudCache.powerPct = pct;
        this.dom.powerFill.style.width = pct + '%';
      }
    } else {
      this.hudCache.powerPct = null;
    }
  }

  updateMuteLabel() {
    const muted = this.audio.muted;
    if (this.hudCache.mute === muted) return;
    this.hudCache.mute = muted;
    this.dom.soundState.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  }

  showBanner(text) {
    const el = this.dom.banner;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('show');
  }

  /* ---------- progression ---------- */

  addScore(points) {
    this.score += points;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.saveHighScore();
    }

    const nextLevel = Math.min(
      CONFIG.level.maxLevel,
      1 + Math.floor(this.score / CONFIG.level.scoreStep)
    );
    if (nextLevel > this.level) {
      this.level = nextLevel;
      this.speedScale = Math.min(
        CONFIG.level.maxSpeedScale,
        1 + (this.level - 1) * CONFIG.level.speedStep
      );
      this.showBanner(`LEVEL ${this.level}`);
      this.audio.levelUp();
      this.flash = Math.max(this.flash, 0.09);
    }
    this.updateHUD();
  }

  /* ---------- spawning ---------- */

  spawnBullet(x, y) {
    const bullet = this.bulletPool.pop() || new Bullet(this);
    bullet.init(x, y);
    this.bullets.push(bullet);
  }

  nextSpawnDelay() {
    const s = CONFIG.spawn;
    const base = Math.max(
      s.minInterval,
      s.baseInterval * Math.pow(s.intervalDecay, this.level - 1)
    );
    // Keep the same screen pressure when the field is wider than the original.
    const density = clamp(Math.sqrt(CONFIG.width / CONFIG.designWidth), 1, 1.35);
    return (base * rand(s.jitterMin, s.jitterMax)) / density;
  }

  spawnEnemy() {
    const s = CONFIG.spawn;
    const heavyChance = this.level >= s.heavyStartLevel
      ? Math.min(s.heavyMaxChance, s.heavyBaseChance + (this.level - s.heavyStartLevel) * s.heavyStep)
      : 0;
    const zigzagChance = Math.min(
      s.zigzagMaxChance,
      s.zigzagBaseChance + (this.level - 1) * s.zigzagStep
    );

    const roll = Math.random();
    let type = 'scout';
    if (roll < heavyChance) type = 'heavy';
    else if (roll < heavyChance + zigzagChance) type = 'zigzag';

    const cfg = CONFIG.enemies[type];
    const sprite = this.sprites[cfg.sprite];
    const margin = s.margins[type];
    const halfW = sprite.width / 2;
    const swayRoom = cfg.sway + 2;
    const minX = margin + halfW + swayRoom;
    const maxX = CONFIG.width - margin - halfW - swayRoom;
    const x = minX < maxX ? rand(minX, maxX) : CONFIG.width / 2;
    const y = -sprite.height / 2 - rand(6, 44);

    const enemy = this.enemyPool.pop() || new Enemy(this);
    enemy.init(type, x, y);
    this.enemies.push(enemy);
  }

  /* ---------- update ---------- */

  update(dt) {
    if (this.state === 'loading' || this.state === 'ready' || this.state === 'paused') return;

    this.time += dt;
    this.starfield.update(dt);

    if (this.shake > 0) this.shake = Math.max(0, this.shake - CONFIG.shake.decay * dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - CONFIG.flashDecay * dt);

    if (this.state === 'title') {
      this.particles.update(dt);
      return;
    }

    if (this.state === 'gameover') {
      this.particles.update(dt);
      return;
    }

    // Final-death slide: ships keep moving, but the player is gone.
    if (this.gameOverTimer > 0) {
      this.gameOverTimer -= dt;
      this.updateEnemies(dt);
      this.updateBullets(dt);
      this.handleBulletCollisions();
      this.updatePowerups(dt);
      this.particles.update(dt);
      if (this.gameOverTimer <= 0) this.finishGameOver();
      return;
    }

    if (this.player.alive) this.player.update(dt);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnEnemy();
      this.spawnTimer = this.nextSpawnDelay();
    }

    if (this.doubleTimer > 0) this.doubleTimer = Math.max(0, this.doubleTimer - dt);

    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updatePowerups(dt);
    this.handleBulletCollisions();
    this.handlePlayerCollisions();
    this.particles.update(dt);
  }

  updateEnemies(dt) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      enemy.update(dt);
      if (enemy.dead) {
        swapRemove(this.enemies, i);
        this.enemyPool.push(enemy);
      }
    }
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      bullet.update(dt);
      if (bullet.dead) {
        swapRemove(this.bullets, i);
        this.bulletPool.push(bullet);
      }
    }
  }

  updatePowerups(dt) {
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const power = this.powerups[i];
      power.update(dt);
      if (power.dead) swapRemove(this.powerups, i);
    }
  }

  /* ---------- collisions ---------- */

  handleBulletCollisions() {
    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const bullet = this.bullets[bi];
      if (bullet.dead) continue;
      const bulletBox = bullet.getHitbox();

      for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
        const enemy = this.enemies[ei];
        if (!overlaps(bulletBox, enemy.getHitbox())) continue;

        bullet.dead = true;
        this.audio.hit();

        if (enemy.damage(1)) {
          this.destroyEnemy(enemy, ei);
        } else {
          this.particles.explosion(bullet.x, bullet.y, [enemy.cfg.glow, '#ffffff'], 5, 95, 0.24, 2);
          if (enemy.type === 'heavy') this.shake = Math.max(this.shake, CONFIG.shake.enemy);
        }
        break;
      }
    }

    // Recycle spent bolts in place.
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      if (this.bullets[i].dead) {
        this.bulletPool.push(this.bullets[i]);
        swapRemove(this.bullets, i);
      }
    }
  }

  destroyEnemy(enemy, index) {
    swapRemove(this.enemies, index);
    this.enemyPool.push(enemy);
    this.addScore(CONFIG.enemies[enemy.type].score);

    const palettes = {
      scout: ['#ff4f79', '#ffb1c7', '#ffd9a8', '#ffffff'],
      zigzag: ['#c06bff', '#e3c2ff', '#f4e6ff', '#ffffff'],
      heavy: ['#ff9f1c', '#ffc857', '#fff4cf', '#ffffff'],
    };
    const big = enemy.type === 'heavy';
    this.particles.explosion(
      enemy.x, enemy.y, palettes[enemy.type],
      big ? 34 : enemy.type === 'zigzag' ? 22 : 16,
      big ? 230 : 175,
      big ? 0.8 : 0.55,
      big ? 4 : 3
    );
    this.audio.explosion(big);
    this.shake = Math.max(this.shake, big ? CONFIG.shake.heavy : CONFIG.shake.enemy);
    this.flash = Math.max(this.flash, big ? 0.10 : 0.035);

    if (Math.random() < CONFIG.powerup.dropChance) {
      this.powerups.push(new PowerUp(this, enemy.x, enemy.y));
    }
  }

  handlePlayerCollisions() {
    const player = this.player;
    if (!player.alive || player.invincible > 0) return;

    // Enemy ramming the player.
    const playerBox = player.getHitbox();
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!overlaps(playerBox, enemy.getHitbox())) continue;

      swapRemove(this.enemies, i);
      this.enemyPool.push(enemy);
      this.particles.explosion(
        enemy.x, enemy.y,
        [enemy.cfg.glow, '#ffffff', '#ffc857'],
        enemy.type === 'heavy' ? 24 : 14,
        190, 0.5, 3
      );
      this.hitPlayer();
      break;
    }

    if (!player.alive) return;

    // Power-up pickup.
    const box = player.getHitbox();
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const power = this.powerups[i];
      if (!overlaps(box, power.getHitbox())) continue;
      swapRemove(this.powerups, i);
      this.collectPowerUp(power);
      break;
    }
  }

  collectPowerUp(power) {
    this.doubleTimer = CONFIG.powerup.duration;
    this.audio.powerup();
    this.particles.explosion(power.x, power.y, ['#57ffc2', '#f0fffa', '#ffffff'], 20, 150, 0.55, 3);
    this.showBanner('DOUBLE SHOT');
    this.flash = Math.max(this.flash, 0.07);
    this.updatePowerHUD();
  }

  hitPlayer() {
    const player = this.player;
    if (!player.alive || player.invincible > 0) return;

    player.lives -= 1;
    player.invincible = CONFIG.player.invincibleTime;
    this.doubleTimer = 0;
    this.audio.playerHit();

    this.particles.explosion(
      player.x, player.y,
      ['#49a6ff', '#c9fdff', '#ffffff', '#ffc857'],
      48, 300, 1.0, 4
    );
    this.particles.explosion(
      player.x, player.y,
      ['#ff6a1a', '#ffc857'],
      18, 170, 1.15, 3
    );

    this.shake = CONFIG.shake.player;
    this.flash = 0.32;
    this.updateLivesDisplay();

    if (player.lives <= 0) {
      player.alive = false;
      player.invincible = 0;
      this.gameOverTimer = CONFIG.player.deathDelay;
    }
    this.updatePowerHUD();
  }

  /* ---------- render ---------- */

  render() {
    const ctx = this.ctx;
    const w = CONFIG.width;
    const h = CONFIG.height;

    // DOM HUD updates happen once per rendered frame, never per sim step.
    this.updateHUD();
    this.updatePowerHUD();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.background, 0, 0);
    this.starfield.draw(ctx);

    ctx.save();
    if (this.shake > 0.2 && this.state === 'playing') {
      ctx.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));
    }

    for (const power of this.powerups) power.draw(ctx);
    for (const enemy of this.enemies) enemy.draw(ctx);
    for (const bullet of this.bullets) bullet.draw(ctx);
    if ((this.state === 'playing' || this.state === 'paused') && this.player.alive) {
      this.player.draw(ctx);
    }
    this.particles.draw(ctx);

    ctx.restore();

    // Full-screen hit flash.
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${(this.flash * 0.55).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* ---------- fixed-timestep loop ---------- */

  frame(now) {
    if (!this.lastTimestamp) this.lastTimestamp = now;
    const elapsed = (now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;

    // Clamp huge gaps (tab switch, breakpoint) and advance in fixed steps.
    this.accumulator += Math.min(elapsed, CONFIG.maxFrame);
    let steps = 0;
    while (this.accumulator >= CONFIG.step && steps < 240) {
      this.update(CONFIG.step);
      this.accumulator -= CONFIG.step;
      steps++;
    }
    if (steps >= 240) this.accumulator = 0;

    this.render();
    requestAnimationFrame(this.frameBound);
  }

  /* ---------- input ---------- */

  bindEvents() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.onBlur());
    window.addEventListener('beforeunload', () => this.saveHighScore());
    document.addEventListener('visibilitychange', () => this.onVisibility());

    // Debounce resize so dragging a window edge doesn't rebuild star tiles
    // dozens of times per second.
    let resizeTimer = 0;
    const queueResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => this.handleResize(), 90);
    };
    window.addEventListener('resize', queueResize);
    window.addEventListener('orientationchange', queueResize);

    const stage = this.dom.stage;
    stage.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    stage.addEventListener('pointermove', (e) => this.onPointerMove(e));
    stage.addEventListener('pointerup', (e) => this.onPointerUp(e));
    stage.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    stage.addEventListener('lostpointercapture', (e) => {
      if (this.pointerId !== null && e.pointerId === this.pointerId) {
        this.pointerId = null;
        this.input.pointerActive = false;
      }
    });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onKeyDown(e) {
    // Swallow the key that dismissed the boot loader so it cannot double as
    // Enter-to-start (or fire a shot) in the same gesture.
    if (performance.now() < this.inputGuardUntil) {
      e.preventDefault();
      return;
    }

    this.audio.unlock();

    const action = resolveAction(e);
    if (action) {
      this.input[action] = true;
      e.preventDefault();
    }

    if (e.repeat) return;

    const keyName = (e.key || '').toLowerCase();
    if (e.code === 'KeyP' || keyName === 'p') {
      e.preventDefault();
      this.togglePause();
      return;
    }
    if (e.code === 'KeyM' || keyName === 'm') {
      e.preventDefault();
      const muted = this.audio.toggleMute();
      if (this.entrance) this.entrance.setMuted(muted);
      this.updateMuteLabel();
      return;
    }
    if (e.code === 'Enter' || e.key === 'Enter') {
      e.preventDefault();
      if (this.state === 'title' || this.state === 'gameover') this.startRun();
      else if (this.state === 'paused') this.setState('playing');
    }
  }

  onKeyUp(e) {
    const action = resolveAction(e);
    if (action) {
      this.input[action] = false;
      e.preventDefault();
    }
  }

  clearInput() {
    this.input.left = false;
    this.input.right = false;
    this.input.up = false;
    this.input.down = false;
    this.input.shoot = false;
  }

  onBlur() {
    this.clearInput();
    this.releasePointer();
    if (this.state === 'playing') this.setState('paused');
  }

  onVisibility() {
    if (!document.hidden) return;
    this.saveHighScore();
    this.clearInput();
    this.releasePointer();
    if (this.state === 'playing') this.setState('paused');
  }

  eventToWorld(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (CONFIG.width / rect.width),
      y: (e.clientY - rect.top) * (CONFIG.height / rect.height),
    };
  }

  onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (performance.now() < this.inputGuardUntil) return;
    e.preventDefault();
    this.audio.unlock();

    if (this.state === 'title' || this.state === 'gameover') {
      this.startRun();
    } else if (this.state === 'paused') {
      this.setState('playing');
    }

    if (this.state !== 'playing' || this.pointerId !== null || !this.player.alive) return;

    const pt = this.eventToWorld(e);
    this.pointerId = e.pointerId;
    // Grab-relative drag: the jet never jumps to the finger.
    this.dragOffset.x = this.player.x - pt.x;
    this.dragOffset.y = this.player.y - pt.y;
    this.input.pointerTarget.x = this.player.x;
    this.input.pointerTarget.y = this.player.y;
    this.input.pointerActive = true;

    try { this.dom.stage.setPointerCapture(e.pointerId); }
    catch (err) { /* capture unsupported — drag still works while inside */ }
  }

  onPointerMove(e) {
    if (!this.input.pointerActive || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const pt = this.eventToWorld(e);
    this.input.pointerTarget.x = pt.x + this.dragOffset.x;
    this.input.pointerTarget.y = pt.y + this.dragOffset.y;
  }

  onPointerUp(e) {
    if (e.pointerId !== this.pointerId) return;
    this.releasePointer();
  }

  releasePointer() {
    if (this.pointerId !== null) {
      try {
        if (this.dom.stage.hasPointerCapture(this.pointerId)) {
          this.dom.stage.releasePointerCapture(this.pointerId);
        }
      } catch (err) { /* ignore */ }
    }
    this.pointerId = null;
    this.input.pointerActive = false;
    this.input.pointerTarget.x = this.player.x;
    this.input.pointerTarget.y = this.player.y;
  }
}

/* ==========================================================================
   8. ENTRANCE TRACK

   The boot loader plays a 37-second cinematic track while the progress bar
   fills. There is no background music during the game itself — the player
   only hears the Web Audio sound effects. The track is optional: if the file
   is missing, the loader still waits the full 37 seconds silently.
   ========================================================================== */

class EntranceTrack {
  constructor(options = {}) {
    this.onProgress = options.onProgress || (() => {});
    this.onBlocked = options.onBlocked || (() => {});
    this.onComplete = options.onComplete || (() => {});

    this.audio = null;
    this.mode = 'idle';         // idle | audio | timer | done
    this.timer = 0;
    this.timerStart = 0;
    this.done = false;
    this.blocked = false;
    this.muted = !!options.muted;
    this.lifecycleBound = false;
  }

  init() {
    if (this.mode !== 'idle') return;
    this.initAudio();
    this.bindLifecycle();
  }

  initAudio() {
    let audio;
    try {
      audio = new Audio();
      audio.preload = 'auto';
      audio.src = CONFIG.ENTRANCE.SRC;
      audio.loop = false;
      audio.volume = clamp(CONFIG.ENTRANCE.VOLUME / 100, 0, 1);
      audio.muted = this.muted;
      audio.addEventListener('ended', () => this.finish(), { once: true });
      audio.addEventListener('error', () => this.startTimer(), { once: true });
      this.audio = audio;
      audio.load();
    } catch (err) {
      this.startTimer();
      return;
    }

    this.timer = window.setInterval(() => this.check(), 100);

    // Browsers usually block sound before a gesture. Try anyway; the loader
    // shows a "press to begin" prompt if the attempt is rejected.
    const attempt = audio.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(() => {
        if (this.mode !== 'done') {
          this.mode = 'audio';
          this.blocked = false;
          this.onBlocked(false);
        }
      }).catch(() => this.block());
    } else if (audio.paused) {
      this.block();
    } else {
      this.mode = 'audio';
    }
  }

  /** Called by the loader's gesture when autoplay was blocked. */
  startFromGesture() {
    if (this.done) return;
    if (this.mode === 'timer') {
      if (!this.timerStart) this.timerStart = performance.now();
      this.blocked = false;
      this.onBlocked(false);
      return;
    }
    if (!this.audio) {
      this.startTimer();
      return;
    }
    this.blocked = false;
    this.onBlocked(false);
    const attempt = this.audio.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(() => {
        if (this.mode !== 'done') this.mode = 'audio';
      }).catch(() => this.block());
    } else if (!this.audio.paused) {
      this.mode = 'audio';
    }
  }

  block() {
    if (this.done) return;
    // A missing/unsupported file has already fallen back to the silent clock.
    if (this.mode === 'timer') return;
    // Some browsers reject play() before the media `error` event fires.
    if (!this.audio || this.audio.error) {
      this.startTimer();
      return;
    }
    this.blocked = true;
    this.mode = 'idle';
    this.onBlocked(true);
  }

  /** Silent fallback when the MP3 is missing: still honour the 37s wait. */
  startTimer() {
    if (this.done) return;
    if (this.mode === 'timer' && this.timerStart) return;
    this.mode = 'timer';
    this.timerStart = performance.now();
    this.blocked = false;
    this.onBlocked(false);
    if (!this.timer) {
      this.timer = window.setInterval(() => this.check(), 100);
    }
  }

  check() {
    if (this.done) return;

    if (this.mode === 'timer') {
      if (!this.timerStart) return;
      const pct = ((performance.now() - this.timerStart) / (CONFIG.ENTRANCE.DURATION * 1000)) * 100;
      this.report(pct);
      if (pct >= 100) this.finish();
      return;
    }

    const audio = this.audio;
    if (!audio || this.mode !== 'audio') return;
    const duration = CONFIG.ENTRANCE.DURATION;
    const pct = (audio.currentTime / duration) * 100;
    this.report(pct);
    if (audio.currentTime >= duration || audio.ended) this.finish();
  }

  report(pct) {
    this.onProgress(clamp(pct, 0, 100));
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.mode = 'done';
    this.clearTimer();
    if (this.audio) {
      try { this.audio.pause(); } catch (err) { /* ignore */ }
    }
    this.onProgress(100);
    this.onComplete();
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.audio) this.audio.muted = this.muted;
  }

  bindLifecycle() {
    if (this.lifecycleBound) return;
    this.lifecycleBound = true;
    this.onPageHide = () => this.stop();
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('beforeunload', this.onPageHide);
  }

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  }

  /** Stop playback and release the timer (page unload / teardown). */
  stop() {
    this.clearTimer();
    if (this.audio) {
      try { this.audio.pause(); } catch (err) { /* ignore */ }
    }
    if (!this.done) {
      this.done = true;
      this.mode = 'done';
      this.onProgress(100);
    }
    if (this.lifecycleBound) {
      window.removeEventListener('pagehide', this.onPageHide);
      window.removeEventListener('beforeunload', this.onPageHide);
      this.lifecycleBound = false;
    }
  }
}

/* ==========================================================================
   9. LOADER SCREEN
   ========================================================================== */

class LoaderScreen {
  constructor() {
    this.el = document.getElementById('loader');
    this.statusEl = document.getElementById('loader-status');
    this.pctEl = document.getElementById('loader-pct');
    this.barEl = document.getElementById('loader-bar');
    this.segmentsEl = document.getElementById('loader-segments');
    this.readyEl = document.getElementById('loader-ready');
    this.canvas = document.getElementById('game');

    this.segments = [];
    this.lit = -1;
    this.lastPct = '';
    this.progress = 0;
    this.target = 0;
    this.displayed = 0;
    this.phase = 'idle';
    this.entrance = null;
    this.onReady = () => {};
    this.onStart = () => {};
    this.lastFrame = 0;
    this.raf = 0;

    this.keyHandler = (e) => this.handleKey(e);
    this.pointerHandler = (e) => this.handlePointer(e);

    for (let i = 0; i < 20; i++) {
      const segment = document.createElement('span');
      this.segmentsEl.appendChild(segment);
      this.segments.push(segment);
    }

    // Capture phase: the dismissing key never reaches the game controls.
    window.addEventListener('keydown', this.keyHandler, true);
    this.el.addEventListener('pointerdown', this.pointerHandler, true);
  }

  attach({ entrance, onReady, onStart }) {
    this.entrance = entrance;
    this.onReady = onReady || this.onReady;
    this.onStart = onStart || this.onStart;
  }

  /** Start the loader animation, then begin loading the entrance track. */
  begin() {
    if (this.phase !== 'idle') return;
    this.phase = 'loading';
    this.lastFrame = 0;
    this.raf = requestAnimationFrame((now) => this.tick(now));
    if (this.entrance) this.entrance.init();
  }

  /** Fed by the entrance track — always a monotonic target, never a timer. */
  setProgress(progress) {
    progress = clamp(progress, 0, 100);
    if (progress > this.progress) this.progress = progress;
  }

  /** Autoplay was blocked: ask for the gesture that starts the entrance. */
  setBlocked(blocked) {
    if (this.phase === 'ready' || this.phase === 'launching' || this.phase === 'done') return;
    if (blocked) {
      this.phase = 'blocked';
      this.readyEl.textContent = 'PRESS ANY KEY OR CLICK TO BEGIN';
      this.readyEl.classList.remove('hidden');
    } else if (this.phase === 'blocked') {
      this.phase = 'loading';
      this.readyEl.classList.add('hidden');
      // The animation loop stops while blocked; restart it after the gesture.
      this.lastFrame = 0;
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }
  }

  tick(now) {
    if (this.phase !== 'loading') return;
    if (!this.lastFrame) this.lastFrame = now;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    // The 37-second entrance is the single progress signal.
    const target = this.progress;
    this.target = target;

    // Ease toward the real target and never move backwards.
    const k = 1 - Math.exp(-8 * dt);
    if (this.displayed < target) {
      this.displayed += (target - this.displayed) * k;
    }
    if (target - this.displayed < 0.25) this.displayed = target;
    this.displayed = clamp(this.displayed, 0, 100);
    this.renderValue();

    if (target >= 100 && this.displayed >= 99.75) {
      this.displayed = 100;
      this.renderValue();
      this.markReady();
      return;
    }

    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  renderValue() {
    const pct = Math.round(this.displayed);
    const label = String(pct).padStart(3, '0') + '%';
    if (label !== this.lastPct) {
      this.lastPct = label;
      this.pctEl.textContent = label;
      this.barEl.setAttribute('aria-valuenow', String(pct));
    }

    const lit = Math.round((this.displayed / 100) * this.segments.length);
    if (lit !== this.lit) {
      this.lit = lit;
      for (let i = 0; i < this.segments.length; i++) {
        this.segments[i].classList.toggle('is-on', i < lit);
      }
    }
  }

  markReady() {
    if (this.phase !== 'loading') return;
    this.phase = 'ready';
    this.el.classList.add('is-ready');
    this.statusEl.textContent = 'LOADING COMPLETE';
    this.readyEl.textContent = 'PRESS ANY KEY OR CLICK TO START';
    this.readyEl.classList.remove('hidden');
    this.onReady();
  }

  handleKey(e) {
    if (this.phase === 'blocked') {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (this.entrance) this.entrance.startFromGesture();
      return;
    }
    if (this.phase !== 'ready') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    this.launch();
  }

  handlePointer(e) {
    if (this.phase === 'blocked') {
      e.preventDefault();
      e.stopPropagation();
      if (this.entrance) this.entrance.startFromGesture();
      return;
    }
    if (this.phase !== 'ready') return;
    e.preventDefault();
    e.stopPropagation();
    this.launch();
  }

  /** First key/click: reveal the title and start the game loop. */
  launch() {
    if (this.phase !== 'ready') return;
    this.phase = 'launching';

    // The entrance is already complete here, but make sure it is silent.
    if (this.entrance) this.entrance.stop();
    this.onStart(performance.now() + 150);

    this.el.classList.add('is-done');
    this.el.setAttribute('aria-hidden', 'true');
    window.removeEventListener('keydown', this.keyHandler, true);
    this.el.removeEventListener('pointerdown', this.pointerHandler, true);

    try { window.focus(); } catch (err) { /* ignore */ }
    try { this.canvas.focus({ preventScroll: true }); }
    catch (err) { try { this.canvas.focus(); } catch (err2) { /* ignore */ } }
  }
}

/* ==========================================================================
   10. INPUT MAP + BOOT
   ========================================================================== */

const KEY_ACTIONS = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'shoot',
};

// Fallback for environments where KeyboardEvent.code is missing.
const KEY_FALLBACK = {
  arrowleft: 'left', a: 'left',
  arrowright: 'right', d: 'right',
  arrowup: 'up', w: 'up',
  arrowdown: 'down', s: 'down',
  ' ': 'shoot', spacebar: 'shoot',
};

function resolveAction(e) {
  return KEY_ACTIONS[e.code] || KEY_FALLBACK[(e.key || '').toLowerCase()] || null;
}

// Boot order: build the game in its LOADING state (loop idle), wire up the
// entrance track + loader, then let the loader drive the transition to TITLE.
const game = new Game();
const loader = new LoaderScreen();
const entrance = new EntranceTrack({
  muted: game.audio.muted,
  onProgress: (progress) => loader.setProgress(progress),
  onBlocked: (blocked) => loader.setBlocked(blocked),
  onComplete: () => {},
});

game.entrance = entrance;
loader.attach({
  entrance,
  onReady: () => game.setState('ready'),
  onStart: (guardUntil) => game.begin(guardUntil),
});

// Exposed for quick tweaking in the browser console.
window.starLancer = game;

loader.begin();
