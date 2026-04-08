# Terrain System

## What it is

A layered height and zone system that replaces the old flat sinusoidal ground with terrain that feels intentionally shaped. The ground now has broad swells, path carving, feature-driven deformation (tree mounds, rock seating), and distinct terrain zones (meadow, damp hollow, rocky patch).

All terrain computation is deterministic and position-based — no random state, everything derives from (x, z) coordinates and seeded noise.

## How it works

The terrain height at any point is the sum of four layers:

### Layer 1: Macro terrain

Four octaves of smooth value noise at different frequencies, producing visible land swells with ±0.55 primary amplitude over ~25m wavelengths, plus secondary undulation (±0.25, ~10m), broad tilt (±0.30, ~60m), and mid-frequency contour breaks (±0.10, ~6m). Total range approximately ±1.2 units. This creates readable hills, basins, and angular contour changes.

### Layer 2: Terrain zones

Deterministic zone classification at each point based on low-frequency noise:

| Zone | Effect | Visual |
|------|--------|--------|
| **Normal** | No modification | Standard ground colors |
| **Meadow** | Raised (+0.10) | Brighter warm green |
| **Damp** | Depressed (-0.15) | Dark, cold, muted |
| **Rocky** | Chunky bumps (±0.20) | Warm grey-brown |

Zones are ~20m regions that blend at edges. Height-driven color shifting makes raised ground read lighter/warmer and low ground darker/cooler.

### Layer 3: Path influence

The path carves visibly into the terrain:
- **0–0.7m from center**: flat, depressed -0.14 (the walkable surface)
- **0.7–2.0m**: rising shoulder bank (+0.18 peak, bell curve)
- **Beyond 2.0m**: no influence

This makes the path feel embedded with visible dirt banks on each side.

### Layer 4: Feature influence

Placed objects deform the ground around them:

| Feature | Effect | Radius |
|---------|--------|--------|
| **Tree** | Root mound, raised center (+0.22) | 2.5m |
| **Rock** | Raised center (+0.12), depression ring (-0.06) | 1.4m |
| **Stump** | Raised pad (+0.10) | 1.0m |
| **Log** | Settling depression (-0.07) | 1.5m |
| **Fireplace** | Depressed hearth (-0.12) | 2.5m |

Features accumulate — a cluster of trees creates a more pronounced mound.

## Architecture

### Files

| File | Role |
|------|------|
| `src/world/terrain.js` | Core terrain module — all layers, zones, colors |
| `src/world/path-gen.js` | Re-exports `groundY` and `groundYFast` from terrain |
| `src/world/chunk-gen.js` | Two-phase generation: plan features, then set context and build geometry |
| `src/camera.js` | Uses `groundYFast` for player height |
| `src/world/chunk-manager.js` | Uses `groundYFast` for runtime queries |

### Two height functions

- **`groundY(x, z)`** — Full terrain with all four layers. Used during chunk generation when path and feature context is set.
- **`groundYFast(x, z)`** — Macro + zone layers only. Used at runtime (camera, light positions) where path/feature context isn't available and full precision isn't needed.

### Context system

During chunk generation, `setContext(pathNodes, features)` activates layers 3–4. After generation, `clearContext()` deactivates them. This avoids passing path/feature arrays through every `groundY` call.

### Chunk generation flow

1. **Plan phase**: determine all feature positions (trees, rocks, stumps, logs, fireplaces), consuming the RNG
2. **Set terrain context** with path nodes and planned features
3. **Build phase**: generate all geometry using terrain-aware `groundY`
4. **Clear context**

## How to tune

### Terrain readability

Terrain forms read through two mechanisms working together:

**Height amplitude** — In `macroHeight`, four noise octaves produce the visible landform contours. The most impactful tuning values are:

```js
const h1 = valueNoise(x * 0.04, z * 0.04) * 0.55;   // primary swell (±0.55)
const h2 = valueNoise(x * 0.1, z * 0.1) * 0.25;      // secondary undulation (±0.25)
const h3 = valueNoise(x * 0.017, z * 0.017) * 0.30;   // broad tilt (±0.30)
const h4 = valueNoise(x * 0.17, z * 0.17) * 0.10;     // mid-frequency contour (±0.10)
```

Increase amplitude multipliers to make forms more dramatic. Increase frequency multipliers for tighter features (but keep them low-poly readable — above ~0.2 frequency you get noise instead of form).

**Mesh resolution** — Ground patches use 3×3 subdivision (`makeGroundPatch` in `props.js`, `res = 3`). This gives ~1.07m cells per 3.2m patch. Features smaller than ~1m won't express clearly in the mesh. Increasing to 4 improves fidelity but costs tri budget.

### Terrain contrast

Height-driven color shifting in `groundColor` makes terrain forms visible:
- Raised ground gets a warm value lift (+0.06 max)
- Low ground gets a cool value drop (-0.06 max)
- The `heightShift` multiplier (currently `h * 0.08`) controls how aggressively height maps to brightness

Zone colors in `ZONE_COLORS` provide broad regional contrast. The zone blend intensity (currently `0.75`) controls how strongly zones override base ground color.

### Prop grounding strength

Each feature type in `FEATURE_PROFILES` controls how strongly props deform the ground:

| Feature | Radius | Peak height | Controls |
|---------|--------|-------------|----------|
| Tree | 2.5m | +0.22 | Root mound visibility |
| Rock | 1.4m | +0.12/−0.06 | Seated-in-ground feel |
| Stump | 1.0m | +0.10 | Raised pad |
| Log | 1.5m | −0.07 | Settling depression |
| Fireplace | 2.5m | −0.12 | Hearth clearing |

To make props feel more grounded, increase the `radius` (wider influence) and the return value amplitude in `apply()`. Tree mounds especially should be visible — they're the primary prop-to-terrain coupling.

### Path shoulder / embed strength

In `pathInfluence`, four constants control path integration:

| Constant | Current | Effect |
|----------|---------|--------|
| `PATH_HALF` | 0.7m | Width of flat walkable center |
| `SHOULDER_END` | 2.0m | How far banks extend from path |
| `CARVE_DEPTH` | −0.14 | How deep the path sits below terrain |
| `SHOULDER_HEIGHT` | +0.18 | How high the banks rise above path |

The path surface in `chunk-gen.js` uses `groundY` (not a flat constant) so it follows the carved terrain profile. The +0.02 offset keeps the path surface above the ground mesh to prevent z-fighting.

### Terrain zones

Zone thresholds are in `terrainZone()`. Adjust the noise threshold values to make zones more or less common. Zone colors are in `ZONE_COLORS`. Zone height contributions are in `zoneHeight()`.

## How to add new terrain influence types

### New feature type

1. Add an entry to `FEATURE_PROFILES` in `terrain.js`:

```js
bridge: {
  radius: 3.0,
  apply(dist, radius) {
    const t = dist / radius;
    if (t >= 1) return 0;
    return -(1 - t * t) * 0.1; // depression under bridge
  },
},
```

2. When placing the feature in `chunk-gen.js`, push `{ x, z, type: 'bridge' }` to the features array.

### New terrain zone

1. Add the zone name to `ZONES` in `terrain.js`
2. Add detection logic in `terrainZone()` (based on noise thresholds)
3. Add height contribution in `zoneHeight()`
4. Add color tint in `ZONE_COLORS`
