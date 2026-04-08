import { v3add, v3scale, vec3 } from './math.js';
import { DEFAULT_SUN_DIR } from './renderer.js';

function tri(a, b, c, color) { return [a, b, c, color]; }

function rotY(p, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [p[0]*c + p[2]*s, p[1], -p[0]*s + p[2]*c];
}

function translate(tris, offset) {
  return tris.map(([a, b, c, col]) => [v3add(a, offset), v3add(b, offset), v3add(c, offset), col]);
}

function rotateTrisY(tris, angle) {
  return tris.map(([a, b, c, col]) => [rotY(a, angle), rotY(b, angle), rotY(c, angle), col]);
}

function scaleTris(tris, s) {
  const sv = typeof s === 'number' ? [s,s,s] : s;
  return tris.map(([a, b, c, col]) => [
    [a[0]*sv[0], a[1]*sv[1], a[2]*sv[2]],
    [b[0]*sv[0], b[1]*sv[1], b[2]*sv[2]],
    [c[0]*sv[0], c[1]*sv[1], c[2]*sv[2]], col
  ]);
}

function quad(a, b, c, d, color) {
  return [tri(a, b, c, color), tri(a, c, d, color)];
}

function boxTris(cx, cy, cz, sx, sy, sz, color) {
  const r = [];
  const hx = sx/2, hy = sy/2, hz = sz/2;
  const v = (x,y,z) => [cx+x, cy+y, cz+z];
  r.push(...quad(v(-hx,hy,-hz), v(hx,hy,-hz), v(hx,hy,hz), v(-hx,hy,hz), color));
  r.push(...quad(v(-hx,-hy,hz), v(hx,-hy,hz), v(hx,-hy,-hz), v(-hx,-hy,-hz), color));
  r.push(...quad(v(-hx,-hy,-hz), v(-hx,hy,-hz), v(-hx,hy,hz), v(-hx,-hy,hz), color));
  r.push(...quad(v(hx,-hy,hz), v(hx,hy,hz), v(hx,hy,-hz), v(hx,-hy,-hz), color));
  r.push(...quad(v(-hx,-hy,hz), v(-hx,hy,hz), v(hx,hy,hz), v(hx,-hy,hz), color));
  r.push(...quad(v(hx,-hy,-hz), v(hx,hy,-hz), v(-hx,hy,-hz), v(-hx,-hy,-hz), color));
  return r;
}

function coneTris(cx, cy, cz, radius, height, sides, color) {
  const r = [];
  const top = [cx, cy + height, cz];
  for (let i = 0; i < sides; i++) {
    const a1 = (i / sides) * Math.PI * 2;
    const a2 = ((i+1) / sides) * Math.PI * 2;
    const b1 = [cx + Math.cos(a1)*radius, cy, cz + Math.sin(a1)*radius];
    const b2 = [cx + Math.cos(a2)*radius, cy, cz + Math.sin(a2)*radius];
    r.push(tri(b2, b1, top, color));
  }
  return r;
}

function pyramidTris(cx, cy, cz, radius, height, sides, color) {
  const r = [];
  const top = [cx, cy + height, cz];
  for (let i = 0; i < sides; i++) {
    const a1 = (i / sides) * Math.PI * 2;
    const a2 = ((i+1) / sides) * Math.PI * 2;
    const b1 = [cx + Math.cos(a1)*radius, cy, cz + Math.sin(a1)*radius];
    const b2 = [cx + Math.cos(a2)*radius, cy, cz + Math.sin(a2)*radius];
    r.push(tri(b2, b1, top, color));
    r.push(tri(b1, b2, [cx, cy, cz], color));
  }
  return r;
}

const TRUNK_BROWN = [0.35, 0.22, 0.12];
const TRUNK_DARK = [0.28, 0.17, 0.09];

const PINE_DARK = [0.18, 0.32, 0.15];
const PINE_MID = [0.22, 0.38, 0.18];
const PINE_LIGHT = [0.28, 0.42, 0.2];

const BUSH_GREEN = [0.25, 0.4, 0.18];
const BUSH_DARK = [0.18, 0.3, 0.12];

const FLOWER_CREAM = [0.95, 0.9, 0.7];
const FLOWER_PINK = [0.85, 0.5, 0.55];
const FLOWER_GOLD = [0.9, 0.75, 0.3];
const FLOWER_RED = [0.75, 0.3, 0.25];

const ROCK_GREY = [0.5, 0.48, 0.44];
const ROCK_DARK = [0.38, 0.36, 0.33];

