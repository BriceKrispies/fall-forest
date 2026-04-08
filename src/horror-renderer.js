/**
 * Horror renderer — reads simulated horror segments from WASM and
 * produces procedural geometry (tris) for the existing software renderer.
 *
 * Each segment type maps to a visual motif:
 *   core    → clustered pyramids / irregular mass
 *   tendril → tapered triangle strip between parent and child
 *   eye     → radial disc with pupil
 *   tooth   → sharp wedge pointing outward
 *   sucker  → concave cup shape
 *   ring    → small radial element on orbit path
 *   spine   → protruding spike
 *
 * All geometry feeds through renderer.drawDynamicTris().
 */

import { readHorrorSegments } from './wasm-bridge.js';

const SEG_CORE    = 0;
const SEG_TENDRIL = 1;
const SEG_EYE     = 2;
const SEG_TOOTH   = 3;
const SEG_SUCKER  = 4;
const SEG_RING    = 5;
const SEG_SPINE   = 6;

// ── Color palettes ──

function lerpC(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function colorForType(type, colorBias, phase) {
  // Base horror palette — dark reds, blacks, sickly yellows
  const bias = colorBias || [1, 0.3, 0.15];
  const phaseShift = Math.sin(phase * 0.3) * 0.05;
  switch (type) {
    case SEG_CORE:
      return [0.18 + phaseShift, 0.06, 0.04];
    case SEG_TENDRIL:
      return [0.25 * bias[0] + phaseShift, 0.08 * bias[1], 0.06 * bias[2]];
    case SEG_EYE:
      return [0.85, 0.82, 0.55]; // sickly yellow-white iris
    case SEG_TOOTH:
      return [0.75, 0.72, 0.60]; // bone/ivory
    case SEG_SUCKER:
      return [0.30 * bias[0], 0.12 * bias[1], 0.10 * bias[2]];
    case SEG_RING:
      return [0.60 * bias[0], 0.20 * bias[1], 0.08 * bias[2]];
    case SEG_SPINE:
      return [0.22 + phaseShift, 0.08, 0.05];
    default:
      return [0.2, 0.08, 0.05];
  }
}

// ── Geometry builders ──

/**
 * Build a tapered quad strip between two points (parent → child).
 * Returns array of [v0, v1, v2, color] tris.
 */
function buildTendrilStrip(parentSeg, childSeg, color) {
  const tris = [];
  const dx = childSeg.x - parentSeg.x;
  const dy = childSeg.y - parentSeg.y;
  const dz = childSeg.z - parentSeg.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.001) return tris;

  // Two perpendicular directions for a cross-section strip
  // Lateral (horizontal) perpendicular
  let nx = -dz, nz = dx;
  const nl = Math.sqrt(nx * nx + nz * nz);
  if (nl > 0.001) { nx /= nl; nz /= nl; }
  else { nx = 1; nz = 0; }

  const w0 = parentSeg.size;
  const w1 = childSeg.size * 0.7;

  // Horizontal strip
  const a = [parentSeg.x + nx * w0, parentSeg.y, parentSeg.z + nz * w0];
  const b = [parentSeg.x - nx * w0, parentSeg.y, parentSeg.z - nz * w0];
  const c = [childSeg.x + nx * w1, childSeg.y, childSeg.z + nz * w1];
  const d = [childSeg.x - nx * w1, childSeg.y, childSeg.z - nz * w1];

  const dark = [color[0] * 0.7, color[1] * 0.7, color[2] * 0.7];

  tris.push([a, c, b, color]);
  tris.push([b, c, d, dark]);

  // Vertical strip (gives tendrils thickness when viewed from the side)
  const a2 = [parentSeg.x, parentSeg.y + w0, parentSeg.z];
  const b2 = [parentSeg.x, parentSeg.y - w0, parentSeg.z];
  const c2 = [childSeg.x, childSeg.y + w1, childSeg.z];
  const d2 = [childSeg.x, childSeg.y - w1, childSeg.z];

  const darker = [color[0] * 0.55, color[1] * 0.55, color[2] * 0.55];
  tris.push([a2, c2, b2, darker]);
  tris.push([b2, c2, d2, dark]);

  return tris;
}

/**
 * Build a radial disc (eye, ring element).
 * Small triangle fan centered at the segment position — oriented vertically.
 */
function buildDisc(seg, color, sides, pupilColor) {
  const tris = [];
  const cx = seg.x, cy = seg.y, cz = seg.z;
  const r = seg.size;
  const n = sides || 5;

  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    // Spread on XY plane (upright) instead of XZ (flat)
    const v0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cz];
    const v1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cz];
    tris.push([[cx, cy, cz], v1, v0, color]);
  }

  // Pupil (smaller dark disc slightly forward)
  if (pupilColor) {
    const pr = r * 0.4;
    const pz = cz + 0.005;
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2;
      const a1 = ((i + 1) / 4) * Math.PI * 2;
      const v0 = [cx + Math.cos(a0) * pr, cy + Math.sin(a0) * pr, pz];
      const v1 = [cx + Math.cos(a1) * pr, cy + Math.sin(a1) * pr, pz];
      tris.push([[cx, cy, pz], v1, v0, pupilColor]);
    }
  }

  return tris;
}

