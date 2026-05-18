/**
 * blueMushroomRing — uncommon collectible discovery.
 *
 * A ring of chunky blue mushrooms gathered around an anchor object
 * (stump or rock) on the forest floor. Collected by walking up to it.
 * Once collected for a given world seed it is skipped on regeneration.
 */

import { makeBlueMushroomCluster, makeStump, makeStumpShadow } from '../../props.js';

const ID = 'blueMushroomRing';

export const blueMushroomRing = {
  id: ID,
  rarity: 'uncommon',
  cooldownMeters: 95,
  tags: ['collectible', 'forest-floor', 'glow'],
  // Collectibles share a tighter "don't pile collectibles back-to-back" gap.
  tagCooldownMeters: {
    collectible: 70,
    'forest-floor': 40,
    glow: 110,
  },
  minDistanceFromStart: 18,

  canSpawn(ctx) {
    // Want some space — avoid placing right on top of the path centerline.
    return ctx.distanceToPath(ctx.chunkCenter.x, ctx.chunkCenter.z) > 2.0;
  },

  place(ctx) {
    const instanceId = ctx.collectibleId(ID, 0);
    const alreadyCollected = ctx.collectionState.isCollected(instanceId);

    const rng = ctx.makeRNG(ctx.hashString(ID));
    const { bounds, distanceToPath } = ctx;
    let x = 0, z = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const tx = rng.range(bounds.xMin + 1.5, bounds.xMax - 1.5);
      const tz = rng.range(bounds.zMin + 1.5, bounds.zMax - 1.5);
      if (distanceToPath(tx, tz) > 2.4) { x = tx; z = tz; break; }
      if (attempt === 7) { x = tx; z = tz; }
    }

    if (alreadyCollected) {
      // Render nothing for the ring — leave a lonely stump as a hint that
      // something used to be here. Cheap "remains" treatment.
      ctx.addStumpPlacement({ x, z, scale: 0.7 });
      return [{
        instanceId,
        definitionId: ID,
        x, z,
        collectible: false,
        collected: true,
        tags: ['collectible', 'forest-floor'],
        label: 'an empty stump where mushrooms once grew',
      }];
    }

    // Centerpiece: a small stump that the ring forms around.
    const gy = ctx.groundY(x, z);
    ctx.addTris(makeStumpShadow(x, gy, z, 0.8));
    ctx.addTris(makeStump(x, gy, z, 0.8));

    const ringRadius = 0.55 + rng.next() * 0.25;
    const count = 5 + Math.floor(rng.next() * 4);
    const seedNum = Math.floor(rng.next() * 100000);
    ctx.addTris(makeBlueMushroomCluster(x, gy, z, ringRadius, count, seedNum));

    return [{
      instanceId,
      definitionId: ID,
      x, z,
      collectible: true,
      collected: false,
      tags: ['collectible', 'forest-floor', 'glow'],
      collectRadius: 1.4,
      label: 'a ring of blue mushrooms',
    }];
  },
};
