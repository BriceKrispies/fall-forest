export const LAYOUT = {
  OFF_MVP: 0,
  OFF_CAM: 64,
  OFF_SUN: 80,
  OFF_CONSTANTS: 96,
  OFF_METRICS: 128,
  OFF_TRI_IN: 256,
  OFF_TRI_OUT: 768256,
  OFF_LEAVES: 1728256,
  OFF_GRASS: 1730304,
  OFF_CREATURES: 1794304,
  TRI_STRIDE: 48,
  LEAF_STRIDE: 32,
  GRASS_STRIDE: 32,
  CREATURE_STRIDE: 32,
  MAX_TRIS: 16000,
  MAX_LEAVES: 64,
  MAX_GRASS: 2000,
  MAX_CREATURES: 16,
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
