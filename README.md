# Fall Forest

A browser-based 3D storybook forest diorama rendered in software on a 2D canvas with a WebAssembly performance core. No WebGL, no Three.js, no frameworks.

## What it is

A tiny, guided walk through a miniature handcrafted forest. You move forward and backward along a fixed winding path while looking freely with the mouse. The scene is dense, warm, and intentionally compact — a diorama, not a game level.

## Visual thesis

Storybook diorama. Chunky low-poly shapes, warm palette, enclosed sightlines, dense foreground detail. Every few meters along the path should feel authored — a flower patch here, a log there, a tighter grove, a brighter clearing.

## Movement model

- **Forward/backward only** along a Catmull-Rom rail path
- **Free mouse look** (yaw and pitch)
- Gentle camera bob and sway for organic feel
- No strafing, jumping, or free movement
- W/S or arrow keys to walk, mouse to look
- Touch: drag to look, buttons to walk

## Renderer

Custom software 3D pipeline on a 2D canvas with WASM-accelerated triangle processing:
- 320x200 internal resolution, scaled up with `image-rendering: pixelated`
- Full 3D world geometry with perspective projection
- Triangle culling, projection, and shading run in WebAssembly (hand-written WAT)
- Per-face flat shading with stylized warm/cool ramp
- Distance fog blending to warm haze
- Back-face culling and per-pixel depth buffer
- Falling leaf particles (wasm-driven)
- Animated grass sway (wasm-driven)
- Ambient creatures (wasm-driven)

## Architecture

JavaScript handles orchestration, input, scene authoring, and canvas presentation. WebAssembly (written directly in WAT) handles the hot-path triangle pipeline, particle systems, grass animation, and creature updates. See `docs/wasm-architecture.md` for the full memory layout and boundary contract.

## How to build

```
npm install
node build-wasm.js
```

This compiles `wasm/core.wat` to `wasm/core.wasm` using the `wabt` npm package.

## How to run

Serve the project directory with any static file server:

```
npx serve .
```

Or use VS Code Live Server, Python `http.server`, etc. The project uses ES modules and fetches `.wasm` files, so it must be served over HTTP.

Click the canvas to capture the mouse, then walk with W/S or arrow keys.
