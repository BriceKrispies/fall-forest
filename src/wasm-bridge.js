export const LAYOUT = {
  OFF_MVP: 0,
  OFF_CAM: 64,
  OFF_SUN: 80,
  OFF_CONSTANTS: 96,
  OFF_METRICS: 128,
  OFF_TRI_IN: 256,
  OFF_TRI_OUT: 1344256,
  OFF_LEAVES: 2688256,
  OFF_GRASS: 2690304,
  OFF_CREATURES: 2754304,
  TRI_STRIDE: 48,
  LEAF_STRIDE: 32,
  GRASS_STRIDE: 32,
  CREATURE_STRIDE: 32,
  MAX_TRIS: 28000,
  MAX_LEAVES: 64,
  MAX_GRASS: 2000,
  MAX_CREATURES: 16,
  OFF_LIGHT_COUNT: 156,
  OFF_LIGHTS: 160,
  MAX_LIGHTS: 8,
  // Horror entity system
  OFF_HORROR_CFG: 2760000,
  OFF_HORROR_ENT: 2760032,
  OFF_HORROR_SEG: 2760544,
  MAX_HORROR_ENT: 8,
  MAX_HORROR_SEG: 512,
  HORROR_ENT_STRIDE: 64,  // 16 f32
  HORROR_SEG_STRIDE: 48,  // 12 f32
};

let wasm = null;
let mem = null;
let f32View = null;
let i32View = null;
let u8View = null;

export async function initWasm() {
  const resp = await fetch('wasm/core.wasm');
  const bytes = await resp.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes);
  wasm = result.instance.exports;
  mem = wasm.memory;
  f32View = new Float32Array(mem.buffer);
  i32View = new Int32Array(mem.buffer);
  u8View = new Uint8Array(mem.buffer);
  return wasm;
}

export function getWasm() { return wasm; }
export function getMemory() { return mem; }
export function getF32() { return f32View; }
export function getI32() { return i32View; }
export function getU8() { return u8View; }

export function uploadMVP(mvp) {
  const off = LAYOUT.OFF_MVP >> 2;
  for (let i = 0; i < 16; i++) f32View[off + i] = mvp[i];
}

export function uploadCamera(pos) {
  const off = LAYOUT.OFF_CAM >> 2;
  f32View[off] = pos[0];
  f32View[off + 1] = pos[1];
  f32View[off + 2] = pos[2];
}

export function uploadSunDir(dir) {
  const off = LAYOUT.OFF_SUN >> 2;
  f32View[off] = dir[0];
  f32View[off + 1] = dir[1];
  f32View[off + 2] = dir[2];
}

export function uploadConstants(fogNear, fogFar, ambient) {
  const off = LAYOUT.OFF_CONSTANTS >> 2;
  f32View[off] = fogNear;
  f32View[off + 1] = fogFar;
  f32View[off + 2] = ambient;
}

/**
 * Upload point light positions. Each light is [x, y, z, radius].
 * Pass an empty array to clear all lights.
 */
export function uploadPointLights(lights) {
  const count = Math.min(lights.length, LAYOUT.MAX_LIGHTS);
  i32View[LAYOUT.OFF_LIGHT_COUNT >> 2] = count;
  const base = LAYOUT.OFF_LIGHTS >> 2;
  for (let i = 0; i < count; i++) {
    const l = lights[i];
    const off = base + i * 4;
    f32View[off]     = l[0];
    f32View[off + 1] = l[1];
    f32View[off + 2] = l[2];
    f32View[off + 3] = l[3];
  }
}

export function uploadTriangles(tris) {
  const count = Math.min(tris.length, LAYOUT.MAX_TRIS);
  const base = LAYOUT.OFF_TRI_IN >> 2;
  for (let i = 0; i < count; i++) {
    const t = tris[i];
    const off = base + i * 12;
    f32View[off]     = t[0][0]; f32View[off + 1]  = t[0][1]; f32View[off + 2]  = t[0][2];
    f32View[off + 3] = t[1][0]; f32View[off + 4]  = t[1][1]; f32View[off + 5]  = t[1][2];
    f32View[off + 6] = t[2][0]; f32View[off + 7]  = t[2][1]; f32View[off + 8]  = t[2][2];
    f32View[off + 9] = t[3][0]; f32View[off + 10] = t[3][1]; f32View[off + 11] = t[3][2];
  }
  wasm.set_tri_count(count);
  return count;
}

