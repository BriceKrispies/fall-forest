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

// Three concentric windows around the player chunk:
//   ACTIVE_RADIUS     — 3x3, used for gameplay/simulation queries (anchors,
//                       discovery slots, nearest-slot lookups).
//   GENERATION_RADIUS — 7x7 buffer. Must be at least one ring larger than
//                       RENDER_RADIUS so chunks newly entering the visible
//                       set were already cached on the previous crossing
//                       — that's what makes "pre-warming" actually happen.
//   RENDER_RADIUS     — chunks submitted to WASM each frame. 5x5 candidates;
//                       ring-atomic admission against MAX_TRIS lets the d²≤4
//                       set (3x3 plus the four cardinal extensions, 13 chunks)
//                       through, pushing the pop-in boundary out to ~32m
//                       chunk-center distance instead of ~24m.
export const ACTIVE_RADIUS = 1;
export const GENERATION_RADIUS = 3;
export const RENDER_RADIUS = 2;

/** World position → chunk coord. */
export function worldToChunk(x, z, size = CHUNK_SIZE) {
  const half = size * 0.5;
  return {
    cx: Math.floor((x + half) / size),
    cz: Math.floor((z + half) / size),
  };
}

/**
 * World-space bounds of a chunk plus center and bounding-circle radius.
 * Center is the geometric chunk center (not the player position); radius is
 * the half-diagonal — useful as a conservative "nearest point" estimate when
 * culling by distance.
 */
export function chunkBounds(cx, cz, size = CHUNK_SIZE) {
  const half = size * 0.5;
  const xMin = cx * size - half;
  const zMin = cz * size - half;
  return {
    xMin,
    xMax: xMin + size,
    zMin,
    zMax: zMin + size,
    centerX: cx * size,
    centerZ: cz * size,
    radius: half * Math.SQRT2,
  };
}

/** Stable string key for a chunk coord (Map key). */
export function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

/** All chunk coords in a (2R+1)^2 window centered on (centerCx, centerCz). */
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
 * Same as `activeChunkCoords` but sorted nearest-first by chunk-grid distance
 * (with the center direction (dirCx, dirCz) used as a tiebreaker bias toward
 * the player's facing/movement direction). Used by the chunk buffer to do
 * "prioritized warmup" — generate the player-facing chunks first when the
 * window shifts on a chunk boundary crossing.
 */
export function chunkCoordsByDistance(centerCx, centerCz, radius, dirCx = 0, dirCz = 0) {
  const out = activeChunkCoords(centerCx, centerCz, radius);
  const dn2 = dirCx * dirCx + dirCz * dirCz;
  const ndx = dn2 > 0 ? dirCx / Math.sqrt(dn2) : 0;
  const ndz = dn2 > 0 ? dirCz / Math.sqrt(dn2) : 0;
  out.sort((a, b) => {
    const adx = a.cx - centerCx, adz = a.cz - centerCz;
    const bdx = b.cx - centerCx, bdz = b.cz - centerCz;
    const da = adx * adx + adz * adz;
    const db = bdx * bdx + bdz * bdz;
    if (da !== db) return da - db;
    // Tiebreak: chunks more "in front of" the requested direction first.
    const ba = adx * ndx + adz * ndz;
    const bb = bdx * ndx + bdz * ndz;
    return bb - ba;
  });
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
