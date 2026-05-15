/**
 * Discovery slots — deterministic candidate locations attached to anchors.
 *
 * Slots are pure metadata for future systems (oddities, secrets, collectibles).
 * Each slot has a stable ID, a type, and a world position derived from its
 * parent anchor's props. No rendering happens here; the chunk system surfaces
 * slots through query helpers and main.js can optionally render debug
 * markers when chunk debug is on.
 */

import { createRNG } from './seed.js';
import { hashChunkCoord } from './chunk-coords.js';

export const SLOT_TYPES = Object.freeze({
  GROUND: 'ground_slot',
  TREE_BACK: 'tree_back_slot',
  STUMP_TOP: 'stump_top_slot',
  LOG_END: 'log_end_slot',
  FLOWER_CENTER: 'flower_center_slot',
  CLEARING_CENTER: 'clearing_center_slot',
  ROCK_GAP: 'rock_gap_slot',
  PATH_EDGE: 'path_edge_slot',
  BUSH_SHADOW: 'bush_shadow_slot',
});

/**
 * What slots each anchor type offers, in fixed order.
 * Indices are stable, so a slot's ID can include its index.
 */
const ANCHOR_SLOT_OFFERS = {
  grove:              ['tree_back_slot', 'ground_slot'],
  stump_circle:       ['stump_top_slot', 'clearing_center_slot', 'ground_slot'],
  flower_patch:       ['flower_center_slot', 'ground_slot'],
  fallen_log:         ['log_end_slot', 'log_end_slot', 'ground_slot'],
  small_clearing:     ['clearing_center_slot', 'ground_slot', 'ground_slot'],
  strange_tree:       ['tree_back_slot'],
  rock_cluster:       ['rock_gap_slot', 'ground_slot'],
  path_edge_growth:   ['path_edge_slot', 'flower_center_slot'],
  dense_bush_pocket:  ['bush_shadow_slot', 'bush_shadow_slot'],
};

// ── Per-slot-type placement ──
// Each placer returns { x, z, yOffset } in world coords (Y added later from
// groundY at the slot's xz). Returns null if the anchor's props don't support
// this slot type, in which case the slot is dropped silently.

function findProps(anchor, kind) {
  return anchor.props.filter(p => p.kind === kind);
}

function placeTreeBack(anchor, slotIndex) {
  const trees = findProps(anchor, 'tree');
  if (trees.length === 0) return null;
  const tree = trees[slotIndex % trees.length];
  const dx = tree.x - anchor.x;
  const dz = tree.z - anchor.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const offset = 0.35 * tree.scale;
  return {
    x: tree.x + (dx / len) * offset,
    z: tree.z + (dz / len) * offset,
    yOffset: 0,
  };
}

function placeStumpTop(anchor, slotIndex) {
  const stumps = findProps(anchor, 'stump');
  if (stumps.length === 0) return null;
  const stump = stumps[slotIndex % stumps.length];
  return { x: stump.x, z: stump.z, yOffset: 0.45 * (stump.scale ?? 1) };
}

function placeLogEnd(anchor, slotIndex) {
  const log = findProps(anchor, 'log')[0];
  if (!log) return null;
  const end = slotIndex % 2 === 0 ? -1 : 1;
  const halfLen = (log.len ?? 1.2) * 0.5;
  return {
    x: log.x + Math.cos(log.rot) * halfLen * end,
    z: log.z + Math.sin(log.rot) * halfLen * end,
    yOffset: 0.18 * (log.scale ?? 1),
  };
}

function placeFlowerCenter(anchor) {
  const f = findProps(anchor, 'flowers')[0];
  if (f) return { x: f.x, z: f.z, yOffset: 0.12 };
  return { x: anchor.x, z: anchor.z, yOffset: 0.12 };
}

function placeClearingCenter(anchor) {
  return { x: anchor.x, z: anchor.z, yOffset: 0.05 };
}

function placeRockGap(anchor) {
  const rocks = findProps(anchor, 'rock');
  if (rocks.length >= 2) {
    return {
      x: (rocks[0].x + rocks[1].x) * 0.5,
      z: (rocks[0].z + rocks[1].z) * 0.5,
      yOffset: 0.08,
    };
  }
  if (rocks.length === 1) {
    return { x: rocks[0].x + 0.4, z: rocks[0].z + 0.2, yOffset: 0.05 };
  }
  return { x: anchor.x, z: anchor.z, yOffset: 0.05 };
}

function placePathEdge(anchor, slotIndex, rng) {
  return {
    x: anchor.x + rng.range(-0.3, 0.3),
    z: anchor.z + rng.range(-0.3, 0.3),
    yOffset: 0.05,
  };
}

function placeBushShadow(anchor, slotIndex) {
  const bushes = findProps(anchor, 'bush');
  if (bushes.length === 0) return null;
  const bush = bushes[slotIndex % bushes.length];
  const dx = bush.x - anchor.x;
  const dz = bush.z - anchor.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  return {
    x: bush.x + (dx / len) * 0.25,
    z: bush.z + (dz / len) * 0.25,
    yOffset: 0,
  };
}

function placeGround(anchor, slotIndex, rng) {
  const fp = anchor.footprint ?? 1.0;
  return {
    x: anchor.x + rng.range(-fp * 0.7, fp * 0.7),
    z: anchor.z + rng.range(-fp * 0.7, fp * 0.7),
    yOffset: 0,
  };
}

function placeSlot(type, anchor, slotIndex, rng) {
  switch (type) {
    case SLOT_TYPES.TREE_BACK:        return placeTreeBack(anchor, slotIndex);
    case SLOT_TYPES.STUMP_TOP:        return placeStumpTop(anchor, slotIndex);
    case SLOT_TYPES.LOG_END:          return placeLogEnd(anchor, slotIndex);
    case SLOT_TYPES.FLOWER_CENTER:    return placeFlowerCenter(anchor);
    case SLOT_TYPES.CLEARING_CENTER:  return placeClearingCenter(anchor);
    case SLOT_TYPES.ROCK_GAP:         return placeRockGap(anchor);
    case SLOT_TYPES.PATH_EDGE:        return placePathEdge(anchor, slotIndex, rng);
    case SLOT_TYPES.BUSH_SHADOW:      return placeBushShadow(anchor, slotIndex);
    case SLOT_TYPES.GROUND:           return placeGround(anchor, slotIndex, rng);
    default: return null;
  }
}

/**
 * Build all slots for a single anchor.
 *
 * Slot positions are derived from the anchor's prop layout; offsets that
 * need any randomness draw from a slot-specific RNG seeded from
 * (worldSeed, cx, cz, anchor.index). This is independent of the anchor
 * RNG so changing slot logic later cannot disturb anchor placement.
 *
 * @param {function} groundYFn  (x, z) → ground height for the Y component.
 */
export function buildSlotsForAnchor(worldSeed, cx, cz, anchor, groundYFn) {
  const offers = ANCHOR_SLOT_OFFERS[anchor.type] || [];
  if (offers.length === 0) return [];

  const rng = createRNG(hashChunkCoord(worldSeed ^ 0x510750D5, cx + anchor.index * 17, cz));
  const slots = [];

  for (let i = 0; i < offers.length; i++) {
    const type = offers[i];
    const placement = placeSlot(type, anchor, i, rng);
    if (!placement) continue;
    const gy = groundYFn(placement.x, placement.z);
    slots.push({
      id: `${anchor.id}/s${i}:${type}`,
      anchorId: anchor.id,
      type,
      index: i,
      x: placement.x,
      y: gy + placement.yOffset,
      z: placement.z,
    });
  }

  return slots;
}
