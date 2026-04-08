/**
 * Chunk lifecycle manager.
 *
 * Tracks which chunks are active, loads/evicts as the player moves,
 * and rebuilds the merged triangle + grass buffers when the active set changes.
 */

import { generateChunk } from './chunk-gen.js';
import { groundYFast } from './terrain.js';
import { DEFAULT_WORLD_SEED } from './seed.js';
import { uploadTriangles, uploadGrassInstances } from '../wasm-bridge.js';

const CHUNK_DEPTH = 16;
const ACTIVE_RADIUS = 4; // current chunk ± 4

export class ChunkManager {
  constructor(worldSeed = DEFAULT_WORLD_SEED) {
    this.worldSeed = worldSeed;
    this.chunkDepth = CHUNK_DEPTH;
    this.activeChunks = new Map(); // coord → chunk data
    this.currentCoord = null;
    this.totalTriCount = 0;
    this.debugEnabled = false;

    // Scenic beats from active chunks (for glow effects etc)
    this.activeBeats = [];
    // All path nodes from active chunks, sorted by Z
    this.activePathNodes = [];
  }

  /** Which chunk coord does this Z position fall in? */
  coordForZ(z) {
    return Math.floor(z / this.chunkDepth);
  }

  /**
   * Call once per frame with the player's current Z position.
   * Returns true if the active chunk set changed (buffer was rebuilt).
   */
  update(playerZ) {
    const coord = this.coordForZ(playerZ);
    if (coord === this.currentCoord) return false;

    this.currentCoord = coord;
    const needed = new Set();
    for (let c = coord - ACTIVE_RADIUS; c <= coord + ACTIVE_RADIUS; c++) {
      needed.add(c);
    }

    // Evict chunks no longer needed
    let changed = false;
    for (const c of this.activeChunks.keys()) {
      if (!needed.has(c)) {
        this.activeChunks.delete(c);
        changed = true;
      }
    }

    // Load new chunks
    for (const c of needed) {
      if (!this.activeChunks.has(c)) {
        const chunk = generateChunk(this.worldSeed, c, this.chunkDepth);
        this.activeChunks.set(c, chunk);
        changed = true;
      }
    }

    if (changed) {
      this._rebuild();
    }
    return changed;
  }

  /** Force a full rebuild (e.g. after seed change). */
  reset(newSeed) {
    if (newSeed !== undefined) this.worldSeed = newSeed;
    this.activeChunks.clear();
    this.currentCoord = null;
    this.activeBeats = [];
    this.activePathNodes = [];
  }

  /** Rebuild the merged triangle buffer and upload to WASM. */
  _rebuild() {
    // Merge all tris from active chunks, sorted by coord
    const sortedCoords = Array.from(this.activeChunks.keys()).sort((a, b) => a - b);
    const allTris = [];
    const allGrass = [];
    const allBeats = [];
    const allPathNodes = [];

    for (const c of sortedCoords) {
      const chunk = this.activeChunks.get(c);
      allTris.push(...chunk.tris);
      allGrass.push(...chunk.grassInstances);
      allBeats.push(...chunk.scenicBeats);
      allPathNodes.push(...chunk.pathNodes);
    }

    this.totalTriCount = uploadTriangles(allTris);
    uploadGrassInstances(allGrass);
    this.activeBeats = allBeats;
    this.activePathNodes = allPathNodes;
  }

  /** Get fireplaces from active chunks (for glow/flame rendering). */
  getFireplaces() {
    return this.activeBeats
      .filter(b => b.type === 'fireplace')
      .map(b => {
        const gy = groundYFast(b.x, b.z);
        return [b.x, gy, b.z];
      });
  }

  /** Get lamp posts from active chunks (for glow rendering). */
  getLamps() {
    return this.activeBeats
      .filter(b => b.type === 'lamp')
      .map(b => {
        const gy = groundYFast(b.x, b.z);
        return [b.x, gy, b.z];
      });
  }