const STUMP_COLOR = [0.4, 0.28, 0.15];
const LOG_COLOR = [0.38, 0.25, 0.13];

const GRASS_GREEN = [0.3, 0.48, 0.2];
const GRASS_DARK = [0.22, 0.38, 0.15];

const SHADOW_DARK = [0.1, 0.12, 0.08];
const SHADOW_MID = [0.12, 0.15, 0.09];
const CONTACT_DARK = [0.08, 0.09, 0.06];

// Default sun shadow projection (used for static baked shadows)
let SUN_FLAT_X = -DEFAULT_SUN_DIR[0] / DEFAULT_SUN_DIR[1];
let SUN_FLAT_Z = -DEFAULT_SUN_DIR[2] / DEFAULT_SUN_DIR[1];

// Update the sun shadow direction dynamically
export function updateSunShadowDir(sunDir) {
  if (sunDir[1] > 0.03) {
    SUN_FLAT_X = -sunDir[0] / sunDir[1];
    SUN_FLAT_Z = -sunDir[2] / sunDir[1];
  }
}

function shadowEllipse(cx, gy, cz, rx, rz, segs, color) {
  const tris = [];
  const y = gy + 0.015;
  for (let i = 0; i < segs; i++) {
    const a1 = (i / segs) * Math.PI * 2;
    const a2 = ((i+1) / segs) * Math.PI * 2;
    tris.push(tri(
      [cx, y, cz],
      [cx + Math.cos(a2)*rx, y, cz + Math.sin(a2)*rz],
      [cx + Math.cos(a1)*rx, y, cz + Math.sin(a1)*rz],
      color
    ));
  }
  return tris;
}

function makeContactShadow(x, gy, z, radius) {
  return shadowEllipse(x, gy, z, radius, radius, 6, CONTACT_DARK);
}

function makeTreeShadow(x, gy, z, height, canopyRadius, scale) {
  const tris = [];
  const offsetX = height * SUN_FLAT_X * 0.7 * scale;
  const offsetZ = height * SUN_FLAT_Z * 0.7 * scale;
  const sx = x + offsetX * 0.5;
  const sz = z + offsetZ * 0.5;
  const len = Math.sqrt(offsetX*offsetX + offsetZ*offsetZ);
  const rx = Math.max(canopyRadius * scale * 0.6, len * 0.35 + 0.3);
  const rz = canopyRadius * scale * 0.55;
  const angle = Math.atan2(offsetZ, offsetX);
  const segs = 6;
  const y = gy + 0.015;
  for (let i = 0; i < segs; i++) {
    const a1 = (i / segs) * Math.PI * 2;
    const a2 = ((i+1) / segs) * Math.PI * 2;
    tris.push(tri(
      [sx, y, sz],
      [sx + Math.cos(a2 + angle)*rx, y, sz + Math.sin(a2 + angle)*rz],
      [sx + Math.cos(a1 + angle)*rx, y, sz + Math.sin(a1 + angle)*rz],
      SHADOW_MID
    ));
  }
  tris.push(...makeContactShadow(x, gy, z, 0.3 * scale));
  return tris;
}

function makeRockShadow(x, gy, z, scale) {
  const offsetX = 0.3 * scale * SUN_FLAT_X;
  const offsetZ = 0.3 * scale * SUN_FLAT_Z;
  const sx = x + offsetX * 0.5;
  const sz = z + offsetZ * 0.5;
  const tris = shadowEllipse(sx, gy, sz, 0.3 * scale, 0.22 * scale, 5, SHADOW_MID);
  tris.push(...makeContactShadow(x, gy, z, 0.15 * scale));
  return tris;
}

function makeStumpShadow(x, gy, z, scale) {
  const offsetX = 0.35 * scale * SUN_FLAT_X;
  const offsetZ = 0.35 * scale * SUN_FLAT_Z;
  const sx = x + offsetX * 0.5;
  const sz = z + offsetZ * 0.5;
  const tris = shadowEllipse(sx, gy, sz, 0.3 * scale, 0.2 * scale, 5, SHADOW_MID);
  tris.push(...makeContactShadow(x, gy, z, 0.2 * scale));
  return tris;
}

