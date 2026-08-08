import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { RainEngine } from './RainEngine'
import { createRandom } from './random'
import type { Preset, ProceduralRainProps, SimulationSettings, SimulationStats } from './types'
import './procedural-rain.css'

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'ruins', label: 'Open ruins' },
  { id: 'caves', label: 'Deep caves' },
  { id: 'shafts', label: 'Vertical shafts' },
  { id: 'wilds', label: 'Generated wilds' },
]

const PRESET_NAMES: Record<Preset, string> = {
  ruins: 'open ruins',
  caves: 'deep caves',
  shafts: 'vertical shafts',
  wilds: 'generated wilds',
}

type BlotchStyle = CSSProperties & Record<`--blotch-${string}`, string>

function createBlotches(seed: string) {
  const random = createRandom(`${seed}:organic-blur`)
  return Array.from({ length: 8 }, (_, id) => {
    const radius = Array.from({ length: 8 }, () => `${32 + Math.round(random() * 36)}%`)
    const style: BlotchStyle = {
      '--blotch-x': `${-12 + random() * 100}%`,
      '--blotch-y': `${-10 + random() * 96}%`,
      '--blotch-w': `${21 + random() * 34}%`,
      '--blotch-h': `${17 + random() * 35}%`,
      '--blotch-blur': `${2.5 + random() * 7}px`,
      '--blotch-opacity': `${0.28 + random() * 0.5}`,
      '--blotch-rotate': `${-24 + random() * 48}deg`,
      '--blotch-radius': `${radius.slice(0, 4).join(' ')} / ${radius.slice(4).join(' ')}`,
    }
    return { id, style }
  })
}

const DEFAULT_STATS: SimulationStats = { fps: 0, particles: 0, wetCells: 0, grid: '—' }

