import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtTime, valueAt } from '../sim'

const SERIES = [
  { key: 'pv', label: 'Solar harvest', color: 'var(--c-solar)', unit: 'kW' },
  { key: 'load', label: 'Home load', color: 'var(--c-home)', unit: 'kW' },
  { key: 'batt', label: 'Battery (+charge)', color: 'var(--c-batt)', unit: 'kW' },
  { key: 'grid', label: 'Grid (+import)', color: 'var(--c-grid)', unit: 'kW' },
  { key: 'soc', label: 'Battery charge', color: 'var(--c-soc)', unit: '%' },
]

function niceStep(range) {
  const raw = range / 5
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / p
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p
}

export default function HarvestChart({ rows, time, onTime, hasBattery }) {
  const wrap = useRef(null)
  const [w, setW] = useState(900)
  const [hover, setHover] = useState(null)
  const [hidden, setHidden] = useState({})
  const drag = useRef(false)

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, e.contentRect.width)))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])

  const h = w < 600 ? 260 : 320
  const m = { l: 42, r: 42, t: 14, b: 28 }
  const iw = w - m.l - m.r
  const ih = h - m.t - m.b

  const geo = useMemo(() => {
    const vals = rows.flatMap((r) => [r.pv, r.load, r.batt, r.grid])
    const hi = Math.max(1, ...vals)
    const lo = Math.min(0, ...vals)
    const step = niceStep(hi - lo)
    const max = Math.ceil(hi / step) * step
    const min = Math.floor(lo / step) * step
    const x = (t) => m.l + (t / 24) * iw
    const y = (v) => m.t + ((max - v) / (max - min)) * ih
    const ys = (p) => m.t + (1 - p / 100) * ih
    const pts = [...rows, { ...rows[0], t: 24 }]
    const line = (k, fy = y) => pts.map((r, i) => `${i ? 'L' : 'M'}${x(r.t).toFixed(1)},${fy(r[k]).toFixed(1)}`).join('')
    const area = `${line('pv')}L${x(24)},${y(0)}L${x(0)},${y(0)}Z`
    const nights = []
    let start = null
    pts.forEach((r) => {
      if (r.elev < 0 && start == null) start = r.t
      if (r.elev >= 0 && start != null) { nights.push([start, r.t]); start = null }
    })
    if (start != null) nights.push([start, 24])
    const ticks = []
    for (let v = min; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(3))
    return { x, y, ys, area, lines: Object.fromEntries(SERIES.map((s) => [s.key, line(s.key, s.key === 'soc' ? ys : y)])), nights, ticks }
  }, [rows, iw, ih, m.l, m.t])

  const toT = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(23.99, Math.max(0, ((e.clientX - r.left - m.l) / iw) * 24))
  }
  const hv = hover != null ? valueAt(rows, hover) : null
  const visible = SERIES.filter((s) => (s.key === 'soc' || s.key === 'batt' ? hasBattery : true))

  return (
    <div className="chart">
      <div className="legend">
        {visible.map((s) => (
          <button key={s.key} className={`chip ${hidden[s.key] ? 'off' : ''}`} onClick={() => setHidden((o) => ({ ...o, [s.key]: !o[s.key] }))} style={{ '--c': s.color }}>
            <i className={s.key === 'soc' ? 'dash' : ''} />
            {s.label}
          </button>
        ))}
      </div>
      <div ref={wrap} className="chart-wrap">
        <svg
          width={w}
          height={h}
          onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); onTime(toT(e)) }}
          onPointerMove={(e) => { const t = toT(e); setHover(t); if (drag.current) onTime(t) }}
          onPointerUp={() => (drag.current = false)}
          onPointerLeave={() => { setHover(null); drag.current = false }}
          role="img"
          aria-label="24-hour energy flow chart"
        >
          <defs>
            <linearGradient id="pvfill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--c-solar)" stopOpacity="0.55" />
              <stop offset="1" stopColor="var(--c-solar)" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          {geo.nights.map(([a, b], i) => (
            <rect key={i} x={geo.x(a)} y={m.t} width={geo.x(b) - geo.x(a)} height={ih} fill="var(--night-band)" />
          ))}
          {geo.ticks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={w - m.r} y1={geo.y(v)} y2={geo.y(v)} stroke={v === 0 ? 'var(--axis-strong)' : 'var(--grid-line)'} />
              <text x={m.l - 8} y={geo.y(v) + 4} textAnchor="end" className="tick">{v}</text>
            </g>
          ))}
          {hasBattery && [0, 50, 100].map((p) => (
            <text key={p} x={w - m.r + 8} y={geo.ys(p) + 4} className="tick">{p}%</text>
          ))}
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((t) => (
            <text key={t} x={geo.x(t)} y={h - 8} textAnchor="middle" className="tick">{w < 600 && t % 6 ? '' : fmtTime(t === 24 ? 23.999 : t).replace('23:59', '24:00')}</text>
          ))}
          <text x={12} y={m.t + ih / 2} className="tick axis-label" transform={`rotate(-90 12 ${m.t + ih / 2})`} textAnchor="middle">kW</text>
          {!hidden.pv && <path d={geo.area} fill="url(#pvfill)" />}
          {visible.map((s) => !hidden[s.key] && (
            <path key={s.key} d={geo.lines[s.key]} fill="none" stroke={s.color} strokeWidth={s.key === 'pv' ? 2.4 : 1.8} strokeDasharray={s.key === 'soc' ? '5 4' : undefined} strokeLinejoin="round" />
          ))}
          <line x1={geo.x(time)} x2={geo.x(time)} y1={m.t - 4} y2={m.t + ih} stroke="var(--cursor)" strokeWidth="2" />
          <circle cx={geo.x(time)} cy={m.t - 4} r="5" fill="var(--cursor)" />
          {hv && <line x1={geo.x(hover)} x2={geo.x(hover)} y1={m.t} y2={m.t + ih} stroke="var(--axis-strong)" strokeDasharray="2 3" />}
        </svg>
        {hv && (
          <div className="tooltip" style={{ left: Math.min(geo.x(hover) + 12, w - 190) }}>
            <b>{fmtTime(hover)}</b>
            {visible.map((s) => (
              <div key={s.key}><i style={{ background: s.color }} />{s.label}<span>{s.unit === '%' ? `${hv[s.key].toFixed(0)}%` : `${hv[s.key].toFixed(2)} kW`}</span></div>
            ))}
            <div className="hint">click / drag to set time</div>
          </div>
        )}
      </div>
    </div>
  )
}
