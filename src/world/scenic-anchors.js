/**
 * Scenic anchors — authored-feeling composition points inside a chunk.
 *
 * Each anchor is a small clustered moment (grove, flower patch, fallen log,
 * etc.) placed deterministically per chunk. Anchors *drive* prop placement:
 * the props they contribute are merged into the chunk's geometry passes so
 * the visible world reflects the authored composition rather than uniform
 * background noise.
 *
 * Anchors are pure data — no rendering — and remain stable for a given
 * (worldSeed, cx, cz). Future systems (oddities, collectibles, ambient
 * sound) attach to anchors via their stable IDs.
 */

import { chunkBounds, chunkRNG } from './chunk-coords.js';

export const ANCHOR_TYPES = Object.freeze({
  GROVE: 'grove',
  STUMP_CIRCLE: 'stump_circle',
  FLOWER_PATCH: 'flower_patch',
  FALLEN_LOG: 'fallen_log',
  SMALL_CLEARING: 'small_clearing',
  STRANGE_TREE: 'strange_tree',
  ROCK_CLUSTER: 'rock_cluster',
  PATH_EDGE_GROWTH: 'path_edge_growth',
  DENSE_BUSH_POCKET: 'dense_bush_pocket',
});

const ANCHOR_WEIGHTS = {
  grove: 18,
  flower_patch: 14,
  rock_cluster: 12,
  path_edge_growth: 12, // only available where a path exists
  fallen_log: 10,
  small_clearing: 10,
  dense_bush_pocket: 10,
  stump_circle: 8,
  strange_tree: 6,
};

const PATH_ONLY = new Set(['path_edge_growth']);

/** Footprint radius hint per anchor type — used for slot offsets and spacing. */
export const ANCHOR_FOOTPRINTS = Object.freeze({
  grove: 2.5,
  stump_circle: 1.8,
  flower_patch: 1.2,
  fallen_log: 1.8,
  small_clearing: 2.8,
  strange_tree: 1.5,
  rock_cluster: 1.4,
  path_edge_growth: 2.0,
  dense_bush_pocket: 1.6,
});

const TREE_TYPES = ['A', 'B', 'C'];

// ── Weighted picker ──

function weightedPick(rng, weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let r = rng.next() * total;
  for (const k in weights) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  // numeric drift fallback
  const keys = Object.keys(weights);
  return keys[keys.length - 1];
}

function pickAnchorType(rng, hasPath) {
  if (hasPath) return weightedPick(rng, ANCHOR_WEIGHTS);
  const filtered = {};
  for (const k in ANCHOR_WEIGHTS) {
    if (!PATH_ONLY.has(k)) filtered[k] = ANCHOR_WEIGHTS[k];
  }
  return weightedPick(rng, filtered);
}

// ── Placement ──

function distToPath(x, z, pathNodes) {
  if (!pathNodes || pathNodes.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < pathNodes.length - 1; i++) {
    const ax = pathNodes[i][0], az = pathNodes[i][2];
    const bx = pathNodes[i + 1][0], bz = pathNodes[i + 1][2];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 0.001) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const ex = x - (ax + t * dx), ez = z - (az + t * dz);
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d < best) best = d;
  }
  return best;
}

const PATH_KEEPOUT = 2.4;
const ANCHOR_MIN_SEP = 5.0;

