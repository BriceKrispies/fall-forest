/**
 * Terrain system — layered height and zone computation.
 *
 * Replaces the old flat sinusoidal groundY with a richer, authored-feeling
 * terrain that includes macro land forms, path influence, feature influence
 * (tree mounds, rock seats, etc.), and terrain zones for color variation.
 *
 * All functions are pure and deterministic from (x, z) and seed-derived data.
 * No random state — everything hashes from position.
 */

// ── Low-cost smooth noise (no dependency) ──

/** Hash a 2D coordinate into a pseudo-random [0,1) value. */
function hash2(x, z) {
  let h = (x * 374761393 + z * 668265263 + 1013904223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 1262917439);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Cubic interpolation factor (smootherstep). */
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Linear interpolation. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Value noise at arbitrary (x, z) — smooth, continuous, ~[-0.5, 0.5].
 * Uses integer-lattice hashing + bicubic fade.
 */
function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = fade(x - ix), fz = fade(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz) - 0.5;
}

// ── Macro terrain ──

/**
 * Broad land forms — very low frequency swells and basins.
 * Two octaves of value noise at large scale, producing gentle ±0.5 variation.
 */
function macroHeight(x, z) {
  // Primary swell — wavelength ~25m, amplitude ~0.55
  const h1 = valueNoise(x * 0.04, z * 0.04) * 0.55;
  // Secondary undulation — wavelength ~10m, amplitude ~0.25
  const h2 = valueNoise(x * 0.1 + 7.3, z * 0.1 - 3.1) * 0.25;
  // Very broad tilt — wavelength ~60m, amplitude ~0.3
  const h3 = valueNoise(x * 0.017 - 2.0, z * 0.017 + 5.0) * 0.30;
  // Mid-frequency contour — wavelength ~6m, amplitude ~0.1
  // Adds readable low-poly angular breaks in the near/mid ground
  const h4 = valueNoise(x * 0.17 + 3.5, z * 0.17 - 1.8) * 0.10;
  return h1 + h2 + h3 + h4;
}

// ── Path influence ──

/**
 * Compute signed distance and closest-point data to a polyline path.
 * Returns { dist, nearestX, nearestZ, side } where side is -1/+1.
 */
function pathInfo(x, z, pathNodes) {
  let bestDist = 1e9;
  let bestNx = x, bestNz = z;
  let bestSide = 0;
  for (let i = 0; i < pathNodes.length - 1; i++) {
    const ax = pathNodes[i][0], az = pathNodes[i][2];
    const bx = pathNodes[i + 1][0], bz = pathNodes[i + 1][2];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 0.001) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const cx = ax + t * dx, cz = az + t * dz;
    const ex = x - cx, ez = z - cz;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d < bestDist) {
      bestDist = d;
      bestNx = cx;
      bestNz = cz;
      // Side: cross product sign (left vs right of path direction)
      bestSide = (dx * ez - dz * ex) >= 0 ? 1 : -1;
    }
  }
  return { dist: bestDist, nearestX: bestNx, nearestZ: bestNz, side: bestSide };
}

/**
 * Path carving — the path sinks slightly into terrain, with raised shoulder banks.
 * Returns a height offset given distance from path center.
 *
 *   0–0.6m from center: flat, slightly depressed (the walkable path)
 *   0.6–1.4m: rising shoulder bank
 *   beyond 1.4m: fades to zero
 */
function pathInfluence(distFromPath) {
  const PATH_HALF = 0.7;
  const SHOULDER_END = 2.0;
  const CARVE_DEPTH = -0.14;   // path sinks this much
  const SHOULDER_HEIGHT = 0.18; // banks rise this much

  if (distFromPath < PATH_HALF) {
    // On the path — visible depression
    return CARVE_DEPTH;
  }
  if (distFromPath < SHOULDER_END) {
    // Shoulder bank — rises then fades
    const t = (distFromPath - PATH_HALF) / (SHOULDER_END - PATH_HALF);
    // Bell shape: rises then falls
    const bell = Math.sin(t * Math.PI);
    return lerp(CARVE_DEPTH, SHOULDER_HEIGHT * bell, t);
  }
  return 0;
}

