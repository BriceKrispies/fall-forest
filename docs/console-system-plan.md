# Console System — Architecture Plan

## Current System Summary

The project is a browser-based 3D forest walking experience rendered entirely in software on a 320x200 canvas. Key architecture:

- **Rendering**: `Renderer` class does pixel-level rasterization on a 2D canvas. WASM handles triangle processing. The canvas is scaled up with `image-rendering: pixelated`.
- **Update loop**: A single `requestAnimationFrame` callback inside `start()` in `main.js`. No central event bus or state manager.
- **Input**: Keyboard (WASD + arrows) and pointer lock on desktop. Touch buttons + touch-drag on mobile. All input state lives in a flat `input` object in the `start()` closure.
- **HUD/UI**: Minimal DOM — a `#hint` div for the click-to-enter prompt and `#touch-controls` for mobile d-pad buttons. No existing HUD framework.
- **Atmosphere/lighting**: `DayNightCycle` class in `lighting.js` manages fog color, ambient level, sun direction, sun tint, and nightness via time-of-day keyframes. The renderer reads these values each frame via `setLighting()`.
- **State**: No centralized game state object. Individual systems (camera, lighting, WASM bridge) each manage their own state. The `start()` closure holds the glue.

## Integration Approach

The console will be a **pure DOM overlay** — it does not touch the software renderer or canvas pixels. This is the correct choice because:

1. The canvas is only 320x200 pixels — text rendered into it would be unreadable or require a separate text rendering pipeline.
2. A DOM overlay sits above the pixelated canvas naturally, which fits the "hovering in the HUD" aesthetic.
3. It avoids any performance impact on the render loop.

### Where things live

| Concern | Location | Why |
|---|---|---|
| Floating `/` element + input UI | `src/console.js` (new) | Self-contained DOM module. Creates its own elements, manages open/close state, handles its own keyboard/touch events. |
| Command registry + parsing + dispatch | `src/commands.js` (new) | Pure logic module. Maps command names to handler functions. No DOM dependency. |
| Console CSS | `style.css` (modified) | Keeps all styling in the existing stylesheet. |
| Integration glue | `main.js` (modified) | Imports console + commands, creates instances, registers commands, passes game state references to command handlers. |
| HTML shell | `index.html` | No changes needed — console elements are created dynamically by `console.js`. |

### Why two modules, not one

Separating the registry (`commands.js`) from the UI (`console.js`) means:
- Future commands can be registered from any module (lighting, camera, weather) without importing console UI code.
- The console UI only knows how to display and collect input — it delegates execution.
- Testing or scripting commands programmatically doesn't require the DOM.

## Event / Data Flow

```
User presses "/" (desktop) or taps floating "/" (mobile)
  → console.js opens input field, suppresses key propagation to game
  → User types command, presses Enter
  → console.js strips leading "/", passes raw string to commands.js
  → commands.js parses command name + args, looks up registry
  → If found: calls handler(args, gameState), returns result string
  → If not found: returns "unknown command" message
  → console.js displays result briefly, then collapses back to floating "/"
  → Key events resume flowing to game input
```

### Input suppression

While the console is open:
- `keydown` events are intercepted by the console input and do NOT propagate to the game's WASD handler.
- Pointer lock is not requested/released — the console is a thin text overlay, not a modal.
- On mobile, the touch on the floating `/` opens the input; the d-pad buttons remain functional underneath (the input field is small and positioned away from controls).

## Desktop Interaction

1. Press `/` anywhere → console opens (input field grows from the slash position)
2. Type command (e.g., `debug`) — the leading `/` is pre-filled visually
3. Press `Enter` → command executes, result shown briefly, console closes
4. Press `Escape` → console closes without executing
5. While open, WASD/arrow keys go to the input field, not the game

## Mobile Interaction

1. Tap the floating `/` → console opens with on-screen keyboard
2. Input field appears with `/` prefix
3. Submit via on-screen keyboard Enter → same flow as desktop
4. Tap outside or press back → closes
5. The floating `/` is positioned in the top-right area, away from d-pad controls

## Always Accessible

- The floating `/` is rendered with `position: fixed` and a high `z-index`, so it's always above the canvas and touch controls.
- It never gets hidden by game state, pointer lock, or touch events.
- It has no display:none transitions — only opacity changes, so it's always in the DOM and tappable.

## Visual Presentation

### Resting state (floating `/`)
- Position: top-right corner, offset from edges
- Font: Georgia serif (matches existing `#hint` style), ~18px
- Color: `rgba(255, 240, 210, 0.15)` — pale off-white, nearly invisible
- On hover: opacity rises to ~0.4 — still restrained
- No background, no border, no box-shadow — just a bare glyph
- Subtle CSS animation: very slow opacity pulse (8s cycle, ±0.05) to give it a ghostly living quality
- `pointer-events: auto` so it's always clickable/tappable
- `cursor: default` (not pointer) to avoid looking like a button

### Open state (input line)
- A thin input field grows horizontally from the `/` position
- Background: `rgba(0, 0, 0, 0.25)` — barely there, just enough for text contrast
- Text color: `rgba(255, 240, 210, 0.6)` — matches the hint text
- No border. Thin bottom line only: `border-bottom: 1px solid rgba(255, 240, 210, 0.12)`
- Font: same Georgia serif, same size
- The `/` becomes the first character of the input (non-editable prefix)
- Max width ~220px — never becomes a big console window
- Entry animation: width grows over 150ms (CSS transition)
- Exit animation: width shrinks back, then only the `/` remains

### Feedback line
- After command execution, a single line of text appears below the input area
- Same color/font as the input, fades out after 2-3 seconds
- Used for confirmations ("debug: on") and errors ("unknown command")
- Never more than one line — this is not a scrolling terminal

## Future Command Extensibility

Adding a new command requires only:

```js
commands.register('rain', (args, state) => {
  // toggle or set rain state
  state.weather.setRain(true);
  return 'rain: on';
});
```

No changes to the console UI, no changes to the input system. The registry is a simple `Map<string, handler>`.

### Future: environment controller

When `/rain`, `/dark`, `/day`, `/hell` are implemented, they'll need a lightweight environment state object that the `DayNightCycle` and renderer can read. This doesn't exist yet and is **not built in this slice**. The plan:

- Create `src/environment.js` with an `EnvironmentState` class that holds overrides (forced time-of-day, weather flags, atmosphere presets).
- `DayNightCycle.update()` checks environment overrides before applying its normal keyframe interpolation.
- Command handlers write to the environment state; the render loop reads from it.
- This keeps commands decoupled from the lighting internals.

## Files Changed (First Slice)

| File | Action |
|---|---|
| `src/commands.js` | **New** — command registry |
| `src/console.js` | **New** — console HUD UI |
| `style.css` | **Modified** — add console styles |
| `src/main.js` | **Modified** — import console, register `/debug`, wire input suppression |

## First Slice Scope

- Floating `/` always visible with eerie styling
- Press `/` on desktop or tap on mobile to open
- Input field with `/` prefix
- Enter to submit, Escape to close
- Command registry with `/debug` registered
- `/debug` toggles a small debug overlay showing FPS and camera position
- Unknown commands show a brief "unknown command" message
- Console open state suppresses game keyboard input
