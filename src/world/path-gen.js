/**
 * Deterministic path generation along the Z axis.
 *
 * The path is a 1D chain of control points that winds along +Z and lives in
 * the cx=0 column of chunks. Each chunk row (cz) owns NODES_PER_CHUNK interior
 * nodes plus boundary nodes shared with the chunks at cz-1 and cz+1, so the
 * path is C0 continuous across chunk seams.
 *
 * Chunks use a centered grid: chunk cz covers z in
 * [cz*size - size/2, cz*size + size/2).
 */

import { createRNG, hashCoord } from './seed.js';
import { groundY, groundYFast } from './terrain.js';

const NODES_PER_CHUNK = 5;

// Re-export for consumers that import groundY from here.
export { groundY, groundYFast };

/**
 * Path boundary point between chunk `cz` and chunk `cz + 1`.
 * Sits exactly at z = (cz + 0.5) * chunkSize. Derived solely from
 * (worldSeed, cz) so neighbouring chunks always agree.
 */
export function boundaryPoint(worldSeed, cz, chunkSize) {
  const z = cz * chunkSize + chunkSize * 0.5;
  const rng = createRNG(hashCoord(worldSeed, cz * 7 + 31337));
  const x = rng.range(-2.5, 2.5);
  const y = groundY(x, z);
  return [x, y, z];
}

/**
 * Path nodes for a single chunk row (cz), ordered by increasing Z.
 * First node = entry boundary (shared with cz-1).
 * Last node  = exit boundary  (shared with cz+1).
 */
export function generatePathNodes(worldSeed, cz, chunkSize) {
  const half = chunkSize * 0.5;
  const zMin = cz * chunkSize - half;

  const entry = boundaryPoint(worldSeed, cz - 1, chunkSize);
  const exit = boundaryPoint(worldSeed, cz, chunkSize);

  const rng = createRNG(hashCoord(worldSeed, cz));
  const nodes = [entry];
  for (let i = 1; i <= NODES_PER_CHUNK; i++) {
    const t = i / (NODES_PER_CHUNK + 1);
    const z = zMin + t * chunkSize;
    const baseX = entry[0] + (exit[0] - entry[0]) * t;
    const wander = rng.range(-1.5, 1.5);
    const x = Math.max(-3, Math.min(3, baseX + wander));
    const y = groundY(x, z);
    nodes.push([x, y, z]);
  }
  nodes.push(exit);
  return nodes;
}
