/**
 * Deterministic seeded PRNG and coordinate hashing.
 * All chunk generation flows through this — no Math.random() anywhere.
 */

// Mulberry32: simple, fast, deterministic 32-bit PRNG
function mulberry32(seed) {
  let s = seed | 0;
  return function next() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRNG(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range(min, max) { return min + next() * (max - min); },
    int(min, max) { return Math.floor(min + next() * (max - min)); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
  };
}

// Hash a world seed + chunk coordinate into a per-chunk seed
export function hashCoord(worldSeed, coord) {
  let h = (worldSeed ^ (coord * 2654435761)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

export const DEFAULT_WORLD_SEED = 0xFA11F0E5;
