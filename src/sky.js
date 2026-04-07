/**
 * Night sky subsystem — gradient, stars, moon, and meteors.
 *
 * Generates the star field once at construction. Each frame:
 *   update(dt)                          — advances sparkle phases and meteors
 *   draw(pixels, w, h, mvp, hw, hh,    — renders sky elements into the pixel buffer
 *        camPos, nightness, sunDir, t)
 *
 * Must be drawn AFTER beginFrame() fog fill and BEFORE scene geometry so that
 * depth-tested triangles overwrite sky pixels naturally.
 */

import { v3add, v3scale, v3norm, projectPoint, lerp, clamp } from './math.js';

// ── Deterministic hash (0-1) from a numeric seed ──

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function hash2(a, b) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// ── Star field generation ──

const STAR_COUNT        = 420;
const SPARKLE_FRACTION  = 0.18;   // 18% of stars twinkle

function generateStarField() {
  const stars = [];
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < STAR_COUNT; i++) {
    // Fibonacci sphere — upper hemisphere only (y > 0)
    const y = 0.04 + (i / STAR_COUNT) * 0.96;
    const theta = golden * i;
    const r = Math.sqrt(1 - y * y);

    // Jitter for organic feel
    let dx = Math.cos(theta) * r + (hash(i * 3.7) - 0.5) * 0.12;
    let dz = Math.sin(theta) * r + (hash(i * 7.3) - 0.5) * 0.12;
    let dy = y;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= len; dy /= len; dz /= len;

    // Size bands: 0 = tiny 1px dot, 1 = small bright dot, 2 = medium (plus pattern)
    const sr = hash(i * 13.1);
    const size = sr < 0.55 ? 0 : sr < 0.85 ? 1 : 2;

    // Brightness variation
    const brightness = 0.25 + hash(i * 17.3) * 0.75;

    // Warm / cool tint — subtle color variety
    const tintSeed = hash(i * 43.9);
    // 0 = neutral, 1 = warm (orange-ish), 2 = cool (blue-ish)
    const tint = tintSeed < 0.6 ? 0 : tintSeed < 0.8 ? 1 : 2;

    // Sparkle params (only for a subset)
    const sparkle = hash(i * 23.7) < SPARKLE_FRACTION;

    stars.push({
      dx, dy, dz,
      size,
      brightness,
      tint,
      sparkle,
      sparklePhase: hash(i * 31.1) * Math.PI * 2,
      sparkleSpeed: 0.7 + hash(i * 37.3) * 2.2,
      sparkleAmp:   0.15 + hash(i * 41.7) * 0.45,
    });
  }

  return stars;
}

// ── Moon surface pseudo-noise ──

function moonNoise(px, py, scale) {
  // Cheap value-noise approximation — gives soft blotchy patches
  const fx = px * scale, fy = py * scale;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const st = tx * tx * (3 - 2 * tx);
  const su = ty * ty * (3 - 2 * ty);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, st), lerp(c, d, st), su);
}

// ── Meteor spawning ──

function spawnMeteor(w, h) {
  // Start from upper-left or upper-right quadrant
  const fromLeft = hash(performance.now()) > 0.5;
  const sx = fromLeft
    ? 20 + Math.random() * (w * 0.6)
    : w * 0.3 + Math.random() * (w * 0.6);
  const sy = Math.random() * (h * 0.35);

  // Streak diagonally downward
  const angle = (fromLeft ? 0.3 : Math.PI - 0.3) + (Math.random() - 0.5) * 0.5;
  const speed = 140 + Math.random() * 220;
  const life  = 0.25 + Math.random() * 0.45;

  return {
    sx, sy,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life,
    maxLife: life,
    tailLen: 10 + Math.random() * 18,
    brightness: 0.7 + Math.random() * 0.3,
  };
}

// ── NightSky ──

export class NightSky {
  constructor() {
    this.stars   = generateStarField();
    this.meteors = [];
    this.meteorTimer = 6 + Math.random() * 10;
  }

  // ── per-frame update ──

  update(dt) {
    // Advance active meteors
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.sx += m.vx * dt;
      m.sy += m.vy * dt;
      m.life -= dt;
      if (m.life <= 0) this.meteors.splice(i, 1);
    }

