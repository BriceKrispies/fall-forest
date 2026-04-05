# WebAssembly Architecture

## Why WAT

The project moves performance-critical hot loops into WebAssembly written directly in WAT (WebAssembly Text Format). No intermediate language (Rust, C, AssemblyScript) is used. This keeps the toolchain minimal and the wasm boundary explicit.

## JS vs WASM responsibilities

### JavaScript owns
- App bootstrap and wasm loading
- Canvas presentation (putImageData)
- Input handling (keyboard, mouse, touch)
- Rail camera movement orchestration
- Scene assembly (authored content, prop placement)
- Pixel rasterization (reads wasm output, writes to ImageData)
- Sun disc rendering
- Leaf/creature/grass visual rendering (consumes wasm state)
- Configuration values

### WASM owns
- Triangle processing hot loop (distance cull, normal compute, backface cull, projection, shading, fog)
- Leaf particle update (spawn, drift, lifetime)
- Grass sway animation (per-blade visibility + sway computation)
- Ambient creature update (spawn, wander, lifetime)
- Metrics counters

## Memory layout

All data lives in a single shared WebAssembly.Memory (64 pages = 4MB).

| Offset | Size | Contents |
|--------|------|----------|
| 0 | 64B | MVP matrix (16 x f32) |
| 64 | 12B | Camera position (3 x f32) |
| 80 | 12B | Sun direction (3 x f32) |
| 96 | 12B | Constants: fog_near, fog_far, ambient (3 x f32) |
| 128 | 20B | Metrics: tris_processed, tris_visible, leaves_active, grass_active, creatures_active (5 x i32) |
| 256 | 768KB | Triangle input buffer (up to 16000 tris x 48B each) |
| 768256 | 768KB | Triangle output buffer (projected visible tris x 48B each) |
| 1728256 | 2KB | Leaf particle buffer (64 leaves x 32B each) |
| 1730304 | 64KB | Grass instance buffer (2000 blades x 32B each) |
| 1794304 | 512B | Creature buffer (16 creatures x 32B each) |

### Triangle input record (48 bytes)
```
f32 v0x, v0y, v0z    (vertex 0)
f32 v1x, v1y, v1z    (vertex 1)
f32 v2x, v2y, v2z    (vertex 2)
f32 r, g, b           (face color 0-1)
```

### Triangle output record (48 bytes)
```
f32 p0x, p0y, p0z    (projected screen vertex 0)
f32 p1x, p1y, p1z    (projected screen vertex 1)
f32 p2x, p2y, p2z    (projected screen vertex 2)
f32 r, g, b           (shaded+fogged color 0-1)
```

### Leaf particle record (32 bytes)
```
f32 x, y, z           (position)
f32 vx, vy, vz        (velocity)
f32 life              (remaining lifetime)
f32 max_life          (initial lifetime)
```

### Grass instance record (32 bytes)
```
f32 base_x, base_y, base_z  (base position)
f32 height                    (blade height)
f32 sway                      (current sway offset, written by wasm)
f32 visible                   (1.0 if near camera, 0.0 otherwise)
f32 color_seed                (for color variation)
f32 _pad
```

### Creature record (32 bytes)
```
f32 x, y, z           (position)
f32 vx, vz            (velocity)
f32 life              (remaining lifetime)
f32 state             (behavior state)
f32 timer             (direction change timer)
```

## WASM exports

| Export | Purpose |
|--------|---------|
| `memory` | Shared linear memory |
| `set_screen(w, h)` | Set render target dimensions |
| `set_tri_count(n)` | Set number of input triangles |
| `set_grass_count(n)` | Set total grass instance count |
| `set_time(t)` | Set current time for animation |
| `process_triangles() -> i32` | Run full triangle pipeline, returns visible count |
| `update_leaves(dt, cam_x, cam_z, seed)` | Update leaf particle system |
| `update_grass(dt, cam_x, cam_z)` | Update grass sway and visibility |
| `update_creatures(dt, cam_x, cam_z, seed)` | Update ambient creatures |
| `get_visible_count() -> i32` | Get last visible triangle count |
| `get_leaf_count() -> i32` | Get active leaf count |
| `get_creature_count() -> i32` | Get active creature count |
| `get_metrics_ptr() -> i32` | Get metrics buffer offset |
| `get_tri_in_ptr() -> i32` | Get triangle input buffer offset |
| `get_tri_out_ptr() -> i32` | Get triangle output buffer offset |
| `get_leaves_ptr() -> i32` | Get leaf buffer offset |
| `get_grass_ptr() -> i32` | Get grass buffer offset |
| `get_creatures_ptr() -> i32` | Get creature buffer offset |

## Build workflow

```
npm install          # installs wabt
node build-wasm.js   # compiles wasm/core.wat -> wasm/core.wasm
```

The build script uses the `wabt` npm package to parse WAT and emit WASM.

## Frame flow

1. JS: camera update, beginFrame (clear buffers)
2. JS: draw sun disc
3. JS: upload MVP + camera to wasm memory
4. WASM: `process_triangles()` - cull, project, shade all triangles
5. JS: `rasterizeWasmOutput()` - read projected tris, rasterize to pixel buffer
6. WASM: `update_leaves()` - spawn/update leaf particles
7. JS: read leaf positions, draw to pixel buffer
8. WASM: `update_grass()` - compute sway, filter by distance
9. JS: read visible grass, draw blades
10. WASM: `update_creatures()` - spawn/wander/despawn creatures
11. JS: read creature positions, draw to pixel buffer
12. JS: endFrame (putImageData)

## Limitations

- Rasterization stays in JS (writes directly to ImageData pixel buffer which is not in wasm memory)
- Scene geometry is uploaded once at startup (static scene); dynamic objects use separate systems
- Leaf spawn uses a deterministic pseudo-random approach (fract-multiply hash), not true randomness
- Grass visibility is binary (near/far threshold), no smooth LOD
- Creature AI is minimal (random walk with direction changes)
- No frustum culling beyond distance cull (would require extracting frustum planes)

## Next candidates for wasm migration

1. **Rasterizer inner loop** - highest value; requires either copying ImageData into wasm memory and back, or restructuring to use wasm memory as the frame buffer
2. **Depth buffer clear** - simple memset-like loop, easy win
3. **Fog/sky fill** - the initial pixel buffer fill loop
4. **Frustum plane extraction and per-triangle frustum cull** - would reduce projected-but-offscreen work
5. **Sort visible triangles by depth** - back-to-front ordering for potential transparency support
