/**
 * Pure coordinate helpers for the 2D chunk system.
 *
 * The world is tiled into square chunks of `CHUNK_SIZE` meters. The chunk grid
 * is centered on the world origin: chunk (0, 0) spans x in [-S/2, S/2) and
 * z in [-S/2, S/2), so the player's starting position at (0, 0, 0) sits in
 * the middle of chunk (0, 0).
 *
 * The active set is always the 3x3 window of chunks around the player's
 * current chunk.
 */

import { createRNG } from './seed.js';

export const CHUNK_SIZE = 16;
export const ACTIVE_RADIUS = 1; // 3x3 window

/** World position → chunk coord. */
export function worldToChunk(x, z, size = CHUNK_SIZE) {
  const half = size * 0.5;
  return {
    cx: Math.floor((x + half) / size),
    cz: Math.floor((z + half) / size),
  };
}

/** World-space bounds of a chunk. */
export function chunkBounds(cx, cz, size = CHUNK_SIZE) {
  const half = size * 0.5;
  const xMin = cx * size - half;
  const zMin = cz * size - half;
  return { xMin, xMax: xMin + size, zMin, zMax: zMin + size };
}

/** Stable string key for a chunk coord (Map key). */
export function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

/** All 9 chunk coords in the active window centered on (centerCx, centerCz). */
export function activeChunkCoords(centerCx, centerCz, radius = ACTIVE_RADIUS) {
  const out = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      out.push({ cx: centerCx + dx, cz: centerCz + dz });
    }
  }
  return out;
}

/**
 * Deterministic 2D coord → 32-bit seed hash.
 * Mixes worldSeed + cx + cz so every (seed, cx, cz) yields a stable u32.
 */
export function hashChunkCoord(worldSeed, cx, cz) {
  let h = worldSeed | 0;
  h = (h + Math.imul(cx, 0x9E3779B1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
  h = (h + Math.imul(cz, 0xC2B2AE35)) | 0;
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Per-chunk seeded RNG. `salt` produces independent streams for the same
 * chunk (useful when planning vs. animation params).
 */
export function chunkRNG(worldSeed, cx, cz, salt = 0) {
  return createRNG(hashChunkCoord(worldSeed ^ salt, cx, cz));
}
