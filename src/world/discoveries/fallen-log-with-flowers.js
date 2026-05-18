/**
 * fallenLogWithFlowers — common scenic discovery.
 *
 * A short log lying near the path edge with a small flower cluster
 * nestled beside it. Not collectible — it's authored atmosphere, not a
 * pickup. Reuses the chunk plan's log and flower buckets so it tiles
 * with the base generation pass.
 */

const ID = 'fallenLogWithFlowers';

export const fallenLogWithFlowers = {
  id: ID,
  rarity: 'common',
  cooldownMeters: 25,
  tags: ['scenic'],
  minDistanceFromStart: 0,

  canSpawn(ctx) {
    // Needs a path nearby — this is a roadside scenic moment.
    return ctx.pathTangent !== null && ctx.pathCenter !== null;
  },

  place(ctx) {
    const rng = ctx.makeRNG(ctx.hashString(ID));
    const [tx, tz] = ctx.pathTangent;
    const [px, pz] = ctx.pathCenter;

    // Offset perpendicular to the path, on a random side.
    const nx = -tz, nz = tx;
    const side = rng.next() > 0.5 ? 1 : -1;
    const offset = 1.8 + rng.next() * 0.8;
    const ax = px + nx * side * offset + tx * rng.range(-0.6, 0.6);
    const az = pz + nz * side * offset + tz * rng.range(-0.6, 0.6);

    // Clamp inside the chunk bounds with a small pad so geometry stays inside.
    const pad = 1.2;
    const cx = Math.max(ctx.bounds.xMin + pad, Math.min(ctx.bounds.xMax - pad, ax));
    const cz = Math.max(ctx.bounds.zMin + pad, Math.min(ctx.bounds.zMax - pad, az));

    // The log itself — slightly larger than the base log placements.
    ctx.addLogPlacement({
      x: cx, z: cz,
      len: rng.range(1.6, 2.1),
      scale: 0.9,
      rot: Math.atan2(tz, tx) + rng.range(-0.35, 0.35),
    });

    // Flowers tucked beside the log on the inside (toward the path).
    const fx = cx - nx * side * 0.45;
    const fz = cz - nz * side * 0.45;
    ctx.addFlowerPlacement({
      x: fx, z: fz,
      count: 5 + Math.floor(rng.next() * 4),
      spread: 0.55,
      seed: Math.floor(rng.next() * 1000),
    });

    return [{
      instanceId: ctx.collectibleId(ID, 0),
      definitionId: ID,
      x: cx, z: cz,
      collectible: false,
      tags: ['scenic'],
      label: 'a fallen log nestled in flowers',
    }];
  },
};