function makeLogShadow(x, gy, z, length, scale, rot) {
  const tris = [];
  const y = gy + 0.015;
  const offsetX = 0.15 * scale * SUN_FLAT_X;
  const offsetZ = 0.15 * scale * SUN_FLAT_Z;
  const hw = length * 0.5;
  const hh = 0.18 * scale;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const pts = [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]
  ].map(([lx, lz]) => [
    x + offsetX + lx * cr - lz * sr,
    z + offsetZ + lx * sr + lz * cr
  ]);
  tris.push(tri([pts[0][0], y, pts[0][1]], [pts[2][0], y, pts[2][1]], [pts[1][0], y, pts[1][1]], SHADOW_MID));
  tris.push(tri([pts[0][0], y, pts[0][1]], [pts[3][0], y, pts[3][1]], [pts[2][0], y, pts[2][1]], SHADOW_MID));
  tris.push(...makeContactShadow(x, gy, z, 0.15 * scale));
  return tris;
}

function makeBushShadow(x, gy, z, scale) {
  const offsetX = 0.4 * scale * SUN_FLAT_X;
  const offsetZ = 0.4 * scale * SUN_FLAT_Z;
  const sx = x + offsetX * 0.4;
  const sz = z + offsetZ * 0.4;
  const tris = shadowEllipse(sx, gy, sz, 0.35 * scale, 0.25 * scale, 5, SHADOW_MID);
  tris.push(...makeContactShadow(x, gy, z, 0.18 * scale));
  return tris;
}

export function makeTreeA(x, y, z, scale = 1, rot = 0) {
  let tris = [];
  const h = 1.8 * scale;
  tris.push(...boxTris(0, h*0.3, 0, 0.25*scale, h*0.6, 0.25*scale, TRUNK_BROWN));
  tris.push(...coneTris(0, h*0.45, 0, 1.4*scale, 1.8*scale, 6, PINE_DARK));
  tris.push(...coneTris(0, h*0.75, 0, 1.1*scale, 1.5*scale, 6, PINE_MID));
  tris.push(...coneTris(0, h*1.05, 0, 0.75*scale, 1.1*scale, 6, PINE_LIGHT));
  tris = rotateTrisY(tris, rot);
  return translate(tris, [x, y, z]);
}

export function makeTreeB(x, y, z, scale = 1, rot = 0) {
  let tris = [];
  const h = 2.2 * scale;
  tris.push(...boxTris(0, h*0.25, 0, 0.3*scale, h*0.5, 0.3*scale, TRUNK_DARK));
  tris.push(...pyramidTris(0.15*scale, h*0.4, 0.1*scale, 1.6*scale, 2.0*scale, 5, PINE_DARK));
  tris.push(...pyramidTris(-0.1*scale, h*0.8, -0.05*scale, 1.2*scale, 1.6*scale, 5, PINE_MID));
  tris.push(...pyramidTris(0.05*scale, h*1.15, 0, 0.8*scale, 1.0*scale, 5, PINE_LIGHT));
  tris = rotateTrisY(tris, rot);
  return translate(tris, [x, y, z]);
}

export function makeTreeC(x, y, z, scale = 1, rot = 0) {
  let tris = [];
  const h = 1.5 * scale;
  tris.push(...boxTris(0, h*0.35, 0, 0.2*scale, h*0.7, 0.2*scale, TRUNK_BROWN));
  tris.push(...coneTris(0, h*0.5, 0, 1.0*scale, 2.5*scale, 7, PINE_DARK));
  tris.push(...coneTris(0, h*1.0, 0, 0.65*scale, 1.5*scale, 7, PINE_MID));
  tris = rotateTrisY(tris, rot);
  return translate(tris, [x, y, z]);
}

// ── Layered tree builders for breathing animation ──
// Return { trunk: tri[], canopyLayers: [{ tris: tri[], weight: 0..1 }] }
// weight = how much this layer participates in breathing (0 = base, 1 = top)

export function makeTreeALayered(x, y, z, scale = 1, rot = 0) {
  const h = 1.8 * scale;
  let trunk = boxTris(0, h*0.3, 0, 0.25*scale, h*0.6, 0.25*scale, TRUNK_BROWN);
  let c0 = coneTris(0, h*0.45, 0, 1.4*scale, 1.8*scale, 6, PINE_DARK);
  let c1 = coneTris(0, h*0.75, 0, 1.1*scale, 1.5*scale, 6, PINE_MID);
  let c2 = coneTris(0, h*1.05, 0, 0.75*scale, 1.1*scale, 6, PINE_LIGHT);
  trunk = translate(rotateTrisY(trunk, rot), [x, y, z]);
  c0 = translate(rotateTrisY(c0, rot), [x, y, z]);
  c1 = translate(rotateTrisY(c1, rot), [x, y, z]);
  c2 = translate(rotateTrisY(c2, rot), [x, y, z]);
  return { trunk, canopyLayers: [
    { tris: c0, weight: 0.2 },
    { tris: c1, weight: 0.55 },
    { tris: c2, weight: 1.0 },
  ]};
}

