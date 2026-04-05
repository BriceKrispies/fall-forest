import { v3add, v3scale, projectPoint, mat4multiply, mat4perspective, mat4lookAt, lerp } from './math.js';
import { v3norm } from './math.js';
import { getF32, LAYOUT } from './wasm-bridge.js';

export const SUN_DIR = v3norm([0.45, 0.75, 0.35]);
const FOG_COLOR = [0.82, 0.78, 0.65];

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
  }

  beginFrame(camPos, camTarget, camUp, fov) {
    this.pixels.fill(0);
    this.depth.fill(1e9);
    const viewMat = mat4lookAt(camPos, camTarget, camUp);
    const projMat = mat4perspective(fov, this.w / this.h, 0.3, 80);
    this.mvp = mat4multiply(projMat, viewMat);

    const fc = FOG_COLOR;
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
    const sunWorld = v3add(camPos, v3scale(SUN_DIR, 60));
    const sp = projectPoint(this.mvp, sunWorld, this.hw, this.hh);
    if (!sp) return;
    const sx = sp[0], sy = sp[1];
    const r1 = 7, r2 = 18, r3 = 30;
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
          pixels[idx] = lerp(255, 255, t) | 0;
          pixels[idx + 1] = lerp(252, 240, t) | 0;
          pixels[idx + 2] = lerp(235, 200, t) | 0;
        } else if (d < r2) {
          const t = (d - r1) / (r2 - r1);
          const a = (1 - t * t) * 0.7;
          pixels[idx] = lerp(pixels[idx], 255, a) | 0;
          pixels[idx + 1] = lerp(pixels[idx + 1], 235, a) | 0;
          pixels[idx + 2] = lerp(pixels[idx + 2], 175, a) | 0;
        } else {
          const t = (d - r2) / (r3 - r2);
          const a = (1 - t) * 0.25;
          pixels[idx] = lerp(pixels[idx], 255, a) | 0;
          pixels[idx + 1] = lerp(pixels[idx + 1], 230, a) | 0;
          pixels[idx + 2] = lerp(pixels[idx + 2], 170, a) | 0;
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

    for (let i = 0; i < visCount; i++) {
      const off = base + i * 12;
      const p0x = f32[off], p0y = f32[off + 1], p0z = f32[off + 2];
      const p1x = f32[off + 3], p1y = f32[off + 4], p1z = f32[off + 5];
      const p2x = f32[off + 6], p2y = f32[off + 7], p2z = f32[off + 8];
      const cr = (f32[off + 9] * 255) | 0;
      const cg = (f32[off + 10] * 255) | 0;
      const cb = (f32[off + 11] * 255) | 0;

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

  drawGrassBlade(blade) {
    const baseP = projectPoint(this.mvp, [blade.x, blade.y, blade.z], this.hw, this.hh);
    if (!baseP) return;
    const tipP = projectPoint(this.mvp, [blade.x + blade.sway, blade.y + blade.height, blade.z], this.hw, this.hh);
    if (!tipP) return;
    const bx = Math.round(baseP[0]), by = Math.round(baseP[1]);
    const tx = Math.round(tipP[0]), ty = Math.round(tipP[1]);
    if (bx < 0 || bx >= this.w || by < 0 || by >= this.h) return;
    if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) return;
    const steps = Math.max(Math.abs(tx - bx), Math.abs(ty - by), 1);
    const gr = 65, gg = 110, gb = 45;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = Math.round(bx + (tx - bx) * t);
      const py = Math.round(by + (ty - by) * t);
      if (px < 0 || px >= this.w || py < 0 || py >= this.h) continue;
      const idx = (py * this.w + px) * 4;
      const a = 0.5 + t * 0.3;
      this.pixels[idx] = this.pixels[idx] + (gr - this.pixels[idx]) * a;
      this.pixels[idx + 1] = this.pixels[idx + 1] + (gg - this.pixels[idx + 1]) * a;
      this.pixels[idx + 2] = this.pixels[idx + 2] + (gb - this.pixels[idx + 2]) * a;
    }
  }

  drawLeafParticle(leaf) {
    const sp = projectPoint(this.mvp, [leaf.x, leaf.y, leaf.z], this.hw, this.hh);
    if (!sp) return;
    const sx = Math.round(sp[0]), sy = Math.round(sp[1]);
    if (sx < 1 || sx >= this.w - 1 || sy < 1 || sy >= this.h - 1) return;
    const a = leaf.alpha;
    const lr = 180, lg = 140, lb = 60;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx !== 0 && dy !== 0) continue;
        const idx = ((sy + dy) * this.w + (sx + dx)) * 4;
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
    const sx = Math.round(sp[0]), sy = Math.round(sp[1]);
    if (sx < 2 || sx >= this.w - 2 || sy < 2 || sy >= this.h - 2) return;
    const cr = 100, cg = 75, cb = 55;
    const bodyPixels = [[0,0],[1,0],[-1,0],[0,-1]];
    for (const [dx, dy] of bodyPixels) {
      const idx = ((sy + dy) * this.w + (sx + dx)) * 4;
      this.pixels[idx] = cr;
      this.pixels[idx + 1] = cg;
      this.pixels[idx + 2] = cb;
    }
  }
}