// ── Feature influence ──

/**
 * A feature influence is a localized height deformation around a placed object.
 * Each feature is { x, z, type } where type determines the shape.
 *
 * This is applied during chunk generation by accumulating influences from
 * nearby placed features.
 */

const FEATURE_PROFILES = {
  /** Trees push up a visible root mound around their base */
  tree: {
    radius: 2.5,
    apply(dist, radius) {
      const t = dist / radius;
      if (t >= 1) return 0;
      // Mound shape: raised at center, gentle slope out
      const s = 1 - t;
      return s * s * 0.22;
    },
  },

  /** Rocks settle into the ground — raised center, depressed ring */
  rock: {
    radius: 1.4,
    apply(dist, radius) {
      const t = dist / radius;
      if (t >= 1) return 0;
      const s = 1 - t;
      // Raised center (rock lifts ground), depression around edge
      if (t < 0.3) return s * s * 0.12;
      return -Math.sin((t - 0.3) / 0.7 * Math.PI) * 0.06;
    },
  },

  /** Stumps — raised pad, visible hump */
  stump: {
    radius: 1.0,
    apply(dist, radius) {
      const t = dist / radius;
      if (t >= 1) return 0;
      return (1 - t * t) * 0.10;
    },
  },

  /** Logs — settling depression around the log */
  log: {
    radius: 1.5,
    apply(dist, radius) {
      const t = dist / radius;
      if (t >= 1) return 0;
      // Depression that eases in from edges
      return -(1 - (1 - t) * (1 - t)) * 0.07;
    },
  },

  /** Fireplaces — cleared, visibly depressed hearth */
  fireplace: {
    radius: 2.5,
    apply(dist, radius) {
      const t = dist / radius;
      if (t >= 1) return 0;
      return -(1 - t * t) * 0.12;
    },
  },
};

/**
 * Compute accumulated feature influence at (x, z) given a list of features.
 * Each feature: { x, z, type }
 */
function featureHeight(x, z, features) {
  let h = 0;
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const profile = FEATURE_PROFILES[f.type];
    if (!profile) continue;
    const dx = x - f.x, dz = z - f.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < profile.radius) {
      h += profile.apply(dist, profile.radius);
    }
  }
  return h;
}

// ── Terrain zones ──

/**
 * Terrain zones classify regions of the ground for visual variation.
 * Zone selection is deterministic from position (seeded noise).
 *
 * Returns { zone, intensity } where intensity is 0–1 blend strength.
 */

export const ZONES = {
  NORMAL: 'normal',
  MEADOW: 'meadow',       // gentle grass clearing
  DAMP:   'damp',          // shallow moist hollow
  ROCKY:  'rocky',         // stony ground patch
};

function terrainZone(x, z) {
  // Zone noise — very low frequency, ~20m regions
  const n1 = valueNoise(x * 0.055 + 13.7, z * 0.055 - 8.2);
  const n2 = valueNoise(x * 0.08 - 5.1, z * 0.08 + 11.3);

  // Meadow: smooth positive peaks
  if (n1 > 0.15) {
    return { zone: ZONES.MEADOW, intensity: Math.min(1, (n1 - 0.15) / 0.2) };
  }
  // Damp hollows: negative valleys
  if (n1 < -0.2 && n2 < 0) {
    return { zone: ZONES.DAMP, intensity: Math.min(1, (-n1 - 0.2) / 0.15) };
  }
  // Rocky patches: secondary noise peaks
  if (n2 > 0.2) {
    return { zone: ZONES.ROCKY, intensity: Math.min(1, (n2 - 0.2) / 0.2) };
  }
  return { zone: ZONES.NORMAL, intensity: 0 };
}

/**
 * Height contribution from terrain zone.
 * Meadows are slightly raised, damp hollows slightly depressed, rocky slightly uneven.
 */