export function makeTreeBLayered(x, y, z, scale = 1, rot = 0) {
  const h = 2.2 * scale;
  let trunk = boxTris(0, h*0.25, 0, 0.3*scale, h*0.5, 0.3*scale, TRUNK_DARK);
  let c0 = pyramidTris(0.15*scale, h*0.4, 0.1*scale, 1.6*scale, 2.0*scale, 5, PINE_DARK);
  let c1 = pyramidTris(-0.1*scale, h*0.8, -0.05*scale, 1.2*scale, 1.6*scale, 5, PINE_MID);
  let c2 = pyramidTris(0.05*scale, h*1.15, 0, 0.8*scale, 1.0*scale, 5, PINE_LIGHT);
  trunk = translate(rotateTrisY(trunk, rot), [x, y, z]);
  c0 = translate(rotateTrisY(c0, rot), [x, y, z]);
  c1 = translate(rotateTrisY(c1, rot), [x, y, z]);
  c2 = translate(rotateTrisY(c2, rot), [x, y, z]);
  return { trunk, canopyLayers: [
    { tris: c0, weight: 0.2 },
    { tris: c1, weight: 0.55 },
    { tris: c2, weight: 1.0 },
  ]};
}

export function makeTreeCLayered(x, y, z, scale = 1, rot = 0) {
  const h = 1.5 * scale;
  let trunk = boxTris(0, h*0.35, 0, 0.2*scale, h*0.7, 0.2*scale, TRUNK_BROWN);
  let c0 = coneTris(0, h*0.5, 0, 1.0*scale, 2.5*scale, 7, PINE_DARK);
  let c1 = coneTris(0, h*1.0, 0, 0.65*scale, 1.5*scale, 7, PINE_MID);
  trunk = translate(rotateTrisY(trunk, rot), [x, y, z]);
  c0 = translate(rotateTrisY(c0, rot), [x, y, z]);
  c1 = translate(rotateTrisY(c1, rot), [x, y, z]);
  return { trunk, canopyLayers: [
    { tris: c0, weight: 0.3 },
    { tris: c1, weight: 1.0 },
  ]};
}

export function makeBush(x, y, z, scale = 1, rot = 0) {
  let tris = [];
  const c = scale > 0.7 ? BUSH_GREEN : BUSH_DARK;
  tris.push(...pyramidTris(0, 0, 0, 0.6*scale, 0.5*scale, 5, c));
  tris.push(...pyramidTris(0.2*scale, 0, 0.15*scale, 0.45*scale, 0.4*scale, 5, BUSH_GREEN));
  tris = rotateTrisY(tris, rot);
  return translate(tris, [x, y, z]);
}

export function makeFlowerPatch(x, y, z, count = 5, spread = 0.6, seed = 0) {
  const tris = [];
  const colors = [FLOWER_CREAM, FLOWER_PINK, FLOWER_GOLD, FLOWER_RED];
  for (let i = 0; i < count; i++) {
    const a = (seed + i * 137.5) * 0.0174533;
    const r = spread * (0.3 + 0.7 * ((Math.sin(seed + i * 7.3) + 1) / 2));
    const fx = x + Math.cos(a) * r;
    const fz = z + Math.sin(a) * r;
    const col = colors[(i + Math.floor(seed)) % colors.length];
    const s = 0.08 + 0.06 * Math.sin(seed + i);
    tris.push(...pyramidTris(fx, y, fz, s, s * 1.2, 4, col));
    tris.push(...boxTris(fx, y + s*0.3, fz, 0.015, s*0.8, 0.015, GRASS_DARK));
  }
  return tris;
}

export function makeGrassClump(x, y, z, count = 6, spread = 0.4, seed = 0) {
  const tris = [];
  for (let i = 0; i < count; i++) {
    const a = (seed + i * 60) * 0.0174533;
    const r = spread * (0.3 + 0.7 * Math.abs(Math.sin(seed + i * 3.7)));
    const gx = x + Math.cos(a) * r;
    const gz = z + Math.sin(a) * r;
    const h = 0.15 + 0.1 * Math.sin(seed + i * 2.3);
    const c = i % 2 === 0 ? GRASS_GREEN : GRASS_DARK;
    tris.push(tri([gx-0.02, y, gz], [gx+0.02, y, gz], [gx, y+h, gz+0.01], c));
    tris.push(tri([gx, y, gz-0.02], [gx, y, gz+0.02], [gx+0.01, y+h*0.9, gz], c));
  }
  return tris;
}