export function readVisibleTris(count) {
  const base = LAYOUT.OFF_TRI_OUT >> 2;
  const result = [];
  for (let i = 0; i < count; i++) {
    const off = base + i * 12;
    result.push({
      p0x: f32View[off],     p0y: f32View[off + 1],  p0z: f32View[off + 2],
      p1x: f32View[off + 3], p1y: f32View[off + 4],  p1z: f32View[off + 5],
      p2x: f32View[off + 6], p2y: f32View[off + 7],  p2z: f32View[off + 8],
      r: f32View[off + 9],   g: f32View[off + 10],   b: f32View[off + 11],
    });
  }
  return result;
}

export function readMetrics() {
  const base = LAYOUT.OFF_METRICS >> 2;
  return {
    trisProcessed: i32View[base],
    trisVisible: i32View[base + 1],
    leavesActive: i32View[base + 2],
    grassActive: i32View[base + 3],
    creaturesActive: i32View[base + 4],
  };
}

export function uploadGrassInstances(instances) {
  const count = Math.min(instances.length, LAYOUT.MAX_GRASS);
  const base = LAYOUT.OFF_GRASS >> 2;
  for (let i = 0; i < count; i++) {
    const g = instances[i];
    const off = base + i * 8;
    f32View[off]     = g[0];
    f32View[off + 1] = g[1];
    f32View[off + 2] = g[2];
    f32View[off + 3] = g[3];
    f32View[off + 4] = 0;
    f32View[off + 5] = 0;
    f32View[off + 6] = g[4];
    f32View[off + 7] = g[5];
  }
  wasm.set_grass_count(count);
  return count;
}

export function readLeaves() {
  const count = wasm.get_leaf_count();
  const base = LAYOUT.OFF_LEAVES >> 2;
  const result = [];
  for (let i = 0; i < LAYOUT.MAX_LEAVES; i++) {
    const off = base + i * 8;
    const life = f32View[off + 6];
    if (life <= 0) continue;
    const maxLife = f32View[off + 7];
    result.push({
      x: f32View[off], y: f32View[off + 1], z: f32View[off + 2],
      life, maxLife,
      alpha: Math.min(life / maxLife, 1) * Math.min(life, 1),
    });
  }
  return result;
}

export function readGrassVisible() {
  const base = LAYOUT.OFF_GRASS >> 2;
  const result = [];
  const total = i32View[(LAYOUT.OFF_METRICS + 12) >> 2] || 0;
  for (let i = 0; i < LAYOUT.MAX_GRASS; i++) {
    const off = base + i * 8;
    if (f32View[off + 5] <= 0) continue;
    result.push({
      x: f32View[off], y: f32View[off + 1], z: f32View[off + 2],
      height: f32View[off + 3],
      sway: f32View[off + 4],
    });
  }
  return result;
}

export function readCreatures() {
  const base = LAYOUT.OFF_CREATURES >> 2;
  const result = [];
  for (let i = 0; i < LAYOUT.MAX_CREATURES; i++) {
    const off = base + i * 8;
    const life = f32View[off + 5];
    if (life <= 0) continue;
    result.push({
      x: f32View[off], y: f32View[off + 1], z: f32View[off + 2],
      vx: f32View[off + 3], vz: f32View[off + 4],
      life,
    });
  }
  return result;
}

// ── Horror entity system ──

/**
 * Upload horror simulation config to WASM.
 * @param {object} cfg - { writhe, agitation, pulseSpeed, springK, damping, twitchChance }
 */
export function uploadHorrorConfig(cfg) {
  const base = LAYOUT.OFF_HORROR_CFG >> 2;
  f32View[base]     = cfg.writhe || 0;
  f32View[base + 1] = cfg.agitation || 0;
  f32View[base + 2] = cfg.pulseSpeed || 1;
  f32View[base + 3] = cfg.springK || 8;
  f32View[base + 4] = cfg.damping || 4;
  f32View[base + 5] = cfg.twitchChance || 0;
  f32View[base + 6] = 0;
  f32View[base + 7] = 0;
}

/**
 * Write an entity header into WASM memory.
 * @param {number} idx - entity index (0–7)
 * @param {object} ent - entity data
 */
export function writeHorrorEntity(idx, ent) {
  if (idx >= LAYOUT.MAX_HORROR_ENT) return;
  const base = (LAYOUT.OFF_HORROR_ENT >> 2) + idx * 16;
  f32View[base]      = ent.x;
  f32View[base + 1]  = ent.y;
  f32View[base + 2]  = ent.z;
  f32View[base + 3]  = ent.life || 30;
  f32View[base + 4]  = ent.seed || 0;
  f32View[base + 5]  = ent.segStart || 0;
  f32View[base + 6]  = ent.segCount || 0;
  f32View[base + 7]  = ent.agitation || 0;
  f32View[base + 8]  = ent.pulsePhase || 0;
  f32View[base + 9]  = ent.active ? 1 : 0;
  f32View[base + 10] = ent.scale || 1;
  f32View[base + 11] = 0; // cam_dx (updated per frame)
  f32View[base + 12] = 0; // cam_dz
  f32View[base + 13] = 0;
  f32View[base + 14] = 0;
  f32View[base + 15] = 0;
}