  /** Build fire shadow casters near a given fireplace position. */
  getFireShadowCasters(fireplacePos) {
    const TREE_HEIGHTS = { A: 3.6, B: 4.4, C: 4.0 };
    const TREE_CANOPY = { A: 1.4, B: 1.6, C: 1.0 };
    const fpx = fireplacePos[0], fpz = fireplacePos[2];
    const casters = [];
    for (const chunk of this.activeChunks.values()) {
      for (const tree of chunk.trees) {
        const dx = tree.x - fpx, dz = tree.z - fpz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 10) continue;
        const gy = groundYFast(tree.x, tree.z);
        casters.push({
          x: tree.x,
          z: tree.z,
          gy,
          height: TREE_HEIGHTS[tree.type] * tree.scale,
          radius: TREE_CANOPY[tree.type] * tree.scale,
        });
      }
    }
    return casters;
  }

  /**
   * Generate breathing-displaced canopy triangles for all active trees.
   * Only includes trees within `radius` of the camera for performance.
   * @param {number} growthY - additional Y offset (hell mode tree growth)
   * Returns a flat array of tris suitable for drawDynamicTris.
   */
  getBreathingTris(time, camX, camZ, radius = 35, growthY = 0) {
    const r2 = radius * radius;
    const out = [];
    for (const chunk of this.activeChunks.values()) {
      for (const tree of chunk.trees) {
        const dx = tree.x - camX, dz = tree.z - camZ;
        if (dx * dx + dz * dz > r2) continue;

        const breath = Math.sin(time * tree.speed + tree.phase);
        const amp = tree.amplitude;
        // Per-tree growth varies slightly by phase for organic feel
        const treeGrowth = growthY * (0.8 + 0.4 * Math.sin(tree.phase * 2.3));

        for (const layer of tree.canopyLayers) {
          const w = layer.weight;
          const dy = breath * amp * w + treeGrowth * w;
          const layerTris = layer.tris;
          for (let i = 0; i < layerTris.length; i++) {
            const [a, b, c, col] = layerTris[i];
            out.push([
              [a[0], a[1] + dy, a[2]],
              [b[0], b[1] + dy, b[2]],
              [c[0], c[1] + dy, c[2]],
              col,
            ]);
          }
        }
      }
    }
    return out;
  }

  /**
   * Generate elongated trunk extensions for hell mode tree growth.
   * Produces dark trunk columns growing from the top of existing trunks.
   */
  getGrowthTrunkTris(camX, camZ, growthY, radius = 35) {
    if (growthY <= 0.01) return [];
    const TREE_HEIGHTS = { A: 3.6, B: 4.4, C: 4.0 };
    const TRUNK_W = { A: 0.12, B: 0.15, C: 0.10 };
    const DARK_TRUNK = [0.18, 0.10, 0.05];
    const DARKER_TRUNK = [0.12, 0.07, 0.03];
    const r2 = radius * radius;
    const out = [];

    for (const chunk of this.activeChunks.values()) {
      for (const tree of chunk.trees) {
        const dx = tree.x - camX, dz = tree.z - camZ;
        if (dx * dx + dz * dz > r2) continue;

        const treeGrowth = growthY * (0.8 + 0.4 * Math.sin(tree.phase * 2.3));
        if (treeGrowth < 0.05) continue;

        const gy = groundYFast(tree.x, tree.z);
        const baseH = TREE_HEIGHTS[tree.type] * tree.scale;
        const w = TRUNK_W[tree.type] * tree.scale;
        const topY = gy + baseH * 0.6; // roughly where trunk top is
        const extH = treeGrowth;

        // Slight wobble to make it look unnatural
        const wobX = Math.sin(tree.phase * 3.1 + treeGrowth * 0.5) * 0.04 * treeGrowth;
        const wobZ = Math.cos(tree.phase * 2.7 + treeGrowth * 0.3) * 0.04 * treeGrowth;

        const tx = tree.x + wobX;
        const tz = tree.z + wobZ;

        // Narrow as it grows — tapers to 60%
        const topW = w * 0.6;

        // 4 faces of the trunk extension
        const bfl = [tx - w, topY, tz - w];
        const bfr = [tx + w, topY, tz - w];
        const bbl = [tx - w, topY, tz + w];
        const bbr = [tx + w, topY, tz + w];
        const tfl = [tx - topW + wobX, topY + extH, tz - topW + wobZ];
        const tfr = [tx + topW + wobX, topY + extH, tz - topW + wobZ];
        const tbl = [tx - topW + wobX, topY + extH, tz + topW + wobZ];
        const tbr = [tx + topW + wobX, topY + extH, tz + topW + wobZ];

        // Front/back faces
        out.push([bfl, tfr, bfr, DARK_TRUNK]);
        out.push([bfl, tfl, tfr, DARK_TRUNK]);
        out.push([bbl, bbr, tbr, DARKER_TRUNK]);
        out.push([bbl, tbr, tbl, DARKER_TRUNK]);
        // Side faces
        out.push([bfl, bbl, tbl, DARK_TRUNK]);
        out.push([bfl, tbl, tfl, DARK_TRUNK]);
        out.push([bfr, tfr, tbr, DARKER_TRUNK]);
        out.push([bfr, tbr, bbr, DARKER_TRUNK]);
      }
    }
    return out;
  }

  /** Debug info about current chunk state. */
  getDebugInfo() {
    const sortedCoords = Array.from(this.activeChunks.keys()).sort((a, b) => a - b);
    const chunks = sortedCoords.map(c => {
      const chunk = this.activeChunks.get(c);
      return `[${c}] z:${chunk.zMin}-${chunk.zMax} tris:${chunk.triCount}`;
    });
    return {
      seed: this.worldSeed.toString(16),
      currentCoord: this.currentCoord,
      totalTris: this.totalTriCount,
      chunks,
    };
  }
}