export function makeRock(x, y, z, scale = 1, rot = 0) {
  let tris = [];
  const c = scale > 0.5 ? ROCK_GREY : ROCK_DARK;
  tris.push(...pyramidTris(0, 0, 0, 0.35*scale, 0.25*scale, 5, c));
  tris.push(...pyramidTris(0.1*scale, 0, 0.08*scale, 0.2*scale, 0.18*scale, 4, ROCK_DARK));
  tris = rotateTrisY(tris, rot);
  return translate(tris, [x, y, z]);
}

export function makeStump(x, y, z, scale = 1) {
  let tris = [];
  tris.push(...coneTris(0, 0, 0, 0.25*scale, 0.35*scale, 6, STUMP_COLOR));
  tris.push(...coneTris(0, 0.1*scale, 0, 0.28*scale, 0.05*scale, 6, TRUNK_DARK));
  return translate(tris, [x, y, z]);
}

export function makeLog(x, y, z, length = 1.2, scale = 0.8, rot = 0) {
  let tris = [];
  const r = 0.12 * scale;
  const hl = length / 2;
  const sides = 5;
  for (let i = 0; i < sides; i++) {
    const a1 = (i / sides) * Math.PI * 2;
    const a2 = ((i+1) / sides) * Math.PI * 2;
    const y1 = r + Math.cos(a1)*r, z1 = Math.sin(a1)*r;
    const y2 = r + Math.cos(a2)*r, z2 = Math.sin(a2)*r;
    tris.push(...quad(
      [-hl, y1, z1], [hl, y1, z1], [hl, y2, z2], [-hl, y2, z2], LOG_COLOR
    ));
  }
  tris.push(...coneTris(-hl, 0, 0, r, r*0.01, sides, TRUNK_DARK));
  tris.push(...coneTris(hl, 0, 0, r, r*0.01, sides, STUMP_COLOR));
  tris = rotateTrisY(tris, rot);
  return translate(tris, [x, y, z]);
}

export function makeGroundPatch(cx, cz, sizeX, sizeZ, yFunc, color) {
  const tris = [];
  const res = 3;
  const stepX = sizeX / res;
  const stepZ = sizeZ / res;
  const x0 = cx - sizeX/2;
  const z0 = cz - sizeZ/2;
  for (let i = 0; i < res; i++) {
    for (let j = 0; j < res; j++) {
      const ax = x0 + i * stepX, az = z0 + j * stepZ;
      const bx = ax + stepX, bz = az + stepZ;
      const ay = yFunc(ax, az), by = yFunc(bx, az), cy = yFunc(bx, bz), dy = yFunc(ax, bz);
      const c = [color[0] + (Math.sin(i*3+j*7)*0.015), color[1] + (Math.cos(i*5+j*3)*0.015), color[2]];
      tris.push(tri([ax, ay, az], [bx, cy, bz], [bx, by, az], c));
      tris.push(tri([ax, ay, az], [ax, dy, bz], [bx, cy, bz], c));
    }
  }
  return tris;
}

const CHAR_LOG = [0.2, 0.13, 0.07];
const ASH_COLOR = [0.25, 0.22, 0.18];
const EMBER_COLOR = [0.55, 0.2, 0.05];
const WARM_GROUND = [0.3, 0.2, 0.12];

