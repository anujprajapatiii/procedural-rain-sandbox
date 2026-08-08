import { Application, BlurFilter, Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js'
import { SCENE } from './palette'
import { createRandom } from './random'
import { generateTerrain, type TerrainGrid } from './terrain'
import type { Quality, SimulationSettings, SimulationStats } from './types'

const EMPTY_STATS: SimulationStats = { fps: 0, particles: 0, wetCells: 0, grid: '0×0' }

export class RainEngine {
  private app = new Application()
  private root = new Container()
  private background = new Graphics()
  private terrainGraphic = new Graphics()
  private waterGraphic = new Graphics()
  private rainGraphic = new Graphics()
  private debugGraphic = new Graphics()
  private blurOverlay = new Container()
  private blurTexture: RenderTexture | null = null
  private blurSprites: Sprite[] = []
  private blurMasks: Sprite[] = []
  private blurMaskCanvases: HTMLCanvasElement[] = []
  private blurMaskTextures: Texture[] = []
  private blurFilters: BlurFilter[] = []
  private blurDurations = [100, 140]
  private blurPhases = [0, 0]
  private blurElapsed = 0
  private blurFrame = 0
  private grid: TerrainGrid | null = null
  private water = new Float32Array(0)
  private nextWater = new Float32Array(0)
  private x = new Float32Array(0)
  private y = new Float32Array(0)
  private vx = new Float32Array(0)
  private vy = new Float32Array(0)
  private particleCount = 0
  private particleLimit = 1400
  private spawnCarry = 0
  private waterTick = 0
  private elapsedStats = 0
  private frameCount = 0
  private wetCells = 0
  private destroyed = false
  private random = createRandom('MONSOON-07')
  private settings: SimulationSettings

  private constructor(
    private host: HTMLElement,
    private quality: Quality,
    settings: SimulationSettings,
    private onStats: (stats: SimulationStats) => void,
  ) {
    this.settings = settings
  }

  static async create(
    host: HTMLElement,
    quality: Quality,
    settings: SimulationSettings,
    onStats: (stats: SimulationStats) => void,
  ) {
    const engine = new RainEngine(host, quality, settings, onStats)
    await engine.initialize()
    return engine
  }

  private async initialize() {
    const resolution = this.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 1.75)
    await this.app.init({
      background: SCENE.skyDeep,
      antialias: false,
      autoDensity: true,
      resolution,
      preference: 'webgl',
    })
    if (this.destroyed) return
    this.app.canvas.className = 'rain-surface'
    this.app.canvas.setAttribute('aria-hidden', 'true')
    this.host.appendChild(this.app.canvas)
    this.root.addChild(this.background, this.terrainGraphic, this.waterGraphic, this.rainGraphic, this.debugGraphic)
    this.app.stage.addChild(this.root, this.blurOverlay)
    this.resize(this.host.clientWidth, this.host.clientHeight)
    this.app.ticker.add(this.update)
  }

  setSettings(settings: SimulationSettings) {
    const terrainChanged = settings.seed !== this.settings.seed || settings.preset !== this.settings.preset
    const blurChanged = settings.blurVersion !== this.settings.blurVersion
    this.settings = settings
    if (terrainChanged && this.grid) this.rebuild()
    else if (blurChanged && this.grid) this.rebuildBlurMasks()
    this.debugGraphic.visible = settings.debug
    this.blurOverlay.alpha = settings.debug ? 0.22 : 1
  }

  resize(width: number, height: number) {
    if (this.destroyed || width < 2 || height < 2 || !this.app.renderer) return
    this.app.renderer.resize(Math.round(width), Math.round(height))
    this.ensureBlurResources(width, height)
    this.particleLimit = this.resolveParticleLimit(width, height)
    this.allocateParticles(this.particleLimit)
    this.rebuild()
  }

  resetWater() {
    this.water.fill(0)
    this.nextWater.fill(0)
    this.wetCells = 0
  }

  destroy() {
    this.destroyed = true
    this.app.ticker?.remove(this.update)
    for (const filter of this.blurFilters) filter.destroy()
    for (const texture of this.blurMaskTextures) texture.destroy(true)
    this.blurTexture?.destroy(true)
    this.blurTexture = null
    if (this.app.renderer) this.app.destroy(true, { children: true })
    this.onStats(EMPTY_STATS)
  }

  private resolveParticleLimit(width: number, height: number) {
    const area = width * height
    const multiplier = this.quality === 'high' ? 1.25 : this.quality === 'low' ? 0.6 : area < 400_000 ? 0.65 : 1
    return Math.max(500, Math.min(2800, Math.round((area / 580) * multiplier)))
  }

  private allocateParticles(limit: number) {
    const oldCount = Math.min(this.particleCount, limit)
    const copy = (source: Float32Array) => {
      const next = new Float32Array(limit)
      next.set(source.subarray(0, oldCount))
      return next
    }
    this.x = copy(this.x)
    this.y = copy(this.y)
    this.vx = copy(this.vx)
    this.vy = copy(this.vy)
    this.particleCount = oldCount
  }

  private rebuild() {
    // Pixi's screen is already expressed in CSS pixels. Renderer width can be
    // resolution-scaled on high-DPI displays, which would shrink the simulation.
    const width = this.app.screen.width
    const height = this.app.screen.height
    this.grid = generateTerrain(width, height, this.settings.preset, this.settings.seed, this.quality)
    this.water = new Float32Array(this.grid.cells.length)
    this.nextWater = new Float32Array(this.grid.cells.length)
    this.random = createRandom(`${this.settings.seed}:${this.settings.preset}:weather`)
    this.particleCount = 0
    this.spawnCarry = 0
    this.drawStaticScene()
    this.drawDebug()
    this.rebuildBlurMasks()
  }

  private ensureBlurResources(width: number, height: number) {
    const captureResolution = this.quality === 'high' ? 0.42 : this.quality === 'low' ? 0.25 : 0.34
    if (!this.blurTexture) {
      this.blurTexture = RenderTexture.create({ width, height, resolution: captureResolution, dynamic: true })
      for (let layer = 0; layer < 2; layer += 1) {
        const sprite = new Sprite(this.blurTexture)
        const maskCanvas = document.createElement('canvas')
        const maskResolution = this.quality === 'high' ? 0.5 : this.quality === 'low' ? 0.28 : 0.38
        maskCanvas.width = Math.max(2, Math.ceil(width * maskResolution))
        maskCanvas.height = Math.max(2, Math.ceil(height * maskResolution))
        const maskTexture = Texture.from(maskCanvas, true)
        const mask = new Sprite(maskTexture)
        const filter = new BlurFilter({ strength: layer === 0 ? 18 : 30, quality: 1, kernelSize: 9 })
        filter.repeatEdgePixels = true
        sprite.filters = [filter]
        sprite.setMask({ mask, channel: 'alpha', inverse: false })
        this.blurSprites.push(sprite)
        this.blurMasks.push(mask)
        this.blurMaskCanvases.push(maskCanvas)
        this.blurMaskTextures.push(maskTexture)
        this.blurFilters.push(filter)
        this.blurOverlay.addChild(sprite, mask)
      }
    } else {
      this.blurTexture.resize(width, height, captureResolution)
    }
    for (const sprite of this.blurSprites) {
      sprite.texture = this.blurTexture
      sprite.width = width
      sprite.height = height
    }
    const useSecondary = this.quality === 'high' || (this.quality === 'auto' && width >= 700 && width * height >= 480_000)
    if (this.blurSprites[1]) this.blurSprites[1].visible = useSecondary
  }

  private rebuildBlurMasks() {
    if (!this.grid || this.blurMasks.length === 0) return
    const { width, height } = this.grid
    const random = createRandom(`${this.settings.seed}:${this.settings.preset}:${this.settings.blurVersion}:render-blur`)
    const layerSettings = [
      { count: 22, minimum: 0.05, maximum: 0.13, strength: 34 + random() * 14 },
      { count: 14, minimum: 0.08, maximum: 0.18, strength: 64 + random() * 26 },
    ]
    for (let layer = 0; layer < this.blurMasks.length; layer += 1) {
      const mask = this.blurMasks[layer]
      const maskCanvas = this.blurMaskCanvases[layer]
      const maskTexture = this.blurMaskTextures[layer]
      const config = layerSettings[layer]
      const maskResolution = this.quality === 'high' ? 0.5 : this.quality === 'low' ? 0.28 : 0.38
      maskCanvas.width = Math.max(2, Math.ceil(width * maskResolution))
      maskCanvas.height = Math.max(2, Math.ceil(height * maskResolution))
      maskTexture.source.resize(maskCanvas.width, maskCanvas.height, 1)
      const context = maskCanvas.getContext('2d')
      if (!context) continue
      context.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
      context.globalCompositeOperation = 'lighter'
      const columns = layer === 0 ? 6 : 4
      const rows = Math.ceil(config.count / columns)
      for (let index = 0; index < config.count; index += 1) {
        const column = index % columns
        const row = Math.floor(index / columns)
        const x = ((column + 0.15 + random() * 0.7) / columns) * maskCanvas.width
        const y = ((row + 0.12 + random() * 0.76) / rows) * maskCanvas.height
        const radiusX = maskCanvas.width * (config.minimum + random() * (config.maximum - config.minimum))
        const radiusY = maskCanvas.height * (config.minimum * 0.72 + random() * (config.maximum * 1.08 - config.minimum * 0.72))
        context.save()
        context.translate(x, y)
        context.scale(1, radiusY / Math.max(1, radiusX))
        const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radiusX)
        gradient.addColorStop(0, 'white')
        gradient.addColorStop(0.46 + random() * 0.12, 'white')
        gradient.addColorStop(0.74 + random() * 0.1, 'rgb(255 255 255 / 0.68)')
        gradient.addColorStop(1, 'transparent')
        context.fillStyle = gradient
        context.beginPath()
        context.arc(0, 0, radiusX, 0, Math.PI * 2)
        context.fill()
        context.restore()
      }
      maskTexture.source.update()
      maskTexture.update()
      mask.width = width
      mask.height = height
      this.blurFilters[layer].strength = config.strength
      this.blurDurations[layer] = 90 + random() * 75
      this.blurPhases[layer] = random() * Math.PI * 2
    }
  }

  private updateBlur(rawDelta: number) {
    if (!this.blurTexture || this.blurSprites.length === 0) return
    if (!this.settings.paused) this.blurElapsed += rawDelta * 0.001
    for (let layer = 0; layer < this.blurMasks.length; layer += 1) {
      const phase = this.blurPhases[layer] + (this.blurElapsed / this.blurDurations[layer]) * Math.PI * 2
      this.blurMasks[layer].x = Math.sin(phase) * this.app.screen.width * (layer === 0 ? 0.035 : 0.055)
      this.blurMasks[layer].y = Math.cos(phase * 0.53) * this.app.screen.height * 0.008
    }
    this.blurFrame += 1
    const captureEveryFrame = this.quality === 'high'
    if (captureEveryFrame || this.blurFrame % 2 === 0) {
      this.app.renderer.render({ container: this.root, target: this.blurTexture, clear: true })
    }
  }

  private drawStaticScene() {
    const grid = this.grid
    if (!grid) return
    const { width, height, cols, rows, cell, cells } = grid
    const backdropRandom = createRandom(`${this.settings.seed}:backdrop`)
    this.background.clear().rect(0, 0, width, height).fill(SCENE.skyDeep)
    this.background.rect(0, 0, width, height * 0.58).fill({ color: SCENE.skyHigh, alpha: 0.32 })
    for (let index = 0; index < 9; index += 1) {
      const x = backdropRandom() * width
      const w = width * (0.035 + backdropRandom() * 0.08)
      const h = height * (0.2 + backdropRandom() * 0.52)
      this.background.rect(x, height - h, w, h).fill({ color: SCENE.farRock, alpha: 0.28 + backdropRandom() * 0.25 })
    }
    this.background.circle(width * 0.62, height * 0.24, Math.max(width, height) * 0.34).fill({ color: SCENE.fog, alpha: 0.055 })

    this.terrainGraphic.clear()
    for (let row = 0; row < rows; row += 1) {
      let runStart = -1
      for (let col = 0; col <= cols; col += 1) {
        const solid = col < cols && cells[row * cols + col] === 1
        if (solid && runStart < 0) runStart = col
        if (!solid && runStart >= 0) {
          this.terrainGraphic.rect(runStart * cell, row * cell, (col - runStart) * cell + 0.5, cell + 0.5)
          runStart = -1
        }
      }
    }
    this.terrainGraphic.fill(SCENE.rock)

    for (let row = 1; row < rows; row += 1) {
      let edgeStart = -1
      for (let col = 0; col <= cols; col += 1) {
        const isEdge = col < cols && cells[row * cols + col] === 1 && cells[(row - 1) * cols + col] === 0
        if (isEdge && edgeStart < 0) edgeStart = col
        if (!isEdge && edgeStart >= 0) {
          this.terrainGraphic.rect(edgeStart * cell, row * cell, (col - edgeStart) * cell, Math.max(1.5, cell * 0.13))
          edgeStart = -1
        }
      }
    }
    this.terrainGraphic.fill({ color: SCENE.rockEdge, alpha: 0.9 })
  }

  private update = (ticker: { deltaMS: number }) => {
    if (!this.grid || this.destroyed) return
    const rawDelta = Math.min(ticker.deltaMS, 34)
    if (!this.settings.paused) {
      const delta = rawDelta * 0.001 * this.settings.speed
      this.spawnRain(delta)
      this.updateRain(delta)
      this.waterTick += delta
      if (this.waterTick >= 0.045) {
        this.stepWater(Math.min(this.waterTick, 0.12))
        this.waterTick = 0
      }
    }
    this.drawRain()
    this.drawWater()
    this.updateBlur(rawDelta)
    this.frameCount += 1
    this.elapsedStats += rawDelta
    if (this.elapsedStats > 420) {
      this.onStats({
        fps: Math.round((this.frameCount * 1000) / this.elapsedStats),
        particles: this.particleCount,
        wetCells: this.wetCells,
        grid: `${this.grid.cols}×${this.grid.rows}`,
      })
      this.elapsedStats = 0
      this.frameCount = 0
    }
  }

  private spawnRain(delta: number) {
    if (!this.grid) return
    const intensity = this.settings.intensity
    const target = Math.floor(this.particleLimit * (0.12 + intensity * 0.82))
    this.spawnCarry += delta * this.particleLimit * (0.65 + intensity * 2.6)
    const count = Math.min(Math.floor(this.spawnCarry), target - this.particleCount, 140)
    this.spawnCarry -= Math.max(0, count)
    for (let index = 0; index < count; index += 1) {
      const slot = this.particleCount++
      this.x[slot] = this.random() * (this.grid.width + 160) - 80 - this.settings.wind * 80
      this.y[slot] = -this.random() * this.grid.height * 0.45
      this.vx[slot] = this.settings.wind * (180 + this.random() * 140) + (this.random() - 0.5) * 24
      this.vy[slot] = 650 + this.random() * 540 + intensity * 180
    }
  }

  private updateRain(delta: number) {
    const grid = this.grid
    if (!grid) return
    let index = 0
    while (index < this.particleCount) {
      const oldX = this.x[index]
      const oldY = this.y[index]
      const newX = oldX + this.vx[index] * delta
      const newY = oldY + this.vy[index] * delta
      const travel = Math.max(Math.abs(newX - oldX), Math.abs(newY - oldY))
      const steps = Math.max(1, Math.ceil(travel / (grid.cell * 0.7)))
      let hit = false
      let hitX = oldX
      let hitY = oldY
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps
        const sampleX = oldX + (newX - oldX) * progress
        const sampleY = oldY + (newY - oldY) * progress
        if (this.isSolid(sampleX, sampleY)) {
          hit = true
          hitX = oldX + (newX - oldX) * ((step - 1) / steps)
          hitY = oldY + (newY - oldY) * ((step - 1) / steps)
          break
        }
      }
      if (hit) {
        this.depositWater(hitX, hitY, 0.09 + this.settings.intensity * 0.09)
        this.removeParticle(index)
        continue
      }
      this.x[index] = newX
      this.y[index] = newY
      if (newY > grid.height + 80 || newX < -180 || newX > grid.width + 180) {
        this.removeParticle(index)
        continue
      }
      index += 1
    }
  }

  private removeParticle(index: number) {
    const last = --this.particleCount
    if (index === last) return
    this.x[index] = this.x[last]
    this.y[index] = this.y[last]
    this.vx[index] = this.vx[last]
    this.vy[index] = this.vy[last]
  }

  private isSolid(x: number, y: number) {
    const grid = this.grid
    if (!grid || y < 0 || x < 0 || x >= grid.width || y >= grid.height) return false
    const col = Math.floor(x / grid.cell)
    const row = Math.floor(y / grid.cell)
    return grid.cells[row * grid.cols + col] === 1
  }

  private depositWater(x: number, y: number, amount: number) {
    const grid = this.grid
    if (!grid || x < 0 || x >= grid.width || y < 0 || y >= grid.height) return
    const col = Math.max(0, Math.min(grid.cols - 1, Math.floor(x / grid.cell)))
    const row = Math.max(0, Math.min(grid.rows - 1, Math.floor(y / grid.cell)))
    const index = row * grid.cols + col
    if (grid.cells[index] === 0) this.water[index] = Math.min(1.6, this.water[index] + amount)
  }

  private stepWater(_delta: number) {
    const grid = this.grid
    if (!grid) return
    const { cols, rows, cells } = grid
    this.nextWater.fill(0)
    let wet = 0
    for (let row = rows - 2; row >= 0; row -= 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col
        if (cells[index] || this.water[index] < 0.008) continue
        let amount = this.water[index] * 0.994
        const below = index + cols
        if (!cells[below]) {
          const capacity = Math.max(0, 1.25 - this.nextWater[below])
          const falling = Math.min(amount, capacity, 0.76)
          this.nextWater[below] += falling
          amount -= falling
        }
        if (amount > 0.015) {
          const leftOpen = col > 0 && !cells[index - 1]
          const rightOpen = col < cols - 1 && !cells[index + 1]
          let direction = 0
          if (leftOpen && rightOpen) {
            const leftSupport = row === rows - 1 || cells[index - 1 + cols]
            const rightSupport = row === rows - 1 || cells[index + 1 + cols]
            direction = leftSupport !== rightSupport ? (leftSupport ? -1 : 1) : (this.random() < 0.5 ? -1 : 1)
          } else if (leftOpen) direction = -1
          else if (rightOpen) direction = 1
          if (direction) {
            const side = index + direction
            const difference = amount - this.nextWater[side]
            const flow = Math.min(amount * 0.48, Math.max(0, difference * 0.46))
            this.nextWater[side] += flow
            amount -= flow
          }
        }
        if (amount > 0.004) this.nextWater[index] += Math.min(amount, 1.5)
      }
    }
    const swap = this.water
    this.water = this.nextWater
    this.nextWater = swap
    for (let index = 0; index < this.water.length; index += 1) {
      if (this.water[index] > 0.025) wet += 1
    }
    this.wetCells = wet
  }

  private drawRain() {
    this.rainGraphic.clear()
    const wind = this.settings.wind
    const length = 10 + this.settings.intensity * 13
    for (let index = 0; index < this.particleCount; index += 1) {
      this.rainGraphic.moveTo(this.x[index], this.y[index])
      this.rainGraphic.lineTo(this.x[index] - wind * length * 0.45, this.y[index] - length)
    }
    this.rainGraphic.stroke({ color: SCENE.rain, width: this.settings.intensity > 0.75 ? 1.25 : 1, alpha: 0.38 + this.settings.intensity * 0.38 })
  }

  private drawWater() {
    const grid = this.grid
    if (!grid) return
    const { cols, rows, cell, cells } = grid
    this.waterGraphic.clear()
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col
        const amount = this.water[index]
        if (amount < 0.025) continue
        const supported = row === rows - 1 || cells[index + cols] === 1
        if (supported) {
          const depth = Math.max(1.5, Math.min(cell * 0.82, amount * cell * 0.72))
          this.waterGraphic.rect(col * cell, (row + 1) * cell - depth, cell + 0.5, depth)
        } else {
          const width = Math.max(1.2, Math.min(3.2, amount * 3))
          this.waterGraphic.rect((col + 0.5) * cell - width / 2, row * cell, width, cell + 1)
        }
      }
    }
    this.waterGraphic.fill({ color: SCENE.water, alpha: 0.58 })
  }

  private drawDebug() {
    const grid = this.grid
    if (!grid) return
    const { cols, rows, cell, cells, width, height } = grid
    this.debugGraphic.clear()
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (cells[row * cols + col]) this.debugGraphic.rect(col * cell, row * cell, cell, cell)
      }
    }
    this.debugGraphic.fill({ color: SCENE.debugSolid, alpha: 0.18 })
    for (let col = 0; col <= cols; col += 1) this.debugGraphic.moveTo(col * cell, 0).lineTo(col * cell, height)
    for (let row = 0; row <= rows; row += 1) this.debugGraphic.moveTo(0, row * cell).lineTo(width, row * cell)
    this.debugGraphic.stroke({ color: SCENE.debugGrid, width: 0.5, alpha: 0.18 })
    this.debugGraphic.visible = this.settings.debug
  }
}
