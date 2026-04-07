/**
 * Deterministic path generation per chunk.
 *
 * The path is a 1D chain of control points along the Z direction.
 * Each chunk produces NODES_PER_CHUNK interior nodes plus shared
 * boundary nodes with its neighbors. Boundary points are derived
 * solely from hash(worldSeed, coord) so adjacent chunks always agree.
 */

import { createRNG, hashCoord } from './seed.js';

const NODES_PER_CHUNK = 5;

// Shared ground-height function (same as scene.js / camera.js)
export function groundY(x, z) {
  return Math.sin(x * 0.3) * 0.08 + Math.cos(z * 0.25) * 0.06 +
    Math.sin(x * 0.7 + z * 0.5) * 0.04;
}

/**
 * Compute the boundary path point at the seam between chunk `coord` and `coord+1`.
 * This is the Z = (coord+1)*chunkDepth line.
 * Returns [x, y, z] — deterministic from worldSeed + coord alone.
 */
export function boundaryPoint(worldSeed, coord, chunkDepth) {
  const z = (coord + 1) * chunkDepth;
  const rng = createRNG(hashCoord(worldSeed, coord * 7 + 31337));
  const x = rng.range(-2.5, 2.5);
  const y = groundY(x, z);
  return [x, y, z];
}

/**
 * Generate path nodes for a single chunk.
 * Returns an array of [x, y, z] points ordered by increasing Z.
 * First point = entry boundary, last point = exit boundary.
 */
export function generatePathNodes(worldSeed, coord, chunkDepth) {
  const zMin = coord * chunkDepth;
  const zMax = (coord + 1) * chunkDepth;

  // Entry boundary: shared with previous chunk
  const entry = coord === 0
    ? [0, groundY(0, zMin), zMin]
    : boundaryPoint(worldSeed, coord - 1, chunkDepth);

  // Exit boundary: shared with next chunk
  const exit = boundaryPoint(worldSeed, coord, chunkDepth);

  // Interior nodes
  const rng = createRNG(hashCoord(worldSeed, coord));
  const nodes = [entry];
  for (let i = 1; i <= NODES_PER_CHUNK; i++) {
    const t = i / (NODES_PER_CHUNK + 1);
    const z = zMin + t * chunkDepth;
    // Interpolate between entry/exit x, then add wander
    const baseX = entry[0] + (exit[0] - entry[0]) * t;
    const wander = rng.range(-1.5, 1.5);
    const x = Math.max(-3, Math.min(3, baseX + wander));
    const y = groundY(x, z);
    nodes.push([x, y, z]);
  }
  nodes.push(exit);

  return nodes;
}
