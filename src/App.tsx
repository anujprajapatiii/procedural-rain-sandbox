import { ProceduralRain } from './ProceduralRain'

export default function App() {
  return (
    <main className="app-shell">
      <header className="app-heading">
        <div>
          <p className="eyebrow">SYSTEMS STUDY / 001</p>
          <h1>Weathering</h1>
        </div>
        <p className="intro">
          A procedural landscape shaped by exposure. Change the weather, then watch
          water search for a way through.
        </p>
      </header>
      <ProceduralRain initialSeed="MONSOON-07" />
    </main>
  )
}
