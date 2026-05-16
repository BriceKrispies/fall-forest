/**
 * Horizontal (XZ) collision resolution for the player and other walking
 * entities. Two effects, both circle-based:
 *
 *   Trunks  — hard. Push the entity out along the surface normal so the
 *             remaining motion glides tangent to the circle (sliding).
 *   Canopy  — soft. While inside a canopy circle the entity's speed is
 *             multiplied down to give "pushing through branches" feel.
 *
 * Colliders are plain objects { x, z, trunkR, canopyR } produced by the
 * chunk system. The resolver is collider-agnostic — bushes, rocks, etc.
 * can later be expressed as the same shape.
 */

// How much the canopy multiplies movement speed by. 0.75 = mild drag.
const CANOPY_SPEED_MULT = 0.75;
// Floor on stacked canopy slowdown so a thicket cannot grind the player to
// a halt.
const CANOPY_FLOOR = 0.55;

/**
 * Compute the speed multiplier to apply to movement originating at (x, z)
 * given the surrounding colliders. Returns 1 when standing in the open.
 */
export function canopySpeedScale(x, z, colliders) {
  let scale = 1;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz < c.canopyR * c.canopyR) {
      scale *= CANOPY_SPEED_MULT;
      if (scale <= CANOPY_FLOOR) return CANOPY_FLOOR;
    }
  }
  return scale;
}

/**
 * Push (x, z) out of every trunk circle it overlaps. Sliding falls out of
 * this naturally: the displacement is purely radial, so any tangential
 * component of the original motion survives.
 *
 * Iterated a few times so resolving one trunk does not leave the entity
 * overlapping another. Two passes is enough for normal walking; the third
 * is cheap insurance for the rare case of being wedged between two trees.
 */
export function resolveTrunkCollisions(x, z, colliders, playerRadius = 0.3) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const r = c.trunkR + playerRadius;
      const dx = x - c.x, dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      x += dx * push;
      z += dz * push;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}
