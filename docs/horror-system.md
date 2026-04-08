# Horror Entity System

## What it is

A procedural horror entity subsystem that generates and animates writhing, multi-segmented monstrosities. Designed for `hell` mode but controllable through any world mode via resolved parameters.

Entities are built from a **segment graph** — a tree of typed nodes (core, tendril, eye, tooth, sucker, ring, spine) generated procedurally from a seed. WASM simulates per-segment physics (spring, undulation, damping, twitch). JS reads the simulated buffer and renders chunky procedural geometry through the existing `drawDynamicTris` pipeline.

## Architecture

### Data flow

```
World mode params (resolved)
  → JS: generateAllHorrors() — builds segment graph, writes to WASM memory
  → JS: uploadHorrorConfig() — sets simulation parameters
  → WASM: update_horrors() — runs spring/undulation/damping/twitch per segment
  → JS: readHorrorSegments() — reads simulated positions
  → JS: renderHorrors() — generates procedural geometry per segment type
  → Renderer: drawDynamicTris() — rasterizes to pixel buffer
```

### Files

| File | Role |
|------|------|
| `wasm/core.wat` | Horror memory layout, `update_horrors` simulation function |
| `src/wasm-bridge.js` | Buffer I/O: write entities/segments, read segments, upload config |
| `src/horror-gen.js` | Procedural graph generator — builds entities from seed + params |
| `src/horror-renderer.js` | Reads segments, produces geometry motifs per type |
| `src/world-mode.js` | Horror parameters in mode profiles, resolved through WorldMode |
| `src/main.js` | Frame loop integration, `/horror` command |

### WASM memory layout

| Offset | Size | Contents |
|--------|------|----------|
| 2760000 | 32B | Horror config (8 × f32) |
| 2760032 | 512B | Entity headers (8 × 64B) |
| 2760544 | 24576B | Segment buffer (512 × 48B) |

### Segment record (48 bytes)

```
f32 x, y, z          — simulated position
f32 rest_x, rest_y, rest_z  — rest/anchor position
f32 vx, vy, vz       — velocity
f32 phase             — animation phase
f32 size              — radius/width
f32 flags             — encoded: type, parent index, entity id, active
```

### Segment types

| Type | ID | Visual | Motion |
|------|----|--------|--------|
| Core | 0 | Chunky pyramidal mass | Breathing pulse |
| Tendril | 1 | Tapered triangle strip | Phase-shifted undulation |
| Eye | 2 | Radial disc with pupil | Gentle pulse |
| Tooth | 3 | Sharp wedge spike | Spring to rest |
| Sucker | 4 | Concave cup ring | Lateral undulation |
| Ring | 5 | Small radial element | Orbital motion |
| Spine | 6 | Protruding spike | Spring to rest |

## World mode parameters

All horror behavior is driven by mode-resolved parameters:

| Parameter | Effect | Hell value |
|-----------|--------|------------|
| `horrorEnabled` | Master on/off | `true` |
| `horrorDensity` | Entity count factor | `0.8` |
| `horrorComplexity` | Segment count, branching | `0.8` |
| `horrorSegmentBudget` | Max segments per entity | `64` |
| `horrorBranchDepth` | Recursive tendril depth | `3` |
| `horrorWrithingIntensity` | Undulation force | `3.0` |
| `horrorEyeDensity` | Eye placement chance | `0.5` |
| `horrorToothDensity` | Tooth ring chance | `0.4` |
| `horrorSuckerDensity` | Sucker placement chance | `0.3` |
| `horrorRingCount` | Orbit ring count | `2` |
| `horrorAgitation` | Base agitation level | `1.2` |
| `horrorScale` | Overall entity scale | `1.2` |
| `horrorColorBias` | RGB color multiplier | `[1.0, 0.25, 0.12]` |

Other modes default all values to 0/false/disabled.

## Console commands

| Command | Effect |
|---------|--------|
| `/horror` | Show current horror state |
| `/horror on` | Force enable horror (any mode) |
| `/horror off` | Force disable horror |
| `/horror debug` | Toggle debug skeleton overlay |
| `/horror regen` | Regenerate horror entities |

## Simulation details

The WASM `update_horrors` function runs per segment per frame:

1. **Spring to rest** — Each segment springs back toward its rest position (configurable `spring_k`)
2. **Undulation** — Tendrils/suckers get phase-shifted lateral wave motion; rings get orbital impulse
3. **Breathing** — All segments get subtle vertical pulse from entity's pulse phase
4. **Parent cohesion** — Child segments are pulled toward parents when stretched beyond 2× size
5. **Damping** — Velocity is damped to prevent explosion (configurable `damping`)
6. **Agitation twitch** — Random impulse bursts when entity agitation exceeds threshold
7. **Entity agitation** — Decays toward base level but receives random spike events

## Adding new segment types

1. Add a new type constant in `horror-gen.js` (e.g. `SEG_MOUTH = 7`)
2. Add generation logic in `generateHorror()` that places segments with the new type
3. Add a geometry builder in `horror-renderer.js` (e.g. `buildMouth()`)
4. Add a case in `renderHorrors()` switch
5. Optionally add type-specific motion behavior in `update_horrors` in `core.wat`

## Adding new horror modes

Add horror parameters to any mode in `MODES` in `world-mode.js`:

```js
abyss: {
  // ... lighting params ...
  horrorEnabled: true,
  horrorDensity: 1.0,
  horrorComplexity: 1.0,
  horrorBranchDepth: 4,
  // etc.
},
```

No other files need mode-specific changes.