/**
 * Build a spike / tooth wedge pointing outward from parent.
 */
function buildSpike(seg, parentSeg, color) {
  const tris = [];
  const dx = seg.x - (parentSeg ? parentSeg.x : seg.restX);
  const dy = seg.y - (parentSeg ? parentSeg.y : seg.restY);
  const dz = seg.z - (parentSeg ? parentSeg.z : seg.restZ);
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.001) return tris;

  const dirX = dx / len, dirY = dy / len, dirZ = dz / len;
  const tipLen = seg.size * 3;
  const baseW = seg.size * 0.8;

  // Perpendicular
  let nx = -dirZ, nz = dirX;
  const nl = Math.sqrt(nx * nx + nz * nz);
  if (nl > 0.001) { nx /= nl; nz /= nl; }
  else { nx = 1; nz = 0; }

  const base0 = [seg.x + nx * baseW, seg.y, seg.z + nz * baseW];
  const base1 = [seg.x - nx * baseW, seg.y, seg.z - nz * baseW];
  const tip = [seg.x + dirX * tipLen, seg.y + dirY * tipLen + 0.02, seg.z + dirZ * tipLen];

  tris.push([base0, tip, base1, color]);

  // Second face (perpendicular plane) for volume
  const base2 = [seg.x, seg.y + baseW, seg.z];
  const base3 = [seg.x, seg.y - baseW, seg.z];
  const dark = [color[0] * 0.6, color[1] * 0.6, color[2] * 0.6];
  tris.push([base2, tip, base3, dark]);

  return tris;
}

/**
 * Build a concave sucker/cup shape — oriented vertically.
 */
function buildSucker(seg, color) {
  const tris = [];
  const cx = seg.x, cy = seg.y, cz = seg.z;
  const r = seg.size;
  const innerR = r * 0.5;
  const n = 5;

  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    // Outer ring on XY plane (upright)
    const o0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cz];
    const o1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cz];
    // Inner ring (depressed inward along Z)
    const i0 = [cx + Math.cos(a0) * innerR, cy + Math.sin(a0) * innerR, cz - r * 0.3];
    const i1 = [cx + Math.cos(a1) * innerR, cy + Math.sin(a1) * innerR, cz - r * 0.3];

    const dark = [color[0] * 0.5, color[1] * 0.5, color[2] * 0.5];
    tris.push([o0, o1, i0, color]);
    tris.push([i0, o1, i1, dark]);
  }

  return tris;
}

/**
 * Build core mass — irregular chunky pyramids, oriented upright.
 */
function buildCore(seg, color) {
  const tris = [];
  const cx = seg.x, cy = seg.y, cz = seg.z;
  const r = seg.size;
  const n = 5;

  // Radial fan around the vertical axis — base ring on XZ, peak above
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + seg.phase * 0.1;
    const a1 = ((i + 1) / n) * Math.PI * 2 + seg.phase * 0.1;
    const v0 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r];
    const v1 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
    const top = [cx, cy + r * 1.2, cz];

    const shade = 0.8 + Math.sin(i * 2.3) * 0.2;
    const c = [color[0] * shade, color[1] * shade, color[2] * shade];
    tris.push([v0, top, v1, c]);
    // Bottom face
    tris.push([v0, v1, [cx, cy, cz], [color[0] * 0.5, color[1] * 0.5, color[2] * 0.5]]);
  }

  return tris;
}

// ── Segment index for parent lookup ──

/**
 * Render all active horror entities.
 *
 * @param {object} renderer - the Renderer instance
 * @param {object} horrorParams - resolved horror params from world mode
 * @returns {{ segCount: number, triCount: number }}
 */
