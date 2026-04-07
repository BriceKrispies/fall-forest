/**
 * Screen-space rain particle system.
 *
 * Maintains a pool of falling streaks. Each streak has a position, speed,
 * length, and brightness. Drawn directly into the pixel buffer as vertical
 * lines after all scene geometry — like looking through a rain curtain.
 *
 * Driven by `rainIntensity` (0-1) from the world mode resolved state.
 * At 0 the pool drains and nothing draws. At 1 the pool fills to capacity.
 */

import { lerp } from './math.js';

const MAX_DROPS = 280;

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function spawnDrop(w, h, i) {
  return {
    x:    Math.random() * w,
    y:    Math.random() * h,
    speed: 180 + Math.random() * 260,        // px/s — fast rain
    len:   3 + Math.random() * 6,             // streak length in pixels
    bright: 0.15 + Math.random() * 0.25,      // subtle, not glaring
    drift: (Math.random() - 0.5) * 18,        // slight horizontal wind
  };
}

export class Rain {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.drops = [];
    this.intensity = 0;         // current smoothed intensity
  }

  update(dt, targetIntensity) {
    // Smooth intensity transitions so rain fades in/out
    const speed = targetIntensity > this.intensity ? 3.0 : 1.5;  // fade in faster
    this.intensity = lerp(this.intensity, targetIntensity, 1 - Math.exp(-speed * dt));
    if (this.intensity < 0.005) {
      this.intensity = 0;
      this.drops.length = 0;
      return;
    }

    // Target drop count based on intensity
    const target = Math.floor(MAX_DROPS * this.intensity);

    // Spawn new drops if needed
    while (this.drops.length < target) {
      this.drops.push(spawnDrop(this.w, this.h, this.drops.length));
    }
    // Remove excess
    if (this.drops.length > target) {
      this.drops.length = target;
    }

    // Advance existing drops
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.y += d.speed * dt;
      d.x += d.drift * dt;

      // Respawn when off screen
      if (d.y > this.h + d.len) {
        d.y = -d.len - Math.random() * 20;
        d.x = Math.random() * this.w;
        d.speed = 180 + Math.random() * 260;
        d.len = 3 + Math.random() * 6;
        d.bright = 0.15 + Math.random() * 0.25;
        d.drift = (Math.random() - 0.5) * 18;
      }
      // Wrap horizontally
      if (d.x < 0) d.x += this.w;
      if (d.x >= this.w) d.x -= this.w;
    }
  }

  draw(pixels, w, h) {
    if (this.intensity < 0.005) return;

    const alpha = this.intensity;

    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      const sx = Math.round(d.x);
      if (sx < 0 || sx >= w) continue;

      const yStart = Math.max(0, Math.round(d.y - d.len));
      const yEnd   = Math.min(h - 1, Math.round(d.y));
      const steps  = yEnd - yStart;
      if (steps <= 0) continue;

      for (let py = yStart; py <= yEnd; py++) {
        const t = (py - yStart) / steps;     // 0 at tail, 1 at head
        const a = d.bright * alpha * (0.3 + t * 0.7);  // brighter at head
        const idx = (py * w + sx) * 4;

        // Rain color: pale blue-white
        pixels[idx]     = lerp(pixels[idx],     190, a) | 0;
        pixels[idx + 1] = lerp(pixels[idx + 1], 200, a) | 0;
        pixels[idx + 2] = lerp(pixels[idx + 2], 215, a) | 0;
      }
    }
  }
}