/**
 * Write a segment into WASM memory.
 * @param {number} idx - segment index (0–511)
 * @param {object} seg - segment data
 */
export function writeHorrorSegment(idx, seg) {
  if (idx >= LAYOUT.MAX_HORROR_SEG) return;
  const base = (LAYOUT.OFF_HORROR_SEG >> 2) + idx * 12;
  f32View[base]      = seg.x;       // current pos
  f32View[base + 1]  = seg.y;
  f32View[base + 2]  = seg.z;
  f32View[base + 3]  = seg.x;       // rest pos = initial pos
  f32View[base + 4]  = seg.y;
  f32View[base + 5]  = seg.z;
  f32View[base + 6]  = 0;           // velocity
  f32View[base + 7]  = 0;
  f32View[base + 8]  = 0;
  f32View[base + 9]  = seg.phase || 0;
  f32View[base + 10] = seg.size || 0.1;
  // Encode flags: type * 100000 + parent_idx_1based * 100 + entity_id + 1
  f32View[base + 11] = seg.type * 100000 + (seg.parentIdx + 1) * 100 + seg.entityId + 1;
}

/**
 * Read all active horror segments from WASM memory.
 * Returns array of segment objects for rendering.
 */
export function readHorrorSegments() {
  const base = LAYOUT.OFF_HORROR_SEG >> 2;
  const result = [];
  for (let i = 0; i < LAYOUT.MAX_HORROR_SEG; i++) {
    const off = base + i * 12;
    const flags = f32View[off + 11];
    if (flags <= 0) continue;
    const segType = Math.floor(flags / 100000);
    const remainder = flags - segType * 100000;
    const parentIdx1 = Math.floor(remainder / 100);
    const entPlusOne = remainder - parentIdx1 * 100;
    result.push({
      idx: i,
      x: f32View[off], y: f32View[off + 1], z: f32View[off + 2],
      restX: f32View[off + 3], restY: f32View[off + 4], restZ: f32View[off + 5],
      vx: f32View[off + 6], vy: f32View[off + 7], vz: f32View[off + 8],
      phase: f32View[off + 9],
      size: f32View[off + 10],
      type: segType,
      parentIdx: parentIdx1 - 1,  // back to 0-based, -1 = no parent
      entityId: Math.round(entPlusOne - 1),
    });
  }
  return result;
}

/**
 * Read horror entity headers from WASM memory.
 */
export function readHorrorEntities() {
  const base = LAYOUT.OFF_HORROR_ENT >> 2;
  const result = [];
  const count = wasm.get_horror_ent_count();
  for (let i = 0; i < count; i++) {
    const off = base + i * 16;
    if (f32View[off + 9] <= 0) continue; // not active
    result.push({
      idx: i,
      x: f32View[off], y: f32View[off + 1], z: f32View[off + 2],
      segStart: f32View[off + 5],
      segCount: f32View[off + 6],
    });
  }
  return result;
}

/**
 * Move a horror entity and all its segments by a delta.
 */
export function moveHorrorEntity(entIdx, dx, dy, dz) {
  const entBase = (LAYOUT.OFF_HORROR_ENT >> 2) + entIdx * 16;
  f32View[entBase]     += dx;
  f32View[entBase + 1] += dy;
  f32View[entBase + 2] += dz;

  const segStart = Math.round(f32View[entBase + 5]);
  const segCount = Math.round(f32View[entBase + 6]);
  const segBase = LAYOUT.OFF_HORROR_SEG >> 2;

  for (let i = 0; i < segCount; i++) {
    const off = segBase + (segStart + i) * 12;
    if (f32View[off + 11] <= 0) continue;
    // current pos
    f32View[off]     += dx;
    f32View[off + 1] += dy;
    f32View[off + 2] += dz;
    // rest pos
    f32View[off + 3] += dx;
    f32View[off + 4] += dy;
    f32View[off + 5] += dz;
  }
}

/**
 * Clear all horror data from WASM memory.
 */
export function clearHorrorBuffers() {
  const start = LAYOUT.OFF_HORROR_CFG >> 2;
  const end = (LAYOUT.OFF_HORROR_SEG + LAYOUT.MAX_HORROR_SEG * LAYOUT.HORROR_SEG_STRIDE) >> 2;
  for (let i = start; i < end; i++) f32View[i] = 0;
}