export function renderHorrors(renderer, horrorParams) {
  const segments = readHorrorSegments();
  if (segments.length === 0) return { segCount: 0, triCount: 0 };

  const colorBias = horrorParams.horrorColorBias || [1, 0.3, 0.15];
  const allTris = [];

  // Build lookup for parent references
  const segByIdx = new Map();
  for (const seg of segments) {
    segByIdx.set(seg.idx, seg);
  }

  for (const seg of segments) {
    const color = colorForType(seg.type, colorBias, seg.phase);
    const parent = seg.parentIdx >= 0 ? segByIdx.get(seg.parentIdx) : null;

    let shapeTris;
    switch (seg.type) {
      case SEG_CORE:
        shapeTris = buildCore(seg, color);
        break;
      case SEG_TENDRIL:
        if (parent) {
          shapeTris = buildTendrilStrip(parent, seg, color);
        } else {
          shapeTris = buildCore(seg, color);
        }
        break;
      case SEG_EYE:
        shapeTris = buildDisc(seg, color, 6, [0.08, 0.02, 0.02]);
        break;
      case SEG_TOOTH:
        shapeTris = buildSpike(seg, parent, color);
        break;
      case SEG_SUCKER:
        shapeTris = buildSucker(seg, color);
        break;
      case SEG_RING:
        shapeTris = buildDisc(seg, color, 4, null);
        break;
      case SEG_SPINE:
        shapeTris = buildSpike(seg, parent, color);
        break;
      default:
        shapeTris = [];
    }

    for (let i = 0; i < shapeTris.length; i++) {
      allTris.push(shapeTris[i]);
    }
  }

  if (allTris.length > 0) {
    renderer.drawDynamicTris(allTris, false);
  }

  return { segCount: segments.length, triCount: allTris.length };
}

/**
 * Render debug skeleton: segment points and parent-child links.
 * Uses simple pixel plotting through the renderer's pixel buffer.
 */
export function renderHorrorDebug(renderer) {
  const segments = readHorrorSegments();
  if (segments.length === 0) return;

  const { projectPoint } = getProjectionUtils();
  const mvp = renderer.mvp;
  const hw = renderer.hw, hh = renderer.hh;
  const pixels = renderer.pixels;
  const w = renderer.w, h = renderer.h;

  // Type colors for debug
  const TYPE_COLORS = {
    [SEG_CORE]:    [255, 60, 60],
    [SEG_TENDRIL]: [200, 100, 40],
    [SEG_EYE]:     [255, 255, 100],
    [SEG_TOOTH]:   [220, 220, 200],
    [SEG_SUCKER]:  [150, 60, 150],
    [SEG_RING]:    [60, 200, 255],
    [SEG_SPINE]:   [180, 80, 60],
  };

  // Build index for parent lookup
  const segByIdx = new Map();
  for (const seg of segments) segByIdx.set(seg.idx, seg);

  for (const seg of segments) {
    const sp = projectPoint(mvp, [seg.x, seg.y, seg.z], hw, hh);
    if (!sp) continue;
    const sx = Math.round(sp[0]), sy = Math.round(sp[1]);
    if (sx < 1 || sx >= w - 1 || sy < 1 || sy >= h - 1) continue;

    const c = TYPE_COLORS[seg.type] || [200, 200, 200];

    // Draw segment point (3×3 cross)
    for (const [dx, dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]) {
      const px = sx + dx, py = sy + dy;
      if (px >= 0 && px < w && py >= 0 && py < h) {
        const idx = (py * w + px) * 4;
        pixels[idx] = c[0]; pixels[idx+1] = c[1]; pixels[idx+2] = c[2];
      }
    }

    // Draw line to parent
    if (seg.parentIdx >= 0) {
      const parent = segByIdx.get(seg.parentIdx);
      if (parent) {
        const pp = projectPoint(mvp, [parent.x, parent.y, parent.z], hw, hh);
        if (pp) {
          drawDebugLine(pixels, w, h, sx, sy, Math.round(pp[0]), Math.round(pp[1]), c);
        }
      }
    }
  }
}

function drawDebugLine(pixels, w, h, x0, y0, x1, y1, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = Math.round(x0 + (x1 - x0) * t);
    const py = Math.round(y0 + (y1 - y0) * t);
    if (px >= 0 && px < w && py >= 0 && py < h) {
      const idx = (py * w + px) * 4;
      pixels[idx] = color[0]; pixels[idx+1] = color[1]; pixels[idx+2] = color[2];
    }
  }
}

// Lazy import to avoid circular dependency
let _projectPoint = null;
function getProjectionUtils() {
  if (!_projectPoint) {
    // We can access it through the existing math module
    _projectPoint = true;
  }
  return { projectPoint: _projectPointFn };
}

// Direct implementation to avoid import issues
function _projectPointFn(mvp, p, hw, hh) {
  const x = mvp[0]*p[0] + mvp[1]*p[1] + mvp[2]*p[2] + mvp[3];
  const y = mvp[4]*p[0] + mvp[5]*p[1] + mvp[6]*p[2] + mvp[7];
  const z = mvp[8]*p[0] + mvp[9]*p[1] + mvp[10]*p[2] + mvp[11];
  const w = mvp[12]*p[0] + mvp[13]*p[1] + mvp[14]*p[2] + mvp[15];
  if (w <= 0.001) return null;
  const invW = 1 / w;
  return [hw + x * invW * hw, hh - y * invW * hh, z * invW];
}