export function ProceduralRain({ className = '', initialSeed = 'MONSOON-07', quality = 'auto' }: ProceduralRainProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<RainEngine | null>(null)
  const [seedDraft, setSeedDraft] = useState(initialSeed)
  const [hazeVersion, setHazeVersion] = useState(0)
  const [stats, setStats] = useState(DEFAULT_STATS)
  const [settings, setSettings] = useState<SimulationSettings>(() => ({
    preset: 'ruins',
    seed: initialSeed,
    intensity: 0.78,
    wind: 0.18,
    speed: 1,
    paused: typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    debug: false,
  }))
  const blotches = useMemo(
    () => createBlotches(`${settings.seed}:${settings.preset}:${hazeVersion}`),
    [settings.preset, settings.seed, hazeVersion],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let engine: RainEngine | null = null
    let resizeFrame = 0
    const observer = new ResizeObserver((entries) => {
      const bounds = entries[0]?.contentRect
      if (!bounds || !engine) return
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => engine?.resize(bounds.width, bounds.height))
    })

    void RainEngine.create(host, quality, settings, setStats).then((created) => {
      if (cancelled) {
        created.destroy()
        return
      }
      engine = created
      engineRef.current = created
      observer.observe(host)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(resizeFrame)
      observer.disconnect()
      engine?.destroy()
      engineRef.current = null
    }
    // The engine owns its lifecycle; settings are pushed through the smaller effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality])

  useEffect(() => {
    engineRef.current?.setSettings(settings)
  }, [settings])

  const patchSettings = (patch: Partial<SimulationSettings>) =>
    setSettings((current) => ({ ...current, ...patch }))

  const generate = () => {
    const nextSeed = seedDraft.trim() || `STORM-${Math.floor(Math.random() * 9999)}`
    setSeedDraft(nextSeed)
    patchSettings({ seed: nextSeed })
  }

  const randomizeLayout = () => {
    const nextSeed = `WILD-${Math.floor(Math.random() * 0xffffff).toString(36).toUpperCase().padStart(5, '0')}`
    setSeedDraft(nextSeed)
    setHazeVersion((version) => version + 1)
    patchSettings({ preset: 'wilds', seed: nextSeed })
  }

  const setWeather = (weather: 'light' | 'storm' | 'gale') => {
    if (weather === 'light') patchSettings({ intensity: 0.28, wind: 0.06, speed: 0.85 })
    if (weather === 'storm') patchSettings({ intensity: 0.82, wind: 0.18, speed: 1 })
    if (weather === 'gale') patchSettings({ intensity: 1, wind: 0.78, speed: 1.12 })
  }

  return (
    <section className={`rain-sandbox ${className}`} aria-label="Procedural rain sandbox">
      <div ref={hostRef} className={`rain-canvas${settings.debug ? ' is-debug' : ''}`} aria-label="Live procedural rain simulation">
        <div className="blur-field" aria-hidden="true">
          {blotches.map((blotch) => <i key={blotch.id} className="blur-blotch" style={blotch.style} />)}
        </div>
        <div className="scene-hud" aria-hidden="true">
          <span>{PRESET_NAMES[settings.preset]}</span>
          <span>{settings.paused ? 'suspended' : `${Math.round(settings.intensity * 100)}% rainfall`}</span>
        </div>
        {settings.debug && (
          <div className="debug-stats" role="status">
            <span>FPS <b>{stats.fps}</b></span>
            <span>DROPS <b>{stats.particles}</b></span>
            <span>WET <b>{stats.wetCells}</b></span>
            <span>GRID <b>{stats.grid}</b></span>
          </div>
        )}
      </div>
      <div className="control-deck">
        <div className="control-row control-row--presets" aria-label="Environment preset">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={settings.preset === preset.id ? 'is-active' : ''}
              aria-pressed={settings.preset === preset.id}
              onClick={() => patchSettings({ preset: preset.id })}
            >
              {preset.label}
            </button>
          ))}
          <button className="randomize-layout" type="button" onClick={randomizeLayout}>
            <span>Randomize layout</span><i aria-hidden="true">↗</i>
          </button>
        </div>
        <div className="control-row control-row--weather" aria-label="Weather state">
          <span className="control-label">WEATHER</span>
          <button type="button" onClick={() => setWeather('light')}>Light</button>
          <button type="button" onClick={() => setWeather('storm')}>Storm</button>
          <button type="button" onClick={() => setWeather('gale')}>Gale</button>
        </div>
        <div className="control-grid">
          <label className="seed-field">
            <span>SEED</span>
            <input value={seedDraft} spellCheck={false} onChange={(event) => setSeedDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && generate()} />
          </label>
          <button className="generate-button" type="button" onClick={generate}>Regenerate</button>
          <label>
            <span>RAIN <output>{Math.round(settings.intensity * 100)}</output></span>
            <input type="range" min="0.05" max="1" step="0.01" value={settings.intensity} onChange={(event) => patchSettings({ intensity: Number(event.target.value) })} />
          </label>
          <label>
            <span>WIND <output>{settings.wind.toFixed(2)}</output></span>
            <input type="range" min="-1" max="1" step="0.01" value={settings.wind} onChange={(event) => patchSettings({ wind: Number(event.target.value) })} />
          </label>
          <label>
            <span>SPEED <output>{settings.speed.toFixed(2)}×</output></span>
            <input type="range" min="0.25" max="1.75" step="0.05" value={settings.speed} onChange={(event) => patchSettings({ speed: Number(event.target.value) })} />
          </label>
        </div>
        <div className="control-row control-row--actions">
          <button type="button" onClick={() => patchSettings({ paused: !settings.paused })}>{settings.paused ? 'Play' : 'Pause'}</button>
          <button type="button" onClick={() => engineRef.current?.resetWater()}>Reset water</button>
          <button type="button" className={settings.debug ? 'is-active' : ''} aria-pressed={settings.debug} onClick={() => patchSettings({ debug: !settings.debug })}>Debug grid</button>
          <button type="button" onClick={() => setHazeVersion((version) => version + 1)}>Shuffle haze</button>
          <span className="live-readout"><i className={settings.paused ? 'is-paused' : ''} /> {stats.fps || '—'} FPS</span>
        </div>
      </div>
    </section>
  )
}
