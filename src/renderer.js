import { v3add, v3scale, projectPoint, mat4multiply, mat4perspective, mat4lookAt, lerp, clamp } from './math.js';
import { v3norm } from './math.js';
import { getF32, LAYOUT } from './wasm-bridge.js';

export const DEFAULT_SUN_DIR = v3norm([0.45, 0.75, 0.35]);

// Creature pixel patterns — keyed by mode's creatureShape value
const CREATURE_SHAPES = {
  default: [[0, 0], [1, 0], [-1, 0], [0, -1]],
  horned:  [[0, 0], [1, 0], [-1, 0], [0, -1], [-1, -2], [1, -2]],
};

export class Renderer {
  constructor(canvas, w, h) {
    this.canvas = canvas;
    this.w = w;
    this.h = h;
    canvas.width = w;
    canvas.height = h;
    this.ctx = canvas.getContext('2d');
    this.img = this.ctx.createImageData(w, h);
    this.pixels = this.img.data;
    this.depth = new Float32Array(w * h);
    this.hw = w / 2;
    this.hh = h / 2;
    this.mvp = null;
    this.fogColor = [0.82, 0.78, 0.65];
    this.ambientTint = [1, 1, 1];
    this.ambientLevel = 1.0;
    this.sunDir = DEFAULT_SUN_DIR;
    this.sunTint = [1, 1, 1];
    this.sunVisible = true;
    this.nightness = 0;
    this.creatureColor = null;
    this.creatureShape = null;
  }

  setLighting(resolved) {
    this.fogColor = resolved.fogColor;
    this.ambientTint = resolved.ambientTint || (resolved.getAmbientTint ? resolved.getAmbientTint() : [1, 1, 1]);
    this.ambientLevel = resolved.ambientLevel;
    this.sunDir = resolved.sunDir;
    this.sunTint = resolved.sunTint;
    this.sunVisible = resolved.sunVisible;
    this.nightness = resolved.nightness;
    this.creatureColor = resolved.creatureColor || null;
    this.creatureShape = resolved.creatureShape || null;
    this.lampColor = resolved.lampColor || null;
  }

  beginFrame(camPos, camTarget, camUp, fov) {
    this.pixels.fill(0);
    this.depth.fill(1e9);
    const viewMat = mat4lookAt(camPos, camTarget, camUp);
    const projMat = mat4perspective(fov, this.w / this.h, 0.3, 80);
    this.mvp = mat4multiply(projMat, viewMat);

    const fc = this.fogColor;
    const r = (fc[0] * 255) | 0, g = (fc[1] * 255) | 0, b = (fc[2] * 255) | 0;
    for (let i = 0; i < this.w * this.h; i++) {
      const idx = i * 4;
      this.pixels[idx] = r;
      this.pixels[idx + 1] = g;
      this.pixels[idx + 2] = b;
      this.pixels[idx + 3] = 255;
    }

    return this.mvp;
  }

  endFrame() {
    this.ctx.putImageData(this.img, 0, 0);
  }

