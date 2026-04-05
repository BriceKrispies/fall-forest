import { v3sub, v3cross, v3norm, v3dot, projectPoint, mat4multiply, mat4perspective, mat4lookAt, clamp, lerp, smoothstep } from './math.js';

const SUN_DIR = v3norm([0.4, 0.8, 0.3]);
const SUN_WARM = [1.0, 0.92, 0.75];
const SKY_COOL = [0.45, 0.55, 0.7];
const AMBIENT = 0.35;
const FOG_NEAR = 8;
const FOG_FAR = 38;
const FOG_COLOR = [0.78, 0.75, 0.62];

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
    this.viewMat = null;
    this.projMat = null;
    this.camPos = [0, 0, 0];
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.img = this.ctx.createImageData(w, h);
    this.pixels = this.img.data;
    this.depth = new Float32Array(w * h);
    this.hw = w / 2;
    this.hh = h / 2;
  }

  beginFrame(camPos, camTarget, camUp, fov) {
    this.camPos = camPos;
    this.pixels.fill(0);
    this.depth.fill(1e9);
    this.viewMat = mat4lookAt(camPos, camTarget, camUp);
    this.projMat = mat4perspective(fov, this.w / this.h, 0.3, 80);
    this.mvp = mat4multiply(this.projMat, this.viewMat);

    const fc = FOG_COLOR;
    for (let i = 0; i < this.w * this.h; i++) {
      const idx = i * 4;
      this.pixels[idx] = (fc[0] * 255) | 0;
      this.pixels[idx+1] = (fc[1] * 255) | 0;
      this.pixels[idx+2] = (fc[2] * 255) | 0;
      this.pixels[idx+3] = 255;
    }
  }

  endFrame() {
    this.ctx.putImageData(this.img, 0, 0);
  }

  drawMesh(tris) {
    for (let i = 0; i < tris.length; i++) {
      this._drawTri(tris[i]);
    }
  }

  _shade(baseColor, normal, centroid) {
    const ndl = clamp(v3dot(normal, SUN_DIR), 0, 1);
    const light = AMBIENT + (1 - AMBIENT) * ndl;

    const r = baseColor[0] * (lerp(SKY_COOL[0], SUN_WARM[0], ndl) * light);
    const g = baseColor[1] * (lerp(SKY_COOL[1], SUN_WARM[1], ndl) * light);
    const b = baseColor[2] * (lerp(SKY_COOL[2], SUN_WARM[2], ndl) * light);

    const dx = centroid[0] - this.camPos[0];
    const dy = centroid[1] - this.camPos[1];
    const dz = centroid[2] - this.camPos[2];
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const fog = smoothstep(FOG_NEAR, FOG_FAR, dist);

    return [
      clamp(lerp(r, FOG_COLOR[0], fog), 0, 1),
      clamp(lerp(g, FOG_COLOR[1], fog), 0, 1),
      clamp(lerp(b, FOG_COLOR[2], fog), 0, 1)
    ];
  }

  _drawTri(tri) {
    const [v0, v1, v2, color] = tri;

    const cx = (v0[0]+v1[0]+v2[0])/3 - this.camPos[0];
    const cz = (v0[2]+v1[2]+v2[2])/3 - this.camPos[2];
    if (cx*cx + cz*cz > 1600) return;

    const edge1 = v3sub(v1, v0);
    const edge2 = v3sub(v2, v0);
    const normal = v3norm(v3cross(edge1, edge2));

    const toCamera = v3sub(this.camPos, v0);
    if (v3dot(normal, toCamera) < 0) return;

    const p0 = projectPoint(this.mvp, v0, this.hw, this.hh);
    const p1 = projectPoint(this.mvp, v1, this.hw, this.hh);
    const p2 = projectPoint(this.mvp, v2, this.hw, this.hh);
    if (!p0 || !p1 || !p2) return;

    const centroid = [cx + this.camPos[0], (v0[1]+v1[1]+v2[1])/3, cz + this.camPos[2]];
    const shaded = this._shade(color, normal, centroid);
    const cr = (shaded[0] * 255) | 0;
    const cg = (shaded[1] * 255) | 0;
    const cb = (shaded[2] * 255) | 0;

    this._rasterTri(p0, p1, p2, cr, cg, cb);
  }

  _rasterTri(p0, p1, p2, cr, cg, cb) {
    const w = this.w, h = this.h;
    let minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    let maxX = Math.min(w - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    let minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    let maxY = Math.min(h - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));

    if (minX > maxX || minY > maxY) return;
    if (maxX - minX > w || maxY - minY > h) return;

    const dx01 = p1[0] - p0[0], dy01 = p1[1] - p0[1];
    const dx02 = p2[0] - p0[0], dy02 = p2[1] - p0[1];
    const denom = dx01 * dy02 - dx02 * dy01;
    if (Math.abs(denom) < 0.001) return;
    const invDenom = 1 / denom;

    const pixels = this.pixels;
    const depth = this.depth;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - p0[0], dy = y - p0[1];
        const u = (dx * dy02 - dx02 * dy) * invDenom;
        const v = (dx01 * dy - dx * dy01) * invDenom;
        if (u < 0 || v < 0 || u + v > 1) continue;

        const z = p0[2] + u * (p1[2] - p0[2]) + v * (p2[2] - p0[2]);
        const idx = y * w + x;
        if (z < depth[idx]) {
          depth[idx] = z;
          const pi = idx * 4;
          pixels[pi] = cr;
          pixels[pi+1] = cg;
          pixels[pi+2] = cb;
        }
      }
    }
  }
}