function pickAnchorPosition(rng, type, cx, cz, size, pathNodes, existing) {
  const { xMin, xMax, zMin, zMax } = chunkBounds(cx, cz, size);
  const pad = 1.6;

  for (let attempt = 0; attempt < 12; attempt++) {
    let x, z;
    if (type === ANCHOR_TYPES.PATH_EDGE_GROWTH && pathNodes && pathNodes.length >= 2) {
      // Snap to a point along the path, then offset perpendicular.
      const t = rng.next();
      const segIdx = Math.min(Math.floor(t * (pathNodes.length - 1)), pathNodes.length - 2);
      const f = t * (pathNodes.length - 1) - segIdx;
      const a = pathNodes[segIdx], b = pathNodes[segIdx + 1];
      const px = a[0] + (b[0] - a[0]) * f;
      const pz = a[2] + (b[2] - a[2]) * f;
      const side = rng.next() > 0.5 ? 1 : -1;
      x = px + side * rng.range(1.6, 2.6);
      z = pz + rng.range(-0.4, 0.4);
      x = Math.max(xMin + pad, Math.min(xMax - pad, x));
      z = Math.max(zMin + pad, Math.min(zMax - pad, z));
    } else {
      x = rng.range(xMin + pad, xMax - pad);
      z = rng.range(zMin + pad, zMax - pad);
      // Keep anchors off the path so the path stays walkable.
      if (distToPath(x, z, pathNodes) < PATH_KEEPOUT) continue;
    }

    let collides = false;
    for (let i = 0; i < existing.length; i++) {
      const a = existing[i];
      const dx = a.x - x, dz = a.z - z;
      if (dx * dx + dz * dz < ANCHOR_MIN_SEP * ANCHOR_MIN_SEP) {
        collides = true;
        break;
      }
    }
    if (!collides) return { x, z };
  }
  // Fallback after rejection failures: accept any in-chunk position.
  return {
    x: rng.range(xMin + pad, xMax - pad),
    z: rng.range(zMin + pad, zMax - pad),
  };
}

// ── Per-anchor prop authoring ──
// Each branch returns a list of { kind, ... } records that the chunk
// generator merges into the appropriate placement bucket.

function groveProps(rng, ax, az) {
  const count = 3 + Math.floor(rng.next() * 2); // 3-4
  const out = [];
  const startAngle = rng.range(0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const angle = startAngle + (i / count) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const r = rng.range(0.7, 1.7);
    out.push({
      kind: 'tree',
      type: TREE_TYPES[Math.floor(rng.next() * TREE_TYPES.length)],
      x: ax + Math.cos(angle) * r,
      z: az + Math.sin(angle) * r,
      scale: rng.range(0.7, 1.1),
      rot: rng.range(0, Math.PI * 2),
    });
  }
  return out;
}

function stumpCircleProps(rng, ax, az) {
  const count = 3 + Math.floor(rng.next() * 3); // 3-5
  const radius = rng.range(0.9, 1.4);
  const startAngle = rng.range(0, Math.PI * 2);
  const out = [];
  for (let i = 0; i < count; i++) {
    const angle = startAngle + (i / count) * Math.PI * 2 + rng.range(-0.12, 0.12);
    out.push({
      kind: 'stump',
      x: ax + Math.cos(angle) * radius,
      z: az + Math.sin(angle) * radius,
      scale: rng.range(0.75, 0.95),
    });
  }
  return out;
}

function flowerPatchProps(rng, ax, az) {
  const out = [{
    kind: 'flowers',
    x: ax, z: az,
    count: 6 + Math.floor(rng.next() * 4),
    spread: 0.7,
    seed: Math.floor(rng.next() * 1000),
  }];
  const sub = 1 + Math.floor(rng.next() * 2);
  for (let i = 0; i < sub; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(0.5, 1.0);
    out.push({
      kind: 'flowers',
      x: ax + Math.cos(angle) * r,
      z: az + Math.sin(angle) * r,
      count: 3 + Math.floor(rng.next() * 3),
      spread: 0.35,
      seed: Math.floor(rng.next() * 1000),
    });
  }
  return out;
}

function fallenLogProps(rng, ax, az, rot) {
  return [{
    kind: 'log',
    x: ax, z: az,
    len: rng.range(1.5, 2.2),
    scale: 0.85,
    rot,
  }];
}

function clearingProps(rng, ax, az) {
  // Open patch — a single centerpiece prop anchors the eye.
  if (rng.next() < 0.6) {
    return [{ kind: 'stump', x: ax, z: az, scale: rng.range(0.85, 1.0) }];
  }
  return [{ kind: 'rock', x: ax, z: az, scale: rng.range(0.5, 0.7), rot: rng.range(0, Math.PI * 2) }];
}

