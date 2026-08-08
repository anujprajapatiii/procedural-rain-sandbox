# Weathering

An original, procedural WebGL rain study built with React 19 and PixiJS. Seeded cave geometry, collision, runoff, dripping, and pooling all share one lightweight grid so the scene remains responsive as its container changes size.

## Run locally

```bash
npm install
npm run dev
```

Production check:

```bash
npm run build
npm run preview
```

## Controls

- Switch between **Open ruins**, **Deep caves**, **Vertical shafts**, and the logic-driven **Generated wilds** mode.
- Use **Randomize layout** to create a new seed and a fresh composition of shelters, shafts, ledges, drainage gaps, and water catchments.
- Use **Randomize blur** to regenerate two independent fields of cloudy, progressively faded blur patches without changing the terrain.
- Jump to light rain, a heavy storm, or a wind-driven gale.
- Adjust rain, wind, and time independently.
- Enter a seed and regenerate it to reproduce the same terrain.
- Pause the simulation, clear accumulated water, or reveal the collision grid and live statistics.

## Porting into an Astro React island

Copy `src/ProceduralRain/` into the destination project and import the component:

```tsx
import { ProceduralRain } from './ProceduralRain'

<ProceduralRain initialSeed="MONSOON-07" quality="auto" />
```

The component only needs a parent with a usable height. It measures that parent with `ResizeObserver` and releases its WebGL renderer, observer, ticker, and event handlers when unmounted.

The control chrome uses these inherited theme properties:

- `--background-primary`
- `--background-elevated`
- `--text-primary`
- `--text-secondary`
- `--border-primary`

## How it stays fast

- Rain particles live in reusable typed arrays instead of React state.
- A coarse `Uint8Array` grid handles generation and collision in constant time per sample.
- Water is a bounded pair of `Float32Array` buffers; each step swaps the buffers rather than allocating more memory.
- Particle limits scale with container area and quality, with hard caps for long-running sessions.
- Terrain is drawn as horizontal runs rather than thousands of separate display objects.
- The actual Pixi scene—including the current rain frame—is captured into one reusable, downsampled render texture and drawn back through two Gaussian blur filters. This guarantees that rain, water, and terrain are blurred together.
- Two small Canvas2D alpha textures provide smooth randomized cloud masks. They are regenerated only on resize or when **Randomize blur** is pressed, then reused by the GPU with no per-frame allocations.
- The blur masks drift inside the renderer. Automatic mobile and low-quality modes disable the heavier secondary pass, and reduced-motion starts the simulation paused.
- Render textures, mask textures, and filters are explicitly destroyed on unmount; resize reuses the same scene texture instead of accumulating GPU resources.

This is deliberately a stylized cellular water model, not fluid dynamics. The visual priorities are readable rain shadows, roof runoff, falling streams, and temporary pools.

## Dependencies

Runtime:

- `react` 19.1.1
- `react-dom` 19.1.1
- `pixi.js` 8.x

Build-only:

- Vite
- TypeScript
- `@vitejs/plugin-react`
- React type definitions