    // Spawn check
    this.meteorTimer -= dt;
    if (this.meteorTimer <= 0) {
      this.meteorTimer = 12 + Math.random() * 22;
      this.meteors.push(spawnMeteor(320, 200));
    }
  }

  // ── per-frame draw ──

  draw(pixels, w, h, mvp, hw, hh, camPos, nightness, sunDir, totalTime, skyTint) {
    if (nightness < 0.05) return;

    this._drawGradient(pixels, w, h, nightness, skyTint);
    this._drawStars(pixels, w, h, mvp, hw, hh, camPos, nightness, totalTime);
    this._drawMoon(pixels, w, h, mvp, hw, hh, camPos, nightness, sunDir);
    this._drawMeteors(pixels, w, h, nightness);
  }

  // ── sky gradient ──

  _drawGradient(pixels, w, h, nightness, skyTint) {
    // Blend top of screen toward a richer navy; leave lower screen as fog.
    // Applies over the fog fill that beginFrame() already laid down.
    let zenithR = 8,  zenithG = 10, zenithB = 28;   // deep navy
    let midR    = 14, midG    = 14, midB    = 32;    // slightly lighter

    // Mode sky tint — shift gradient colors (e.g. blood-red for hell)
    if (skyTint) {
      zenithR = zenithR * (1 - nightness) + skyTint[0] * 255 * nightness;
      zenithG = zenithG * (1 - nightness) + skyTint[1] * 255 * nightness;
      zenithB = zenithB * (1 - nightness) + skyTint[2] * 255 * nightness;
      midR    = midR    * (1 - nightness) + skyTint[0] * 200 * nightness;
      midG    = midG    * (1 - nightness) + skyTint[1] * 200 * nightness;
      midB    = midB    * (1 - nightness) + skyTint[2] * 200 * nightness;
    }

    for (let y = 0; y < h; y++) {
      // t = 1 at top, 0 at 70% of screen height
      const t = clamp(1 - y / (h * 0.7), 0, 1);
      if (t <= 0) break;                               // nothing to do below

      // Smooth falloff
      const blend = t * t * nightness;
      // Gradient target blends from zenith at top to mid at the transition line
      const gr = lerp(midR, zenithR, t);
      const gg = lerp(midG, zenithG, t);
      const gb = lerp(midB, zenithB, t);

      // Subtle horizontal variation so it's not perfectly banded
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const hvar = (hash2(x * 0.37, y * 0.53) - 0.5) * 4 * nightness;
        pixels[idx]     = lerp(pixels[idx],     gr + hvar, blend) | 0;
        pixels[idx + 1] = lerp(pixels[idx + 1], gg + hvar, blend) | 0;
        pixels[idx + 2] = lerp(pixels[idx + 2], gb,        blend) | 0;
      }
    }
  }

  // ── stars ──

  _drawStars(pixels, w, h, mvp, hw, hh, camPos, nightness, totalTime) {
    const alpha = clamp((nightness - 0.1) / 0.3, 0, 1);
    if (alpha <= 0) return;

    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];

      // Project from sky sphere (60 units away, like the existing celestial bodies)
      const worldPos = v3add(camPos, v3scale([s.dx, s.dy, s.dz], 60));
      const sp = projectPoint(mvp, worldPos, hw, hh);
      if (!sp) continue;

      const sx = Math.round(sp[0]);
      const sy = Math.round(sp[1]);
      if (sx < 1 || sx >= w - 1 || sy < 1 || sy >= h - 1) continue;

      // Sparkle modulation
      let bright = s.brightness;
      if (s.sparkle) {
        const phase = s.sparklePhase + totalTime * s.sparkleSpeed;
        bright *= 1 - s.sparkleAmp * 0.5 * (1 + Math.sin(phase));
      }

      const a = alpha * bright;
      if (a < 0.02) continue;

      // Color based on tint
      let cr, cg, cb;
      if (s.tint === 1) {        // warm
        cr = 255; cg = 220; cb = 170;
      } else if (s.tint === 2) {  // cool
        cr = 180; cg = 200; cb = 255;
      } else {                    // neutral
        cr = 240; cg = 238; cb = 245;
      }

      // Draw based on size band
      if (s.size === 0) {
        // Tiny: single pixel
        const idx = (sy * w + sx) * 4;
        pixels[idx]     = lerp(pixels[idx],     cr, a * 0.6) | 0;
        pixels[idx + 1] = lerp(pixels[idx + 1], cg, a * 0.6) | 0;
        pixels[idx + 2] = lerp(pixels[idx + 2], cb, a * 0.6) | 0;
      } else if (s.size === 1) {
        // Small: bright single pixel
        const idx = (sy * w + sx) * 4;
        pixels[idx]     = lerp(pixels[idx],     cr, a * 0.85) | 0;
        pixels[idx + 1] = lerp(pixels[idx + 1], cg, a * 0.85) | 0;
        pixels[idx + 2] = lerp(pixels[idx + 2], cb, a * 0.85) | 0;
      } else {
        // Medium: plus pattern (center + 4 arms)
        const core = a * 0.9;
        const arm  = a * 0.35;
        const offsets = [[0, 0, core], [1, 0, arm], [-1, 0, arm], [0, 1, arm], [0, -1, arm]];
        for (const [ox, oy, fa] of offsets) {
          const px = sx + ox, py = sy + oy;
          if (px < 0 || px >= w || py < 0 || py >= h) continue;
          const idx = (py * w + px) * 4;
          pixels[idx]     = lerp(pixels[idx],     cr, fa) | 0;
          pixels[idx + 1] = lerp(pixels[idx + 1], cg, fa) | 0;
          pixels[idx + 2] = lerp(pixels[idx + 2], cb, fa) | 0;
        }
      }
    }
  }

  // ── moon ──

  _drawMoon(pixels, w, h, mvp, hw, hh, camPos, nightness, sunDir) {
    if (nightness < 0.15) return;

    // Moon direction — opposite the sun, high arc
    const moonDir = v3norm([
      -sunDir[0],
      Math.max(0.2, Math.sin((1 - nightness) * Math.PI * 0.5)),
      -sunDir[2] + 0.5
    ]);
    const moonWorld = v3add(camPos, v3scale(moonDir, 60));
    const sp = projectPoint(mvp, moonWorld, hw, hh);
    if (!sp) return;

    const cx = sp[0], cy = sp[1];
    const alpha = clamp((nightness - 0.15) / 0.25, 0, 1);

    // Radii — large moon
    const rCore = 11;     // solid disc
    const rMid  = 20;     // inner glow
    const rOuter = 38;    // outer halo

    for (let y = Math.max(0, Math.floor(cy - rOuter)); y <= Math.min(h - 1, Math.ceil(cy + rOuter)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rOuter)); x <= Math.min(w - 1, Math.ceil(cx + rOuter)); x++) {
        const dx = x - cx, dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > rOuter) continue;

        const idx = (y * w + x) * 4;

        if (d < rCore) {
          // Solid disc with surface detail
          const nx = dx / rCore, ny = dy / rCore;

          // Multi-octave pseudo-noise for maria (dark patches)
          const n1 = moonNoise(nx, ny, 2.5);
          const n2 = moonNoise(nx + 5.3, ny + 3.7, 5.0) * 0.5;
          const n3 = moonNoise(nx + 13.1, ny + 17.3, 9.0) * 0.25;
          const detail = (n1 + n2 + n3) / 1.75;

          // Limb darkening — subtly darker at edges
          const limb = 1 - (d / rCore) * (d / rCore) * 0.25;

          // Base moon color: cool off-white
          const mr = (215 + detail * 30) * limb;
          const mg = (220 + detail * 20) * limb;
          const mb = (230 + detail * 10) * limb;

          const a = alpha * 0.92;
          pixels[idx]     = lerp(pixels[idx],     mr, a) | 0;
          pixels[idx + 1] = lerp(pixels[idx + 1], mg, a) | 0;
          pixels[idx + 2] = lerp(pixels[idx + 2], mb, a) | 0;

        } else if (d < rMid) {
          // Inner glow
          const t = (d - rCore) / (rMid - rCore);
          const a = (1 - t * t) * alpha * 0.45;
          pixels[idx]     = lerp(pixels[idx],     200, a) | 0;
          pixels[idx + 1] = lerp(pixels[idx + 1], 210, a) | 0;
          pixels[idx + 2] = lerp(pixels[idx + 2], 235, a) | 0;

        } else {
          // Outer halo — very soft
          const t = (d - rMid) / (rOuter - rMid);
          const a = (1 - t) * (1 - t) * alpha * 0.12;
          pixels[idx]     = lerp(pixels[idx],     160, a) | 0;
          pixels[idx + 1] = lerp(pixels[idx + 1], 170, a) | 0;
          pixels[idx + 2] = lerp(pixels[idx + 2], 210, a) | 0;
        }
      }
    }
  }

  // ── meteors ──

  _drawMeteors(pixels, w, h, nightness) {
    if (nightness < 0.2) return;
    const alpha = clamp((nightness - 0.2) / 0.3, 0, 1);

    for (const m of this.meteors) {
      const progress = 1 - m.life / m.maxLife;       // 0 → 1 over lifetime
      const fadeIn  = clamp(progress * 5, 0, 1);     // quick fade-in
      const fadeOut = clamp(m.life / (m.maxLife * 0.3), 0, 1); // fade last 30%
      const bright = m.brightness * fadeIn * fadeOut * alpha;
      if (bright < 0.02) continue;

      // Normalize velocity for tail direction
      const vlen = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
      if (vlen < 0.1) continue;
      const ndx = m.vx / vlen, ndy = m.vy / vlen;

      // Draw tail (series of pixels trailing behind the head)
      const steps = Math.ceil(m.tailLen);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;                          // 0 = head, 1 = tail end
        const px = Math.round(m.sx - ndx * s);
        const py = Math.round(m.sy - ndy * s);
        if (px < 0 || px >= w || py < 0 || py >= h) continue;

        const intensity = bright * (1 - t * t);      // quadratic falloff along tail
        if (intensity < 0.01) continue;

        const idx = (py * w + px) * 4;
        // Head is white, tail fades to warm yellow
        const cr = lerp(255, 255, t);
        const cg = lerp(252, 220, t);
        const cb = lerp(245, 140, t);
        pixels[idx]     = lerp(pixels[idx],     cr, intensity) | 0;
        pixels[idx + 1] = lerp(pixels[idx + 1], cg, intensity) | 0;
        pixels[idx + 2] = lerp(pixels[idx + 2], cb, intensity) | 0;
      }
    }
  }
}
