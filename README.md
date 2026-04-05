# Fall Forest

A browser-based 3D storybook forest diorama rendered entirely in software on a 2D canvas. No WebGL, no Three.js, no frameworks.

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

## Renderer

Custom software 3D pipeline on a 2D canvas:
- 320×200 internal resolution, scaled up with `image-rendering: pixelated`
- Full 3D world geometry with perspective projection
- Per-face flat shading with directional sun + ambient
- Warm/cool light split (sun-facing faces warm, shadow faces cool)
- Distance fog blending to warm haze
- Back-face culling and per-pixel depth buffer
- No WebGL, no external rendering libraries

## How to run

Serve the project directory with any static file server:

```
npx serve .
```

Or open `index.html` via any local dev server (VS Code Live Server, Python `http.server`, etc). The project uses ES modules so it needs to be served over HTTP, not opened as a file.

Click the canvas to capture the mouse, then walk with W/S or arrow keys.