export function makeFireplace(x, y, z) {
  const tris = [];
  const ringR = 0.55;
  const stoneCount = 8;
  for (let i = 0; i < stoneCount; i++) {
    const a = (i / stoneCount) * Math.PI * 2;
    const sx = x + Math.cos(a) * ringR;
    const sz = z + Math.sin(a) * ringR;
    const sc = 0.18 + Math.sin(i * 3.7) * 0.04;
    const rot = a + 0.3;
    const c = i % 2 === 0 ? ROCK_GREY : ROCK_DARK;
    tris.push(...pyramidTris(sx, y, sz, sc, 0.14 + Math.sin(i*2.1)*0.03, 4, c));
  }

  tris.push(...pyramidTris(x, y, z, 0.5, 0.02, 6, ASH_COLOR));

  const logLen = 0.4;
  const logR = 0.05;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const lx = x + Math.cos(a) * 0.12;
    const lz = z + Math.sin(a) * 0.12;
    const sides = 4;
    for (let j = 0; j < sides; j++) {
      const a1 = (j / sides) * Math.PI * 2;
      const a2 = ((j+1) / sides) * Math.PI * 2;
      const y1 = logR + Math.cos(a1)*logR, z1 = Math.sin(a1)*logR;
      const y2 = logR + Math.cos(a2)*logR, z2 = Math.sin(a2)*logR;
      const cr = Math.cos(a), sr = Math.sin(a);
      tris.push(...quad(
        [lx - logLen*0.5*cr, y + y1, lz - logLen*0.5*sr + z1],
        [lx + logLen*0.5*cr, y + y1, lz + logLen*0.5*sr + z1],
        [lx + logLen*0.5*cr, y + y2, lz + logLen*0.5*sr + z2],
        [lx - logLen*0.5*cr, y + y2, lz - logLen*0.5*sr + z2],
        j < 2 ? CHAR_LOG : EMBER_COLOR
      ));
    }
  }

  const warmSegs = 8;
  const warmR = 1.0;
  const wy = y + 0.01;
  for (let i = 0; i < warmSegs; i++) {
    const a1 = (i / warmSegs) * Math.PI * 2;
    const a2 = ((i+1) / warmSegs) * Math.PI * 2;
    tris.push(tri(
      [x, wy, z],
      [x + Math.cos(a2)*warmR, wy, z + Math.sin(a2)*warmR],
      [x + Math.cos(a1)*warmR, wy, z + Math.sin(a1)*warmR],
      WARM_GROUND
    ));
  }

  return tris;
}

export function makeFireFlames(x, y, z, time) {
  const tris = [];
  const flameColors = [
    [0.95, 0.7, 0.15],
    [0.95, 0.5, 0.08],
    [0.9, 0.35, 0.05],
    [0.85, 0.25, 0.03],
    [1.0, 0.85, 0.3],
  ];

  for (let i = 0; i < 7; i++) {
    const phase = time * 3.5 + i * 2.1;
    const flicker = Math.sin(phase) * 0.5 + 0.5;
    const sway = Math.sin(phase * 0.7 + i) * 0.06;
    const a = (i / 7) * Math.PI * 2 + Math.sin(time + i) * 0.3;
    const dist = 0.06 + flicker * 0.06;
    const fx = x + Math.cos(a) * dist + sway;
    const fz = z + Math.sin(a) * dist;
    const h = 0.2 + flicker * 0.25 + Math.sin(phase * 1.3) * 0.08;
    const w = 0.04 + flicker * 0.03;
    const col = flameColors[i % flameColors.length];

    tris.push(tri(
      [fx - w, y + 0.08, fz],
      [fx + w, y + 0.08, fz],
      [fx + sway * 0.5, y + 0.08 + h, fz + 0.01],
      col
    ));
    tris.push(tri(
      [fx, y + 0.08, fz - w],
      [fx, y + 0.08, fz + w],
      [fx + sway * 0.5, y + 0.08 + h, fz + 0.01],
      col
    ));
  }

  for (let i = 0; i < 4; i++) {
    const phase = time * 2.2 + i * 3.7;
    const flicker = Math.sin(phase) * 0.5 + 0.5;
    const sway = Math.sin(phase * 0.5) * 0.03;
    const a = (i / 4) * Math.PI * 2 + 0.5;
    const fx = x + Math.cos(a) * 0.03 + sway;
    const fz = z + Math.sin(a) * 0.03;
    const h = 0.35 + flicker * 0.2;
    const w = 0.025;

    tris.push(tri(
      [fx - w, y + 0.12, fz],
      [fx + w, y + 0.12, fz],
      [fx + sway, y + 0.12 + h, fz],
      [1.0, 0.9, 0.4]
    ));
  }

  return tris;
}

const SLOPE_BASE = [0.28, 0.34, 0.18];
const SLOPE_MID = [0.42, 0.36, 0.24];
const SLOPE_UPPER = [0.48, 0.44, 0.38];
const SLOPE_RIDGE = [0.38, 0.36, 0.33];

const SLOPE_COLORS = [SLOPE_BASE, SLOPE_MID, SLOPE_UPPER, SLOPE_RIDGE];

