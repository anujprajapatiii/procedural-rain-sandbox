export type Preset = 'ruins' | 'caves' | 'shafts'
export type Quality = 'auto' | 'low' | 'high'

export interface ProceduralRainProps {
  className?: string
  initialSeed?: string
  quality?: Quality
}

export interface SimulationSettings {
  preset: Preset
  seed: string
  intensity: number
  wind: number
  speed: number
  paused: boolean
  debug: boolean
}

export interface SimulationStats {
  fps: number
  particles: number
  wetCells: number
  grid: string
}
