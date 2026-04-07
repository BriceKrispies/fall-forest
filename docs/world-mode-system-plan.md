# World Mode System

## Current System Summary

The project is a software-rendered 3D forest walk on a 320x200 canvas.

**Rendering** (`renderer.js`): Pixel-level rasterization. Holds lighting state (fogColor, ambientTint, ambientLevel, sunDir, sunTint, sunVisible, nightness) which affects every draw call.

**Lighting** (`lighting.js`): `DayNightCycle` class computes all atmosphere from a single `timeOfDay` value via keyframe interpolation. 180-second full cycle.

**Sky** (`sky.js`): `NightSky` class draws gradient, stars, moon, and meteors. Gated by `nightness`.

**Creatures**: WASM manages 16 generic creatures (position/velocity/life). Renderer draws each as a 4-pixel cross.

**Console** (`console.js` + `commands.js`): Floating `/` HUD. Commands registered via `register(name, handler)`. Handlers receive `(args, gameState)`.

**Frame loop** (`main.js`): Sequential update — lighting, then renderer, sky, WASM geometry, fire, leaves, grass, creatures.

## Architecture

### Mode Profile + Resolver (`src/world-mode.js`)

A world mode is a plain data object listing parameter overrides:

```js
hell: {
  fogColor: [0.35, 0.08, 0.04],
  ambientLevel: 0.55,
  ambientTint: [1.0, 0.4, 0.2],
  nightness: 0.7,
  sunVisible: false,
  skyTint: [0.4, 0.05, 0.02],
  creatureColor: [180, 40, 30],
  creatureShape: 'horned',
  timeScale: 0,
}
```

Unspecified parameters fall through to `DayNightCycle` defaults.

### WorldMode class

- `activate(name)` — snapshots current state, starts transition
- `resolve(dt, lighting)` — produces `resolved` object by lerping snapshot toward target
- `timeScale` getter — controls whether the day/night cycle ticks

### Data flow

```
DayNightCycle.update(dt * worldMode.timeScale)
  -> worldMode.resolve(dt, lighting)
  -> renderer.setLighting(worldMode.resolved)
  -> sky.draw(..., resolved.nightness, resolved.sunDir, ..., resolved.skyTint)
  -> uploadSunDir(resolved.sunDir)
  -> uploadConstants(..., resolved.ambientLevel)
```

No system contains mode-specific logic. Every system reads from `resolved`.

### Transitions

- Blend advances at 0.5/second (~2 second full transition)
- Vec3 and scalar fields lerp smoothly
- Booleans snap at blend > 0.5
- Discrete fields (creatureShape, skyTint) snap immediately

### Creature mutations

Renderer reads `creatureColor` and `creatureShape` from the resolved state. A shape lookup table maps names to pixel patterns:

```js
const CREATURE_SHAPES = {
  default: [[0,0],[1,0],[-1,0],[0,-1]],
  horned:  [[0,0],[1,0],[-1,0],[0,-1],[-1,-2],[1,-2]],
};
```

No if/else per mode. New creature appearances = new table entries.

## Files

| File | Action | Responsibility |
|---|---|---|
| `src/world-mode.js` | New | Mode definitions + WorldMode class |
| `src/renderer.js` | Modified | Creature shape table, setLighting compat, data-driven drawCreature |
| `src/sky.js` | Modified | skyTint parameter for gradient tinting |
| `src/main.js` | Modified | WorldMode integration, command registration |
| `src/lighting.js` | Unchanged | Pure time-based computation |
| `src/commands.js` | Unchanged | Existing dispatch works as-is |
| `src/console.js` | Unchanged | Existing UI works as-is |

## Adding new modes

1. Add an entry to `MODES` in `world-mode.js`
2. Add command name to the registration loop in `main.js`
3. No other files change

## Adding new affected systems

1. New system reads from `worldMode.resolved` in the frame loop
2. Add relevant parameter to mode definitions
3. No existing systems change