function makeWallStrip(x0, z0, x1, z1, outDirX, outDirZ, groundY) {
  const tris = [];
  const dx = x1 - x0, dz = z1 - z0;
  const wallLen = Math.sqrt(dx * dx + dz * dz);
  const segLen = 2;
  const segments = Math.max(1, Math.round(wallLen / segLen));
  const strips = 3;
  const slopeDepth = 4;
  const ridgeHeight = 4;

  const verts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const wx = x0 + dx * t;
    const wz = z0 + dz * t;
    const col = [];
    for (let s = 0; s <= strips; s++) {
      const f = s / strips;
      const px = wx + outDirX * slopeDepth * f;
      const pz = wz + outDirZ * slopeDepth * f;
      const baseY = groundY(wx, wz);
      const noise = Math.sin(wx * 1.7 + wz * 0.9) * 0.4 * f +
                    Math.cos(wx * 0.8 - wz * 1.3) * 0.2 * f;
      const py = baseY + ridgeHeight * f * f + noise;
      col.push([px, py, pz]);
    }
    verts.push(col);
  }

  for (let i = 0; i < segments; i++) {
    for (let s = 0; s < strips; s++) {
      const a = verts[i][s];
      const b = verts[i + 1][s];
      const c = verts[i + 1][s + 1];
      const d = verts[i][s + 1];

      const baseColor = SLOPE_COLORS[s];
      const variation = Math.sin(i * 3 + s * 7) * 0.02;
      const variation2 = Math.cos(i * 5 + s * 3) * 0.02;
      const col = [
        baseColor[0] + variation,
        baseColor[1] + variation2,
        baseColor[2]
      ];

      tris.push(tri(a, c, b, col));
      tris.push(tri(a, d, c, col));
    }
  }

  return tris;
}

function makeCornerPiece(cx, cz, dir1X, dir1Z, dir2X, dir2Z, groundY) {
  const tris = [];
  const arcSegs = 3;
  const strips = 3;
  const slopeDepth = 4;
  const ridgeHeight = 4;

  const verts = [];
  for (let i = 0; i <= arcSegs; i++) {
    const t = i / arcSegs;
    const odx = dir1X + (dir2X - dir1X) * t;
    const odz = dir1Z + (dir2Z - dir1Z) * t;
    const len = Math.sqrt(odx * odx + odz * odz);
    const ndx = odx / len, ndz = odz / len;

    const col = [];
    for (let s = 0; s <= strips; s++) {
      const f = s / strips;
      const px = cx + ndx * slopeDepth * f;
      const pz = cz + ndz * slopeDepth * f;
      const baseY = groundY(cx, cz);
      const noise = Math.sin(cx * 1.7 + cz * 0.9) * 0.4 * f;
      const py = baseY + ridgeHeight * f * f + noise;
      col.push([px, py, pz]);
    }
    verts.push(col);
  }

  for (let i = 0; i < arcSegs; i++) {
    for (let s = 0; s < strips; s++) {
      const a = verts[i][s];
      const b = verts[i + 1][s];
      const c = verts[i + 1][s + 1];
      const d = verts[i][s + 1];

      const col = SLOPE_COLORS[s];
      tris.push(tri(a, c, b, col));
      tris.push(tri(a, d, c, col));
    }
  }

  return tris;
}

export function makeValleyWalls(groundY) {
  const tris = [];

  // Four wall strips
  tris.push(...makeWallStrip(-12, -4, 12, -4, 0, -1, groundY));   // North
  tris.push(...makeWallStrip(-12, 46, 12, 46, 0, 1, groundY));    // South
  tris.push(...makeWallStrip(-12, -4, -12, 46, -1, 0, groundY));  // West
  tris.push(...makeWallStrip(12, -4, 12, 46, 1, 0, groundY));     // East

  // Corner pieces
  tris.push(...makeCornerPiece(-12, -4, -1, 0, 0, -1, groundY));  // NW
  tris.push(...makeCornerPiece(12, -4, 0, -1, 1, 0, groundY));    // NE
  tris.push(...makeCornerPiece(-12, 46, 0, 1, -1, 0, groundY));   // SW
  tris.push(...makeCornerPiece(12, 46, 1, 0, 0, 1, groundY));     // SE

  // Scatter boulders on slopes
  const boulderSpots = [
    [-10, -2, 0.7], [8, -2, 0.6], [-11, 5, 0.8], [11, 10, 0.7],
    [-10, 15, 0.6], [10, 20, 0.8], [-11, 25, 0.7], [11, 30, 0.6],
    [-10, 35, 0.8], [10, 40, 0.7], [-9, 44, 0.6], [9, 44, 0.7],
    [0, -3, 0.5], [5, -3, 0.6], [-5, 45, 0.7], [3, 45, 0.5],
    [-11, 0, 0.5], [11, 8, 0.5], [-10, 42, 0.6], [10, 3, 0.6],
  ];
  for (const [bx, bz, bs] of boulderSpots) {
    const by = groundY(bx, bz);
    tris.push(...makeRock(bx, by, bz, bs, bx * 0.7 + bz * 0.3));
  }

  return tris;
}

