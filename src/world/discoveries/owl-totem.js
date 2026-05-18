/**
 * owlTotem — rare collectible discovery.
 *
 * A chunky carved totem slightly off the path. Stronger silhouette than
 * a stump; serves as a landmark. Collected on proximity. If already
 * collected for the current seed, a weathered "remains" version is
 * placed instead.
 */

import { makeOwlTotem, makeOwlTotemRemains } from '../../props.js';

const ID = 'owlTotem';

export const owlTotem = {
  id: ID,
  rarity: 'rare',
  cooldownMeters: 280,
  tags: ['collectible', 'landmark'],
  tagCooldownMeters: {
    collectible: 90,
    landmark: 200,
  },
  minDistanceFromStart: 60,

  canSpawn(ctx) {
    if (!ctx.pathTangent) return false;
    // Landmark wants breathing room from base anchors.
    for (const a of ctx.anchors) {
      const dx = a.x - ctx.chunkCenter.x;
      const dz = a.z - ctx.chunkCenter.z;
      if (dx * dx + dz * dz < 9) return false;
    }
    return true;
  },

  place(ctx) {
    const instanceId = ctx.collectibleId(ID, 0);
    const alreadyCollected = ctx.collectionState.isCollected(instanceId);

    const rng = ctx.makeRNG(ctx.hashString(ID));
    const [tx, tz] = ctx.pathTangent;
    const [px, pz] = ctx.pathCenter;
    const nx = -tz, nz = tx;
    const side = rng.next() > 0.5 ? 1 : -1;
    const offset = 3.0 + rng.next() * 1.2;
    const along = rng.range(-1.5, 1.5);

    let x = px + nx * side * offset + tx * along;
    let z = pz + nz * side * offset + tz * along;
    const pad = 1.2;
    x = Math.max(ctx.bounds.xMin + pad, Math.min(ctx.bounds.xMax - pad, x));
    z = Math.max(ctx.bounds.zMin + pad, Math.min(ctx.bounds.zMax - pad, z));

    const gy = ctx.groundY(x, z);
    const rot = Math.atan2(px - x, pz - z); // face roughly toward the path

    if (alreadyCollected) {
      ctx.addTris(makeOwlTotemRemains(x, gy, z, 1.0, rot));
      return [{
        instanceId,
        definitionId: ID,
        x, z,
        collectible: false,
        collected: true,
        tags: ['collectible', 'landmark'],
        label: 'a weathered totem stump',
      }];
    }

    ctx.addTris(makeOwlTotem(x, gy, z, 1.0, rot));

    return [{
      instanceId,
      definitionId: ID,
      x, z,
      collectible: true,
      collected: false,
      tags: ['collectible', 'landmark'],
      collectRadius: 1.6,
      label: 'an owl totem',
    }];
  },
};
