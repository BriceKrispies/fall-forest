/**
 * 3D rain particle system.
 *
 * Drops exist in world space around the camera, fall with gravity, and are
 * projected through the MVP matrix like every other object in the scene.
 * Drops behind trees/geometry are occluded by the depth buffer.
 *
 * Driven by `rainIntensity` (0-1) from the world mode resolved state.
 */

import { projectPoint, lerp } from './math.js';

const MAX_DROPS = 300;
const SPAWN_RADIUS = 8;       // horizontal spread around camera
const SPAWN_HEIGHT = 7;       // spawn above camera eye
const FALL_SPEED_MIN = 6;     // units/s
const FALL_SPEED_MAX = 10;
const DROP_LENGTH = 0.35;     // world-space streak length

export class Rain {
  constructor() {
    this.drops = new Float32Array(MAX_DROPS * 5); // x, y, z, speed, life
    this.active = 0;
    this.intensity = 0;
  }

  update(dt, targetIntensity, camX, camY, camZ) {
    // Smooth intensity
    const speed = targetIntensity > this.intensity ? 3.0 : 1.5;
    this.intensity = lerp(this.intensity, targetIntensity, 1 - Math.exp(-speed * dt));
    if (this.intensity < 0.005) {
      this.intensity = 0;
      this.active = 0;
      return;
    }

    const target = Math.floor(MAX_DROPS * this.intensity);
    const d = this.drops;

    // Update existing drops
    for (let i = 0; i < this.active; i++) {
      const o = i * 5;
      d[o + 1] -= d[o + 3] * dt;   // y -= speed * dt
      d[o + 4] -= dt;               // life -= dt

      // If dead or fell below ground, respawn near camera
      if (d[o + 4] <= 0 || d[o + 1] < -1) {
        this._spawn(o, camX, camY, camZ);
      }
    }

    // Grow or shrink pool
    if (this.active < target) {
      // Spawn new drops spread out vertically so they don't all start at the top
      const toAdd = Math.min(target - this.active, 20); // throttle spawns per frame
      for (let i = 0; i < toAdd; i++) {
        const o = this.active * 5;
        this._spawn(o, camX, camY, camZ);
        // Randomize initial y so new drops don't appear as a wave
        d[o + 1] = camY + Math.random() * SPAWN_HEIGHT;
        this.active++;
      }
    } else if (this.active > target) {
      this.active = target;
    }
  }

  _spawn(o, camX, camY, camZ) {
    const d = this.drops;
    d[o]     = camX + (Math.random() - 0.5) * SPAWN_RADIUS * 2;
    d[o + 1] = camY + SPAWN_HEIGHT + Math.random() * 3;
    d[o + 2] = camZ + (Math.random() - 0.5) * SPAWN_RADIUS * 2;
    d[o + 3] = FALL_SPEED_MIN + Math.random() * (FALL_SPEED_MAX - FALL_SPEED_MIN);
    d[o + 4] = 1.5 + Math.random() * 2;  // lifetime
  }

  draw(pixels, w, h, depth, mvp, hw, hh) {
    if (this.active <= 0) return;

    const d = this.drops;
    const alpha = this.intensity;

    for (let i = 0; i < this.active; i++) {
      const o = i * 5;
      const x = d[o], y = d[o + 1], z = d[o + 2];

      // Project top and bottom of the streak
      const pTop = projectPoint(mvp, [x, y, z], hw, hh);
      if (!pTop) continue;
      const pBot = projectPoint(mvp, [x, y - DROP_LENGTH, z], hw, hh);
      if (!pBot) continue;

      const sx = Math.round(pTop[0]);
      const syTop = Math.round(pTop[1]);
      const syBot = Math.round(pBot[1]);
      const sz = pTop[2];

      if (sx < 0 || sx >= w) continue;
      const y0 = Math.max(0, Math.min(syTop, syBot));
      const y1 = Math.min(h - 1, Math.max(syTop, syBot));
      const steps = y1 - y0;
      if (steps <= 0) continue;

      for (let py = y0; py <= y1; py++) {
        const di = py * w + sx;
        // Depth test — drops behind geometry are hidden
        if (sz > depth[di]) continue;

        const t = steps > 0 ? (py - y0) / steps : 1;    // 0=top, 1=bottom
        const a = alpha * (0.12 + t * 0.22);             // brighter toward bottom (head)

        const idx = di * 4;
        pixels[idx]     = lerp(pixels[idx],     185, a) | 0;
        pixels[idx + 1] = lerp(pixels[idx + 1], 195, a) | 0;
        pixels[idx + 2] = lerp(pixels[idx + 2], 210, a) | 0;
      }
    }
  }
}