function zoneHeight(x, z, zone, intensity) {
  switch (zone) {
    case ZONES.MEADOW:
      return intensity * 0.10;
    case ZONES.DAMP:
      return -intensity * 0.15;
    case ZONES.ROCKY:
      // Chunky angular bumps in rocky areas
      return intensity * valueNoise(x * 0.3, z * 0.3) * 0.20;
    default:
      return 0;
  }
}

// ── Ground color modulation ──

// Zone-specific color tints (blended over the base ground color)
const ZONE_COLORS = {
  [ZONES.NORMAL]:  null,
  [ZONES.MEADOW]:  [0.34, 0.46, 0.19],  // brighter, warmer green — lifted value
  [ZONES.DAMP]:    [0.10, 0.18, 0.10],  // noticeably dark, cold, moist
  [ZONES.ROCKY]:   [0.40, 0.36, 0.28],  // warm grey-brown, desaturated
};

/**
 * Get ground color for a position, given the base color from the chunk grid.
 * Blends zone tint and height-driven value shift so terrain forms read visually.
 */
export function groundColor(x, z, baseColor) {
  const { zone, intensity } = terrainZone(x, z);

  // Start with base color
  let r = baseColor[0], g = baseColor[1], b = baseColor[2];

  // Zone color blend — stronger than before
  const tint = ZONE_COLORS[zone];
  if (tint && intensity > 0.01) {
    const t = intensity * 0.75;
    r += (tint[0] - r) * t;
    g += (tint[1] - g) * t;
    b += (tint[2] - b) * t;
  }

  // Height-driven value shift — raised ground reads lighter/warmer,
  // low ground reads darker/cooler. This makes terrain forms legible.
  const h = macroHeight(x, z);
  // Map height to a value shift: [-0.06, +0.06] range
  const heightShift = Math.max(-0.06, Math.min(0.06, h * 0.08));
  r += heightShift;
  g += heightShift * 0.85; // slightly less green shift — keeps warmth
  b += heightShift * 0.5;  // blue shifts least — raised = warmer

  return [r, g, b];
}

/**
 * Get the terrain zone at a position (for prop placement decisions).
 */
export function getZone(x, z) {
  return terrainZone(x, z);
}

// ── Main terrain height function ──

// Module-level state: set per chunk generation pass
let _activePathNodes = null;
let _activeFeatures = null;

/**
 * Set the path nodes and placed features for the current chunk being generated.
 * This must be called before groundY is used during chunk generation so that
 * path carving and feature influence are computed correctly.
 *
 * Outside of chunk generation (e.g. camera, runtime queries), these default
 * to null and only macro + zone layers are applied.
 */
export function setContext(pathNodes, features) {
  _activePathNodes = pathNodes;
  _activeFeatures = features;
}

export function clearContext() {
  _activePathNodes = null;
  _activeFeatures = null;
}

/**
 * The main terrain height function.
 *
 * Layers (bottom to top):
 *  1. Macro land forms (always)
 *  2. Terrain zone height (always)
 *  3. Path carving + shoulders (when path context set)
 *  4. Feature influence (when features context set)
 */
export function groundY(x, z) {
  let h = 0;

  // Layer 1: macro terrain
  h += macroHeight(x, z);

  // Layer 2: terrain zone
  const { zone, intensity } = terrainZone(x, z);
  h += zoneHeight(x, z, zone, intensity);

  // Layer 3: path influence
  if (_activePathNodes && _activePathNodes.length >= 2) {
    const pi = pathInfo(x, z, _activePathNodes);
    h += pathInfluence(pi.dist);
  }

  // Layer 4: feature influence
  if (_activeFeatures && _activeFeatures.length > 0) {
    h += featureHeight(x, z, _activeFeatures);
  }

  return h;
}

/**
 * Lightweight terrain height for runtime queries (camera, lights, etc.)
 * that only need macro + zone layers — no path/feature context needed.
 */
export function groundYFast(x, z) {
  let h = macroHeight(x, z);
  const { zone, intensity } = terrainZone(x, z);
  h += zoneHeight(x, z, zone, intensity);
  return h;
}