function strangeTreeProps(rng, ax, az) {
  return [{
    kind: 'tree',
    type: TREE_TYPES[Math.floor(rng.next() * TREE_TYPES.length)],
    x: ax, z: az,
    scale: rng.range(1.6, 2.0),
    rot: rng.range(0, Math.PI * 2),
  }];
}

function rockClusterProps(rng, ax, az) {
  const count = 2 + Math.floor(rng.next() * 2);
  const out = [];
  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(0.25, 0.7);
    out.push({
      kind: 'rock',
      x: ax + Math.cos(angle) * r,
      z: az + Math.sin(angle) * r,
      scale: rng.range(0.4, 0.85),
      rot: rng.range(0, Math.PI * 2),
    });
  }
  return out;
}

function pathEdgeGrowthProps(rng, ax, az) {
  const out = [];
  const bushCount = 2 + Math.floor(rng.next() * 2);
  for (let i = 0; i < bushCount; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(0.3, 0.9);
    out.push({
      kind: 'bush',
      x: ax + Math.cos(angle) * r,
      z: az + Math.sin(angle) * r,
      scale: rng.range(0.7, 1.0),
      rot: rng.range(0, Math.PI * 2),
    });
  }
  out.push({
    kind: 'flowers',
    x: ax, z: az,
    count: 4 + Math.floor(rng.next() * 4),
    spread: 0.5,
    seed: Math.floor(rng.next() * 1000),
  });
  return out;
}

function denseBushPocketProps(rng, ax, az) {
  const count = 4 + Math.floor(rng.next() * 2);
  const out = [];
  const startAngle = rng.range(0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const angle = startAngle + (i / count) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const r = rng.range(0.4, 1.0);
    out.push({
      kind: 'bush',
      x: ax + Math.cos(angle) * r,
      z: az + Math.sin(angle) * r,
      scale: rng.range(0.6, 1.0),
      rot: rng.range(0, Math.PI * 2),
    });
  }
  return out;
}

const ANCHOR_PROP_BUILDERS = {
  grove: groveProps,
  stump_circle: stumpCircleProps,
  flower_patch: flowerPatchProps,
  fallen_log: fallenLogProps,
  small_clearing: clearingProps,
  strange_tree: strangeTreeProps,
  rock_cluster: rockClusterProps,
  path_edge_growth: pathEdgeGrowthProps,
  dense_bush_pocket: denseBushPocketProps,
};

// ── Public entry ──

/**
 * Plan all scenic anchors for a chunk.
 *
 * @returns {Array<{
 *   id: string,
 *   type: string,
 *   index: number,
 *   x: number,
 *   z: number,
 *   rot: number,
 *   footprint: number,
 *   props: Array<{kind: string, ...}>,
 * }>}
 */
export function planAnchors(worldSeed, cx, cz, size, pathNodes) {
  const rng = chunkRNG(worldSeed, cx, cz, 0xA00A);
  // 1-3 anchors per chunk
  const anchorCount = 1 + Math.floor(rng.next() * 3);
  const hasPath = pathNodes && pathNodes.length >= 2;
  const seedHex = (worldSeed >>> 0).toString(16);
  const anchors = [];

  for (let i = 0; i < anchorCount; i++) {
    const type = pickAnchorType(rng, hasPath);
    const pos = pickAnchorPosition(rng, type, cx, cz, size, pathNodes, anchors);
    const rot = rng.range(0, Math.PI * 2);
    const builder = ANCHOR_PROP_BUILDERS[type];
    const props = builder ? builder(rng, pos.x, pos.z, rot) : [];

    anchors.push({
      id: `${seedHex}:${cx},${cz}:a${i}:${type}`,
      type,
      index: i,
      x: pos.x,
      z: pos.z,
      rot,
      footprint: ANCHOR_FOOTPRINTS[type],
      props,
    });
  }

  return anchors;
}
