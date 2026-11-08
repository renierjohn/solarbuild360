import { useEffect, useMemo, useState } from 'react'
import Scene from './components/Scene'
import HarvestChart from './components/HarvestChart'
import { LOCATIONS, WEATHER, simulate, valueAt, fmtTime } from './sim'
import './App.css'

function nowAt(tz) {
  const d = new Date(Date.now() + tz * 3600e3)
  return { date: d.toISOString().slice(0, 10), time: d.getUTCHours() + d.getUTCMinutes() / 60 }
}

const initLoc = LOCATIONS[0]
const initNow = nowAt(initLoc.tz)

function Slider({ label, value, min, max, step, unit, onChange, hint }) {
  return (
    <label className="field">
      <span className="field-head">
        <span>{label}</span>
        <b>{value}{unit && <small> {unit}</small>}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} style={{ '--p': `${((value - min) / (max - min)) * 100}%` }} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  )
}

function Stat({ label, value, unit, sub, tone }) {
  return (
    <div className="stat" style={{ '--c': tone }}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}<small>{unit}</small></span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

export default function App() {
  const [cfg, setCfg] = useState({
    loc: 0,
    lat: initLoc.lat,
    lon: initLoc.lon,
    tz: initLoc.tz,
    cur: initLoc.cur,
    date: initNow.date,
    weather: 'clear',
    panelKW: 6.4,
    inverterKW: 5,
    batteryKWh: 10,
    dailyLoad: 18,
    gridConnected: true,
    exportEnabled: true,
    importPrice: initLoc.price,
    exportPrice: +(initLoc.price * 0.5).toFixed(2),
  })
  const [time, setTime] = useState(initNow.time)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)

  const set = (patch) => setCfg((c) => ({ ...c, ...patch }))
  const sim = useMemo(() => simulate(cfg), [cfg])
  const state = valueAt(sim.rows, time)
  const t = sim.totals

  useEffect(() => {
    if (!playing) return
    let raf
    let last = performance.now()
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      setTime((v) => (v + dt * speed) % 24)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed])

  const pickLocation = (i) => {
    if (i < 0) return set({ loc: -1 })
    const l = LOCATIONS[i]
    set({ loc: i, lat: l.lat, lon: l.lon, tz: l.tz, cur: l.cur, importPrice: l.price, exportPrice: +(l.price * 0.5).toFixed(2) })
  }

  const useMyLocation = () => {
    navigator.geolocation?.getCurrentPosition((p) => {
      const tz = -new Date().getTimezoneOffset() / 60
      set({ loc: -1, lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2), tz })
      const n = nowAt(tz)
      set({ date: n.date })
      setTime(n.time)
    })
  }

  const goNow = () => {
    const n = nowAt(cfg.tz)
    set({ date: n.date })
    setTime(n.time)
  }

  const jump = (h) => {
    if (h == null) return
    setPlaying(false)
    setTime(((h % 24) + 24) % 24)
  }

  const isDay = state.elev > 0
  const locName = cfg.loc >= 0 ? LOCATIONS[cfg.loc].name : `${cfg.lat.toFixed(2)}°, ${cfg.lon.toFixed(2)}°`
  const money = (v) => `${cfg.cur}${v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2)}`

  // Timeline gradient (night ↔ day) from simulated sun elevation.
  const timelineBg = useMemo(() => {
    const stops = []
    for (let h = 0; h <= 24; h += 0.5) {
      const e = valueAt(sim.rows, h === 24 ? 23.99 : h).elev
      const c = e < -6 ? '#141b3a' : e < 0 ? '#5a3f6e' : e < 8 ? '#f08a4b' : e < 25 ? '#f6c453' : '#ffe08a'
      stops.push(`${c} ${(h / 24) * 100}%`)
    }
    return `linear-gradient(90deg, ${stops.join(',')})`
  }, [sim.rows])

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="6" fill="var(--c-solar)" />{Array.from({ length: 8 }).map((_, i) => <rect key={i} x="15" y="2" width="2" height="5" rx="1" fill="var(--c-solar)" transform={`rotate(${i * 45} 16 16)`} />)}</svg>
          <span>SolarBuild<b>360</b></span>
        </div>
        <p className="tagline">Design, simulate and visualise a home solar system — sun to socket.</p>
      </header>

      <main className="hero">
        <section className={`stage ${isDay ? 'day' : 'night'}`}>
          <Scene state={state} config={cfg} lat={cfg.lat} />

          <div className="hud">
            <div className="clock">
              <span className="clock-time">{fmtTime(time)}</span>
              <span className="clock-meta">{locName} · {cfg.date} · UTC{cfg.tz >= 0 ? '+' : ''}{cfg.tz}</span>
              <span className="clock-sun">
                {isDay ? '☀' : '☾'} Sun {state.elev.toFixed(1)}° elev · {state.az.toFixed(0)}° az · {WEATHER[cfg.weather].label}
              </span>
            </div>
            <div className="live">
              <div style={{ '--c': 'var(--c-solar)' }}><span>Solar</span><b>{state.pv.toFixed(2)}</b><small>kW</small></div>
              <div style={{ '--c': 'var(--c-home)' }}><span>Home</span><b>{state.load.toFixed(2)}</b><small>kW</small></div>
              {cfg.batteryKWh > 0 && <div style={{ '--c': 'var(--c-batt)' }}><span>Battery</span><b>{state.soc.toFixed(0)}</b><small>%</small></div>}
              <div style={{ '--c': 'var(--c-grid)' }}><span>{state.grid >= 0 ? 'Grid in' : 'Grid out'}</span><b>{Math.abs(state.grid).toFixed(2)}</b><small>kW</small></div>
            </div>
          </div>

          <div className="timeline">
            <div className="tl-row">
              <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg> : <svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z" /></svg>}
              </button>
              <div className="tl-track" style={{ '--bg': timelineBg }}>
                <input type="range" min="0" max="23.99" step="0.01" value={time} onChange={(e) => { setPlaying(false); setTime(+e.target.value) }} aria-label="Time of day" />
                {sim.sunrise != null && <span className="tl-mark" style={{ left: `${(sim.sunrise / 24) * 100}%` }}>↑ {fmtTime(sim.sunrise)}</span>}
                {sim.sunset != null && <span className="tl-mark" style={{ left: `${(sim.sunset / 24) * 100}%` }}>↓ {fmtTime(sim.sunset)}</span>}
              </div>
              <select value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Playback speed">
                {[0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s} h/s</option>)}
              </select>
            </div>
            <div className="quick">
              <button onClick={() => jump(sim.sunrise)}>Sunrise</button>
              <button onClick={() => jump(sim.noon)}>Solar noon</button>
              <button onClick={() => jump(sim.sunset)}>Sunset</button>
              <button onClick={() => jump(sim.sunset != null ? sim.sunset + 3 : 22)}>Night</button>
              <button className="accent" onClick={goNow}>Now</button>
            </div>
          </div>
        </section>

        <aside className="panel">
          <div className="group">
            <h3>Location & time</h3>
            <label className="field">
              <span className="field-head"><span>Location</span></span>
              <select value={cfg.loc} onChange={(e) => pickLocation(+e.target.value)}>
                {LOCATIONS.map((l, i) => <option key={l.name} value={i}>{l.name}</option>)}
                <option value={-1}>Custom coordinates…</option>
              </select>
            </label>
            <div className="row3">
              <label className="field"><span className="field-head"><span>Lat</span></span><input type="number" step="0.01" min="-66" max="66" value={cfg.lat} onChange={(e) => set({ loc: -1, lat: +e.target.value })} /></label>
              <label className="field"><span className="field-head"><span>Lon</span></span><input type="number" step="0.01" min="-180" max="180" value={cfg.lon} onChange={(e) => set({ loc: -1, lon: +e.target.value })} /></label>
              <label className="field"><span className="field-head"><span>UTC±</span></span><input type="number" step="0.5" min="-12" max="14" value={cfg.tz} onChange={(e) => set({ loc: -1, tz: +e.target.value })} /></label>
            </div>
            <button className="link" onClick={useMyLocation}>◎ Use my location</button>
            <div className="row2">
              <label className="field"><span className="field-head"><span>Date</span></span><input type="date" value={cfg.date} onChange={(e) => e.target.value && set({ date: e.target.value })} /></label>
              <label className="field">
                <span className="field-head"><span>Time</span></span>
                <input type="time" value={fmtTime(time)} onChange={(e) => { if (!e.target.value) return; const [hh, mm] = e.target.value.split(':').map(Number); setPlaying(false); setTime(hh + mm / 60) }} />
              </label>
            </div>
            <div className="seg">
              {Object.entries(WEATHER).map(([k, v]) => (
                <button key={k} className={cfg.weather === k ? 'on' : ''} onClick={() => set({ weather: k })}>{v.label}</button>
              ))}
            </div>
          </div>

          <div className="group">
            <h3>System</h3>
            <Slider label="Solar panels" value={cfg.panelKW} min={0.8} max={20} step={0.4} unit="kWp" onChange={(v) => set({ panelKW: +v.toFixed(1) })} hint={`${Math.round(cfg.panelKW / 0.4)} × 400 W panels`} />
            <Slider label="Inverter" value={cfg.inverterKW} min={1} max={15} step={0.5} unit="kW" onChange={(v) => set({ inverterKW: v })} hint={`DC/AC ratio ${(cfg.panelKW / cfg.inverterKW).toFixed(2)}${t.clipped > 0.05 ? ` · ${t.clipped.toFixed(1)} kWh clipped` : ''}`} />
            <Slider label="Battery" value={cfg.batteryKWh} min={0} max={40} step={1} unit="kWh" onChange={(v) => set({ batteryKWh: v })} hint={cfg.batteryKWh ? `usable ${(cfg.batteryKWh * 0.9).toFixed(1)} kWh · 10% reserve` : 'no battery'} />
          </div>

          <div className="group">
            <h3>House & grid</h3>
            <Slider label="Daily consumption" value={cfg.dailyLoad} min={4} max={60} step={1} unit="kWh" onChange={(v) => set({ dailyLoad: v })} hint={`avg ${(cfg.dailyLoad / 24).toFixed(2)} kW · evening peak profile`} />
            <Toggle label="Grid connected" checked={cfg.gridConnected} onChange={(v) => set({ gridConnected: v })} />
            <Toggle label="Export to grid (net metering)" checked={cfg.exportEnabled} disabled={!cfg.gridConnected} onChange={(v) => set({ exportEnabled: v })} />
            <div className="row2">
              <label className="field"><span className="field-head"><span>Import {cfg.cur.trim()}/kWh</span></span><input type="number" step="0.01" min="0" value={cfg.importPrice} onChange={(e) => set({ importPrice: +e.target.value })} /></label>
              <label className="field"><span className="field-head"><span>Export {cfg.cur.trim()}/kWh</span></span><input type="number" step="0.01" min="0" value={cfg.exportPrice} onChange={(e) => set({ exportPrice: +e.target.value })} /></label>
            </div>
          </div>
        </aside>
      </main>

      <section className="insights">
        <div className="insights-head">
          <div>
            <h2>Daily harvest</h2>
            <p>{locName} · {cfg.date} · sunrise {fmtTime(sim.sunrise)} · sunset {fmtTime(sim.sunset)} · peak sun {sim.maxElevation.toFixed(0)}°</p>
          </div>
        </div>
        <div className="stats">
          <Stat label="Solar harvested" value={t.pv.toFixed(1)} unit=" kWh" sub={`peak ${t.peakPv.toFixed(2)} kW${t.pvPotential - t.pv > 0.05 ? ` · ${(t.pvPotential - t.pv).toFixed(1)} kWh curtailed` : ''}`} tone="var(--c-solar)" />
          <Stat label="Home used" value={t.load.toFixed(1)} unit=" kWh" sub={t.unmet > 0.05 ? `${t.unmet.toFixed(1)} kWh unmet (outage)` : 'fully supplied'} tone="var(--c-home)" />
          <Stat label="Self-sufficiency" value={(t.selfSufficiency * 100).toFixed(0)} unit="%" sub={`self-consumption ${(t.selfConsumption * 100).toFixed(0)}%`} tone="var(--c-batt)" />
          <Stat label="Grid" value={t.gridImport.toFixed(1)} unit=" kWh in" sub={`${t.gridExport.toFixed(1)} kWh exported`} tone="var(--c-grid)" />
          <Stat label="Savings today" value={money(t.savings)} unit="" sub={`≈ ${money(t.savings * 30)} / month`} tone="var(--c-soc)" />
        </div>
        <HarvestChart rows={sim.rows} time={time} onTime={(v) => { setPlaying(false); setTime(v) }} hasBattery={cfg.batteryKWh > 0} />
        <p className="note">Clear-sky irradiance model (Haurwitz) on a {25}° equator-facing array with ~24% system losses; 5-minute simulation steps; battery at 95% efficiency each way. Estimates only.</p>
      </section>
    </div>
  )
}
