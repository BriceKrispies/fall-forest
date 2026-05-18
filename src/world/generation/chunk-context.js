/**
 * ChunkContext — bundle of state and hooks passed to discovery
 * `canSpawn()` and `place()` callbacks.
 *
 * The context owns no policy decisions of its own. It exposes:
 *
 *   • read-only chunk metadata (seed, coords, distances, bounds, path)
 *   • deterministic helpers (rng, hash, collectibleId)
 *   • placement hooks (addPlacement, addTris) that route into the
 *     same buckets the base chunk generator already builds
 *   • access to the spawn ledger and collection state
 *
 * Discoveries should never call into globals — every piece of state
 * they need is on the context.
 */

import { createRNG } from '../seed.js';
import { hashChunkCoord, chunkBounds } from '../chunk-coords.js';

/**
 * Build a ChunkContext for the chunk currently being generated.
 *
 * @param {object} args
 * @param {number} args.worldSeed
 * @param {number} args.cx
 * @param {number} args.cz
 * @param {number} args.size
 * @param {Array}  args.pathNodes
 * @param {Array}  args.anchors           // pre-planned anchors
 * @param {object} args.plan              // chunk plan buckets (treePlacements, etc.)
 * @param {Array}  args.extraTris         // sink for ad-hoc discovery geometry
 * @param {object} args.spawnLedger
 * @param {object} args.collectionState
 * @param {function} args.groundY
 * @param {function} args.groundYFast
 */
export function createChunkContext({
  worldSeed, cx, cz, size,
  pathNodes, anchors, plan, extraTris,
  spawnLedger, collectionState,
  groundY, groundYFast,
}) {
  const bounds = chunkBounds(cx, cz, size);
  const centerX = bounds.centerX;
  const centerZ = bounds.centerZ;
  const chunkCenterDistance = Math.sqrt(centerX * centerX + centerZ * centerZ);
  // Closest point of the chunk's AABB to the origin — a conservative
  // "have we walked far enough for this rarity yet" metric for the
  // minDistanceFromStart gate.
  const nearestX = Math.max(bounds.xMin, Math.min(0, bounds.xMax));
  const nearestZ = Math.max(bounds.zMin, Math.min(0, bounds.zMax));
  const chunkStartDistance = Math.sqrt(nearestX * nearestX + nearestZ * nearestZ);

  // Path tangent at chunk center (if path is present).
  let pathTangent = null;
  let pathCenter = null;
  if (pathNodes && pathNodes.length >= 2) {
    // Find segment closest to chunk center
    let bestD2 = Infinity, bestSeg = 0, bestT = 0, bestPx = 0, bestPz = 0;
    for (let i = 0; i < pathNodes.length - 1; i++) {
      const a = pathNodes[i], b = pathNodes[i + 1];
      const dx = b[0] - a[0], dz = b[2] - a[2];
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-4) continue;
      const t = Math.max(0, Math.min(1, ((centerX - a[0]) * dx + (centerZ - a[2]) * dz) / len2));
      const px = a[0] + t * dx, pz = a[2] + t * dz;
      const ex = centerX - px, ez = centerZ - pz;
      const d2 = ex * ex + ez * ez;
      if (d2 < bestD2) {
        bestD2 = d2; bestSeg = i; bestT = t; bestPx = px; bestPz = pz;
      }
    }
    const a = pathNodes[bestSeg], b = pathNodes[bestSeg + 1];
    const tdx = b[0] - a[0], tdz = b[2] - a[2];
    const tLen = Math.sqrt(tdx * tdx + tdz * tdz) || 1;
    pathTangent = [tdx / tLen, tdz / tLen];
    pathCenter = [bestPx, bestPz];
  }

  // Distance from world point to nearest path segment.
  function distanceToPath(x, z) {
    if (!pathNodes || pathNodes.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 0; i < pathNodes.length - 1; i++) {
      const a = pathNodes[i], b = pathNodes[i + 1];
      const dx = b[0] - a[0], dz = b[2] - a[2];
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-4) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / len2));
      const px = a[0] + t * dx, pz = a[2] + t * dz;
      const ex = x - px, ez = z - pz;
      const d = Math.sqrt(ex * ex + ez * ez);
      if (d < best) best = d;
    }
    return best;
  }

  // Independent RNG streams keyed off (seed, chunk, salt). Salts here use
  // small fixed prime-like constants; discovery-supplied salts hash through
  // the same coord hash so they never collide with base generation streams.
  function makeRNG(salt) {
    return createRNG(hashChunkCoord(worldSeed ^ (salt >>> 0), cx, cz));
  }

  // Hash a string-ish salt deterministically into a 32-bit seed.
  function hashString(s) {
    let h = 0x811C9DC5 | 0;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    }
    return h >>> 0;
  }

  // Stable collectible id: "<discoveryId>@<cx>,<cz>#<slotIndex>".
  function collectibleId(discoveryId, slotIndex = 0) {
    return `${discoveryId}@${cx},${cz}#${slotIndex}`;
  }

  // Placement hooks — mutate the chunk's plan buckets.
  function addTreePlacement(p)    { plan.treePlacements.push(p); plan.features.push({ x: p.x, z: p.z, type: 'tree' }); }
  function addBushPlacement(p)    { plan.bushPlacements.push(p); }
  function addRockPlacement(p)    { plan.rockPlacements.push(p); plan.features.push({ x: p.x, z: p.z, type: 'rock' }); }
  function addStumpPlacement(p)   { plan.stumpPlacements.push(p); plan.features.push({ x: p.x, z: p.z, type: 'stump' }); }
  function addLogPlacement(p)     { plan.logPlacements.push(p); plan.features.push({ x: p.x, z: p.z, type: 'log' }); }
  function addFlowerPlacement(p)  { plan.flowerPlacements.push(p); }
  function addTris(tris) {
    for (let i = 0; i < tris.length; i++) extraTris.push(tris[i]);
  }

  return {
    worldSeed,
    cx, cz, size,
    bounds,
    chunkCenter: { x: centerX, z: centerZ },
    chunkCenterDistance,
    chunkStartDistance,
    pathNodes,
    pathTangent,
    pathCenter,
    anchors,

    // deterministic helpers
    makeRNG,
    hashString,
    collectibleId,

    // queries
    distanceToPath,
    groundY,
    groundYFast,

    // state
    spawnLedger,
    collectionState,

    // placement hooks
    addTreePlacement,
    addBushPlacement,
    addRockPlacement,
    addStumpPlacement,
    addLogPlacement,
    addFlowerPlacement,
    addTris,
  };
}