  drawSun(camPos) {
    if (!this.sunVisible) return;

    const sunWorld = v3add(camPos, v3scale(this.sunDir, 60));
    const sp = projectPoint(this.mvp, sunWorld, this.hw, this.hh);
    if (!sp) return;
    const sx = sp[0], sy = sp[1];

    // Sun gets bigger/redder near horizon
    const horizonFactor = clamp(this.sunDir[1] * 3, 0, 1);
    const r1 = 7 + (1 - horizonFactor) * 3;
    const r2 = 18 + (1 - horizonFactor) * 5;
    const r3 = 30 + (1 - horizonFactor) * 8;

    const tint = this.sunTint;
    const coreR = 255 * tint[0], coreG = 252 * tint[1], coreB = 235 * tint[2];
    const glowR = 255 * tint[0], glowG = 235 * tint[1], glowB = 175 * tint[2];

    const pixels = this.pixels;
    const w = this.w, h = this.h;
    for (let y = Math.max(0, Math.floor(sy - r3)); y <= Math.min(h - 1, Math.ceil(sy + r3)); y++) {
      for (let x = Math.max(0, Math.floor(sx - r3)); x <= Math.min(w - 1, Math.ceil(sx + r3)); x++) {
        const dx = x - sx, dy = y - sy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r3) continue;
        const idx = (y * w + x) * 4;
        if (d < r1) {
          const t = d / r1;
          pixels[idx] = lerp(255, coreR, t) | 0;
          pixels[idx + 1] = lerp(252, coreG, t) | 0;
          pixels[idx + 2] = lerp(235, coreB, t) | 0;
        } else if (d < r2) {
          const t = (d - r1) / (r2 - r1);
          const a = (1 - t * t) * 0.7;
          pixels[idx] = lerp(pixels[idx], glowR, a) | 0;
          pixels[idx + 1] = lerp(pixels[idx + 1], glowG, a) | 0;
          pixels[idx + 2] = lerp(pixels[idx + 2], glowB, a) | 0;
        } else {
          const t = (d - r2) / (r3 - r2);
          const a = (1 - t) * 0.25;
          pixels[idx] = lerp(pixels[idx], glowR, a) | 0;
          pixels[idx + 1] = lerp(pixels[idx + 1], glowG, a) | 0;
          pixels[idx + 2] = lerp(pixels[idx + 2], glowB, a) | 0;
        }
      }
    }
  }

  drawMoon(camPos) {
    if (this.nightness < 0.2) return;

    // Moon is opposite the sun
    const moonDir = v3norm([-this.sunDir[0], Math.max(0.15, Math.sin((1 - this.nightness) * Math.PI * 0.5)), -this.sunDir[2] + 0.5]);
    const moonWorld = v3add(camPos, v3scale(moonDir, 60));
    const sp = projectPoint(this.mvp, moonWorld, this.hw, this.hh);
    if (!sp) return;

    const sx = sp[0], sy = sp[1];
    const alpha = clamp((this.nightness - 0.2) / 0.3, 0, 1);
    const r1 = 4, r2 = 8;
    const pixels = this.pixels;
    const w = this.w, h = this.h;

    for (let y = Math.max(0, Math.floor(sy - r2)); y <= Math.min(h - 1, Math.ceil(sy + r2)); y++) {
      for (let x = Math.max(0, Math.floor(sx - r2)); x <= Math.min(w - 1, Math.ceil(sx + r2)); x++) {
        const dx = x - sx, dy = y - sy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r2) continue;
        const idx = (y * w + x) * 4;
        if (d < r1) {
          const a = alpha * 0.85;
          pixels[idx] = lerp(pixels[idx], 220, a) | 0;
          pixels[idx + 1] = lerp(pixels[idx + 1], 225, a) | 0;
          pixels[idx + 2] = lerp(pixels[idx + 2], 240, a) | 0;
        } else {
          const t = (d - r1) / (r2 - r1);
          const a = (1 - t * t) * alpha * 0.3;
          pixels[idx] = lerp(pixels[idx], 200, a) | 0;
          pixels[idx + 1] = lerp(pixels[idx + 1], 210, a) | 0;
          pixels[idx + 2] = lerp(pixels[idx + 2], 235, a) | 0;
        }
      }
    }
  }

  rasterizeWasmOutput(visCount) {
    const f32 = getF32();
    const base = LAYOUT.OFF_TRI_OUT >> 2;
    const w = this.w, h = this.h;
    const pixels = this.pixels;
    const depth = this.depth;
    const tR = this.ambientTint[0], tG = this.ambientTint[1], tB = this.ambientTint[2];
    const amb = this.ambientLevel;

    for (let i = 0; i < visCount; i++) {
      const off = base + i * 12;
      const p0x = f32[off], p0y = f32[off + 1], p0z = f32[off + 2];
      const p1x = f32[off + 3], p1y = f32[off + 4], p1z = f32[off + 5];
      const p2x = f32[off + 6], p2y = f32[off + 7], p2z = f32[off + 8];
      const cr = (f32[off + 9] * amb * tR * 255) | 0;
      const cg = (f32[off + 10] * amb * tG * 255) | 0;
      const cb = (f32[off + 11] * amb * tB * 255) | 0;

      let minX = Math.max(0, Math.floor(Math.min(p0x, p1x, p2x)));
      let maxX = Math.min(w - 1, Math.ceil(Math.max(p0x, p1x, p2x)));
      let minY = Math.max(0, Math.floor(Math.min(p0y, p1y, p2y)));
      let maxY = Math.min(h - 1, Math.ceil(Math.max(p0y, p1y, p2y)));

      if (minX > maxX || minY > maxY) continue;
      if (maxX - minX > w || maxY - minY > h) continue;

      const dx01 = p1x - p0x, dy01 = p1y - p0y;
      const dx02 = p2x - p0x, dy02 = p2y - p0y;
      const denom = dx01 * dy02 - dx02 * dy01;
      if (denom > -0.001 && denom < 0.001) continue;
      const invDenom = 1 / denom;

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x - p0x, dy = y - p0y;
          const u = (dx * dy02 - dx02 * dy) * invDenom;
          const v = (dx01 * dy - dx * dy01) * invDenom;
          if (u < 0 || v < 0 || u + v > 1) continue;

          const z = p0z + u * (p1z - p0z) + v * (p2z - p0z);
          const idx = y * w + x;
          if (z < depth[idx]) {
            depth[idx] = z;
            const pi = idx * 4;
            pixels[pi] = cr;
            pixels[pi + 1] = cg;
            pixels[pi + 2] = cb;
          }
        }
      }
    }
  }

  drawDynamicTris(tris, emissive) {
    const w = this.w, h = this.h;
    const pixels = this.pixels, depth = this.depth;
    // Emissive tris (like fire) are not affected by ambient
    const tR = emissive ? 1 : this.ambientTint[0] * this.ambientLevel;
    const tG = emissive ? 1 : this.ambientTint[1] * this.ambientLevel;
    const tB = emissive ? 1 : this.ambientTint[2] * this.ambientLevel;
    for (let i = 0; i < tris.length; i++) {
      const [v0, v1, v2, color] = tris[i];
      const p0 = projectPoint(this.mvp, v0, this.hw, this.hh);
      const p1 = projectPoint(this.mvp, v1, this.hw, this.hh);
      const p2 = projectPoint(this.mvp, v2, this.hw, this.hh);
      if (!p0 || !p1 || !p2) continue;
      const cr = Math.min(255, (color[0] * tR * 255) | 0);
      const cg = Math.min(255, (color[1] * tG * 255) | 0);
      const cb = Math.min(255, (color[2] * tB * 255) | 0);
      let minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
      let maxX = Math.min(w - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
      let minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
      let maxY = Math.min(h - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
      if (minX > maxX || minY > maxY) continue;
      if (maxX - minX > w || maxY - minY > h) continue;
      const dx01 = p1[0] - p0[0], dy01 = p1[1] - p0[1];
      const dx02 = p2[0] - p0[0], dy02 = p2[1] - p0[1];
      const denom = dx01 * dy02 - dx02 * dy01;
      if (denom > -0.001 && denom < 0.001) continue;
      const invD = 1 / denom;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x - p0[0], dy = y - p0[1];
          const u = (dx * dy02 - dx02 * dy) * invD;
          const v = (dx01 * dy - dx * dy01) * invD;
          if (u < 0 || v < 0 || u + v > 1) continue;
          const z = p0[2] + u * (p1[2] - p0[2]) + v * (p2[2] - p0[2]);
          const idx = y * w + x;
          if (z < depth[idx]) {
            depth[idx] = z;
            const pi = idx * 4;
            pixels[pi] = cr; pixels[pi + 1] = cg; pixels[pi + 2] = cb;
          }
        }
      }
    }
  }

  drawFireGlow(firePosWorld, camPos) {
    const sp = projectPoint(this.mvp, [firePosWorld[0], firePosWorld[1] + 0.3, firePosWorld[2]], this.hw, this.hh);
    if (!sp) return;
    const dx = firePosWorld[0] - camPos[0], dz = firePosWorld[2] - camPos[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 30) return;
    const sx = sp[0], sy = sp[1], sz = sp[2];
    // Glow is stronger at night but capped to stay restrained
    const nightBoost = 1 + this.nightness * 1.2;
    const intensity = Math.max(0, 1 - dist / (18 * nightBoost)) * nightBoost;
    const r = Math.round(10 + intensity * 6);
    const pixels = this.pixels;
    const depth = this.depth;
    const w = this.w, h = this.h;
    for (let y = Math.max(0, Math.floor(sy - r)); y <= Math.min(h - 1, Math.ceil(sy + r)); y++) {
      for (let x = Math.max(0, Math.floor(sx - r)); x <= Math.min(w - 1, Math.ceil(sx + r)); x++) {
        // Only glow on pixels at or behind the fire's depth — no bleed through geometry
        const di = y * w + x;
        if (depth[di] < sz - 0.5) continue;
        const ddx = x - sx, ddy = y - sy;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d > r) continue;
        const t = 1 - d / r;
        const a = t * t * intensity * 0.35;
        const idx = di * 4;
        pixels[idx] = Math.min(255, pixels[idx] + (255 - pixels[idx]) * a * 1.0) | 0;
        pixels[idx + 1] = Math.min(255, pixels[idx + 1] + (180 - pixels[idx + 1]) * a * 0.7) | 0;
        pixels[idx + 2] = Math.min(255, pixels[idx + 2] + (60 - pixels[idx + 2]) * a * 0.3) | 0;
      }
    }
  }

  drawLampGlow(lampPosWorld, camPos, time) {
    // Lamp housing is at y + 1.86 (stem 1.6 + base 0.11 + housing midpoint 0.15)
    const lampY = lampPosWorld[1] + 1.86;
    const sp = projectPoint(this.mvp, [lampPosWorld[0], lampY, lampPosWorld[2]], this.hw, this.hh);
    if (!sp) return;
    const dx = lampPosWorld[0] - camPos[0], dz = lampPosWorld[2] - camPos[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 25) return;
    const sx = sp[0], sy = sp[1], sz = sp[2];

    // Subtle flicker
    const flicker = 0.92 + Math.sin(time * 2.3) * 0.04 + Math.sin(time * 5.7) * 0.04;

    // Lamp color from world mode (default warm amber)
    const lc = this.lampColor || [255, 200, 100];

    const nightBoost = 1 + this.nightness * 0.8;
    const intensity = Math.max(0, 1 - dist / (14 * nightBoost)) * nightBoost * flicker;
    const r = Math.round(6 + intensity * 4);
    const pixels = this.pixels;
    const depth = this.depth;
    const w = this.w, h = this.h;
    for (let y = Math.max(0, Math.floor(sy - r)); y <= Math.min(h - 1, Math.ceil(sy + r)); y++) {
      for (let x = Math.max(0, Math.floor(sx - r)); x <= Math.min(w - 1, Math.ceil(sx + r)); x++) {
        const di = y * w + x;
        if (depth[di] < sz - 0.5) continue;
        const ddx = x - sx, ddy = y - sy;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d > r) continue;
        const t = 1 - d / r;
        const a = t * t * intensity * 0.25;
        const idx = di * 4;
        pixels[idx]     = Math.min(255, pixels[idx]     + (lc[0] - pixels[idx])     * a) | 0;
        pixels[idx + 1] = Math.min(255, pixels[idx + 1] + (lc[1] - pixels[idx + 1]) * a) | 0;
        pixels[idx + 2] = Math.min(255, pixels[idx + 2] + (lc[2] - pixels[idx + 2]) * a) | 0;
      }
    }

    // Ground light pool — screen-space radial blend around projected lamp base
    const groundP = projectPoint(this.mvp, [lampPosWorld[0], lampPosWorld[1] + 0.02, lampPosWorld[2]], this.hw, this.hh);
    if (groundP) {
      const gsx = groundP[0], gsy = groundP[1], gsz = groundP[2];
      const gr = Math.round(8 + intensity * 5);
      const groundIntensity = intensity * 0.15;
      for (let gy = Math.max(0, Math.floor(gsy - gr)); gy <= Math.min(h - 1, Math.ceil(gsy + gr)); gy++) {
        for (let gx = Math.max(0, Math.floor(gsx - gr)); gx <= Math.min(w - 1, Math.ceil(gsx + gr)); gx++) {
          const gdi = gy * w + gx;
          if (depth[gdi] < gsz - 0.5) continue;
          const gdx = gx - gsx, gdy = gy - gsy;
          const gd = Math.sqrt(gdx * gdx + gdy * gdy);
          if (gd > gr) continue;
          const gt = 1 - gd / gr;
          const ga = gt * gt * groundIntensity;
          const gidx = gdi * 4;
          pixels[gidx]     = Math.min(255, pixels[gidx]     + (lc[0] - pixels[gidx])     * ga) | 0;
          pixels[gidx + 1] = Math.min(255, pixels[gidx + 1] + (lc[1] - pixels[gidx + 1]) * ga) | 0;
          pixels[gidx + 2] = Math.min(255, pixels[gidx + 2] + (lc[2] - pixels[gidx + 2]) * ga) | 0;
        }
      }
    }
  }

  drawFireShadows(shadows) {
    const w = this.w, h = this.h;
    const pixels = this.pixels, depth = this.depth;

    for (const s of shadows) {
      const y = s.gy + 0.016;
      const segs = 6;
      const pts = [];
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2 + s.angle;
        pts.push([s.cx + Math.cos(a) * s.rx, y, s.cz + Math.sin(a) * s.rz]);
      }

      // Project and rasterize each triangle of the shadow fan
      const cp = projectPoint(this.mvp, [s.cx, y, s.cz], this.hw, this.hh);
      if (!cp) continue;

      for (let i = 0; i < segs; i++) {
        const p1 = projectPoint(this.mvp, pts[i], this.hw, this.hh);
        const p2 = projectPoint(this.mvp, pts[(i + 1) % segs], this.hw, this.hh);
        if (!p1 || !p2) continue;

        let minX = Math.max(0, Math.floor(Math.min(cp[0], p1[0], p2[0])));
        let maxX = Math.min(w - 1, Math.ceil(Math.max(cp[0], p1[0], p2[0])));
        let minY = Math.max(0, Math.floor(Math.min(cp[1], p1[1], p2[1])));
        let maxY = Math.min(h - 1, Math.ceil(Math.max(cp[1], p1[1], p2[1])));
        if (minX > maxX || minY > maxY) continue;
        if (maxX - minX > w || maxY - minY > h) continue;

        const dx01 = p1[0] - cp[0], dy01 = p1[1] - cp[1];
        const dx02 = p2[0] - cp[0], dy02 = p2[1] - cp[1];
        const denom = dx01 * dy02 - dx02 * dy01;
        if (denom > -0.001 && denom < 0.001) continue;
        const invD = 1 / denom;

        for (let py = minY; py <= maxY; py++) {
          for (let px = minX; px <= maxX; px++) {
            const ddx = px - cp[0], ddy = py - cp[1];
            const u = (ddx * dy02 - dx02 * ddy) * invD;
            const v = (dx01 * ddy - ddx * dy01) * invD;
            if (u < 0 || v < 0 || u + v > 1) continue;

            const z = cp[2] + u * (p1[2] - cp[2]) + v * (p2[2] - cp[2]);
            const di = py * w + px;
            if (z > depth[di] + 0.001) continue;

            const idx = di * 4;
            const a = s.intensity;
            pixels[idx] = (pixels[idx] * (1 - a)) | 0;
            pixels[idx + 1] = (pixels[idx + 1] * (1 - a)) | 0;
            pixels[idx + 2] = (pixels[idx + 2] * (1 - a)) | 0;
          }
        }
      }
    }
  }

  drawGrassBlade(blade) {
    const baseP = projectPoint(this.mvp, [blade.x, blade.y, blade.z], this.hw, this.hh);
    if (!baseP) return;
    const tipP = projectPoint(this.mvp, [blade.x + blade.sway, blade.y + blade.height, blade.z], this.hw, this.hh);
    if (!tipP) return;
    const bx = Math.round(baseP[0]), by = Math.round(baseP[1]), bz = baseP[2];
    const tx = Math.round(tipP[0]), ty = Math.round(tipP[1]), tz = tipP[2];
    if (bx < 0 || bx >= this.w || by < 0 || by >= this.h) return;
    if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) return;
    const steps = Math.max(Math.abs(tx - bx), Math.abs(ty - by), 1);
    const al = this.ambientLevel;
    const gr = (65 * al * this.ambientTint[0]) | 0;
    const gg = (110 * al * this.ambientTint[1]) | 0;
    const gb = (45 * al * this.ambientTint[2]) | 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = Math.round(bx + (tx - bx) * t);
      const py = Math.round(by + (ty - by) * t);
      if (px < 0 || px >= this.w || py < 0 || py >= this.h) continue;
      const di = py * this.w + px;
      const z = bz + (tz - bz) * t;
      if (z > this.depth[di]) continue;
      const idx = di * 4;
      const a = 0.5 + t * 0.3;
      this.pixels[idx] = this.pixels[idx] + (gr - this.pixels[idx]) * a;
      this.pixels[idx + 1] = this.pixels[idx + 1] + (gg - this.pixels[idx + 1]) * a;
      this.pixels[idx + 2] = this.pixels[idx + 2] + (gb - this.pixels[idx + 2]) * a;
    }
  }

  drawLeafParticle(leaf) {
    const sp = projectPoint(this.mvp, [leaf.x, leaf.y, leaf.z], this.hw, this.hh);
    if (!sp) return;
    const sx = Math.round(sp[0]), sy = Math.round(sp[1]), sz = sp[2];
    if (sx < 1 || sx >= this.w - 1 || sy < 1 || sy >= this.h - 1) return;
    const a = leaf.alpha;
    const al = this.ambientLevel;
    const lr = (180 * al * this.ambientTint[0]) | 0;
    const lg = (140 * al * this.ambientTint[1]) | 0;
    const lb = (60 * al * this.ambientTint[2]) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx !== 0 && dy !== 0) continue;
        const di = (sy + dy) * this.w + (sx + dx);
        if (sz > this.depth[di]) continue;
        const idx = di * 4;
        const fa = a * (dx === 0 && dy === 0 ? 0.9 : 0.4);
        this.pixels[idx] = this.pixels[idx] + (lr - this.pixels[idx]) * fa;
        this.pixels[idx + 1] = this.pixels[idx + 1] + (lg - this.pixels[idx + 1]) * fa;
        this.pixels[idx + 2] = this.pixels[idx + 2] + (lb - this.pixels[idx + 2]) * fa;
      }
    }
  }

  drawCreature(creature) {
    const sp = projectPoint(this.mvp, [creature.x, creature.y + 0.08, creature.z], this.hw, this.hh);
    if (!sp) return;
    const sx = Math.round(sp[0]), sy = Math.round(sp[1]), sz = sp[2];
    if (sx < 2 || sx >= this.w - 2 || sy < 2 || sy >= this.h - 2) return;
    const al = this.ambientLevel;
    const base = this.creatureColor || [100, 75, 55];
    const cr = (base[0] * al * this.ambientTint[0]) | 0;
    const cg = (base[1] * al * this.ambientTint[1]) | 0;
    const cb = (base[2] * al * this.ambientTint[2]) | 0;
    const shape = CREATURE_SHAPES[this.creatureShape] || CREATURE_SHAPES.default;
    for (const [dx, dy] of shape) {
      const di = (sy + dy) * this.w + (sx + dx);
      if (sz > this.depth[di]) continue;
      const idx = di * 4;
      this.pixels[idx] = cr;
      this.pixels[idx + 1] = cg;
      this.pixels[idx + 2] = cb;
    }
  }
}