// ── Lamp post ──

const IRON_DARK = [0.18, 0.16, 0.14];
const IRON_MID = [0.25, 0.23, 0.20];
const IRON_LIGHT = [0.32, 0.29, 0.25];
const GLASS_WARM = [0.85, 0.75, 0.45];

function cylinderTris(cx, cy, cz, radius, height, sides, color) {
  const tris = [];
  for (let i = 0; i < sides; i++) {
    const a1 = (i / sides) * Math.PI * 2;
    const a2 = ((i + 1) / sides) * Math.PI * 2;
    const bx1 = cx + Math.cos(a1) * radius, bz1 = cz + Math.sin(a1) * radius;
    const bx2 = cx + Math.cos(a2) * radius, bz2 = cz + Math.sin(a2) * radius;
    // Side faces
    tris.push(...quad(
      [bx1, cy, bz1], [bx2, cy, bz2],
      [bx2, cy + height, bz2], [bx1, cy + height, bz1],
      color
    ));
  }
  return tris;
}

export function makeLampPost(x, y, z) {
  const tris = [];

  // ── Base: wide octagonal platform ──
  tris.push(...cylinderTris(x, y, z, 0.18, 0.04, 8, IRON_DARK));
  // Stepped base ring
  tris.push(...cylinderTris(x, y + 0.04, z, 0.14, 0.03, 8, IRON_MID));
  tris.push(...cylinderTris(x, y + 0.07, z, 0.10, 0.04, 8, IRON_DARK));

  // ── Main stem: thin octagonal column ──
  const stemBot = y + 0.11;
  const stemH = 1.6;
  tris.push(...cylinderTris(x, stemBot, z, 0.04, stemH, 8, IRON_MID));

  // ── Decorative rings along the stem ──
  const ringPositions = [0.3, 0.6, 1.0, 1.3];
  for (const rp of ringPositions) {
    const ry = stemBot + rp;
    tris.push(...cylinderTris(x, ry, z, 0.055, 0.025, 8, IRON_LIGHT));
  }

  // ── Decorative midpoint bulge ──
  const midY = stemBot + 0.75;
  tris.push(...coneTris(x, midY, z, 0.07, 0.06, 8, IRON_LIGHT));
  tris.push(...coneTris(x, midY + 0.06, z, 0.07, -0.06, 8, IRON_LIGHT)); // inverted cone = diamond shape

  // ── Top collar under the lamp housing ──
  const topY = stemBot + stemH;
  tris.push(...cylinderTris(x, topY, z, 0.06, 0.02, 8, IRON_DARK));
  tris.push(...cylinderTris(x, topY + 0.02, z, 0.08, 0.02, 8, IRON_MID));

  // ── Lamp housing: four angled supports + glass panes ──
  const housingBot = topY + 0.04;
  const housingH = 0.22;

  // Four vertical bars at corners of housing
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bx = x + Math.cos(a) * 0.08;
    const bz = z + Math.sin(a) * 0.08;
    tris.push(...boxTris(bx, housingBot + housingH / 2, bz, 0.015, housingH, 0.015, IRON_DARK));
  }

  // Glass panels between bars (emissive warm glow color)
  for (let i = 0; i < 4; i++) {
    const a1 = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const a2 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
    const x1 = x + Math.cos(a1) * 0.075, z1 = z + Math.sin(a1) * 0.075;
    const x2 = x + Math.cos(a2) * 0.075, z2 = z + Math.sin(a2) * 0.075;
    tris.push(...quad(
      [x1, housingBot + 0.02, z1], [x2, housingBot + 0.02, z2],
      [x2, housingBot + housingH - 0.02, z2], [x1, housingBot + housingH - 0.02, z1],
      GLASS_WARM
    ));
  }

  // ── Roof cap: small pyramid on top ──
  const roofBot = housingBot + housingH;
  tris.push(...cylinderTris(x, roofBot, z, 0.09, 0.015, 8, IRON_DARK));
  tris.push(...pyramidTris(x, roofBot + 0.015, z, 0.10, 0.08, 4, IRON_MID));

  // ── Finial: tiny spike on top ──
  const finialBot = roofBot + 0.095;
  tris.push(...coneTris(x, finialBot, z, 0.015, 0.06, 6, IRON_LIGHT));

  // ── Contact shadow ──
  tris.push(...makeContactShadow(x, y, z, 0.25));

  return tris;
}

export { translate, rotateTrisY, scaleTris, makeTreeShadow, makeRockShadow, makeStumpShadow, makeLogShadow, makeBushShadow };
