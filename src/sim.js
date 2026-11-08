// Solar + home energy simulation (clear-sky model, 5-minute steps over 24h).
const RAD = Math.PI / 180
export const STEPS = 288
export const DT = 24 / STEPS
export const PANEL_KW = 0.4
export const PANEL_TILT = 25 // matches the roof pitch in the 3D scene

export const LOCATIONS = [
  { name: 'Manila, PH', lat: 14.6, lon: 121.0, tz: 8, cur: '₱', price: 12 },
  { name: 'Cebu, PH', lat: 10.32, lon: 123.89, tz: 8, cur: '₱', price: 12 },
  { name: 'Davao, PH', lat: 7.07, lon: 125.61, tz: 8, cur: '₱', price: 11 },
  { name: 'Phoenix, US', lat: 33.45, lon: -112.07, tz: -7, cur: '$', price: 0.15 },
  { name: 'Los Angeles, US', lat: 34.05, lon: -118.24, tz: -8, cur: '$', price: 0.3 },
  { name: 'Berlin, DE', lat: 52.52, lon: 13.4, tz: 1, cur: '€', price: 0.38 },
  { name: 'Dubai, AE', lat: 25.2, lon: 55.27, tz: 4, cur: 'AED ', price: 0.38 },
  { name: 'Sydney, AU', lat: -33.87, lon: 151.21, tz: 10, cur: 'A$', price: 0.32 },
  { name: 'Tokyo, JP', lat: 35.68, lon: 139.69, tz: 9, cur: '¥', price: 31 },
]

export const WEATHER = {
  clear: { label: 'Clear', factor: () => 1 },
  partly: {
    label: 'Partly cloudy',
    factor: (t) => {
      const n = Math.sin(t * 2.1) * 0.5 + Math.sin(t * 5.3 + 1.7) * 0.3 + Math.sin(t * 11.9 + 0.4) * 0.2
      return Math.min(1, Math.max(0.2, 0.68 + n * 0.38))
    },
  },
  overcast: { label: 'Overcast', factor: () => 0.22 },
}

// Typical residential load shape (relative kW per hour).
const LOAD_SHAPE = [0.5, 0.45, 0.42, 0.42, 0.45, 0.6, 0.9, 1.1, 1.0, 0.85, 0.8, 0.85, 0.95, 0.9, 0.85, 0.9, 1.05, 1.35, 1.6, 1.65, 1.5, 1.25, 0.9, 0.65]
const LOAD_SUM = LOAD_SHAPE.reduce((a, b) => a + b, 0)

export function dayOfYear(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5)
}

// NOAA approximation. Azimuth: degrees clockwise from north.
export function sunPosition(lat, lon, tz, doy, hour) {
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hour - 12) / 24)
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
  const tst = hour * 60 + eq + 4 * lon - 60 * tz
  const ha = (tst / 4 - 180) * RAD
  const phi = lat * RAD
  const cosZ = Math.min(1, Math.max(-1, Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha)))
  const elevation = 90 - Math.acos(cosZ) / RAD
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180
  return { elevation, azimuth: (az + 360) % 360 }
}

// Plane-of-array irradiance (W/m²) for an equator-facing panel.
function poaIrradiance(sun, lat) {
  if (sun.elevation <= 0) return 0
  const cosZ = Math.sin(sun.elevation * RAD)
  const ghi = 1098 * cosZ * Math.exp(-0.057 / cosZ) // Haurwitz clear-sky
  const diffuse = 0.14 * ghi
  const dni = (ghi - diffuse) / Math.max(cosZ, 0.05)
  const tilt = PANEL_TILT * RAD
  const panelAz = (lat >= 0 ? 180 : 0) * RAD
  const zen = (90 - sun.elevation) * RAD
  const cosInc = Math.cos(zen) * Math.cos(tilt) + Math.sin(zen) * Math.sin(tilt) * Math.cos(sun.azimuth * RAD - panelAz)
  return Math.max(0, dni * Math.max(0, cosInc) + diffuse * (1 + Math.cos(tilt)) / 2)
}

function loadAt(hour, dailyKWh) {
  const i = Math.floor(hour) % 24
  const f = hour - Math.floor(hour)
  const v = LOAD_SHAPE[i] * (1 - f) + LOAD_SHAPE[(i + 1) % 24] * f
  return (v / LOAD_SUM) * dailyKWh
}

export function simulate(cfg) {
  const doy = dayOfYear(cfg.date)
  const cap = cfg.batteryKWh
  const minSoc = cap * 0.1
  const maxP = cap > 0 ? Math.min(cfg.inverterKW, Math.max(cap * 0.5, 1)) : 0
  const eff = 0.95
  const weather = WEATHER[cfg.weather] ?? WEATHER.clear

  const base = []
  for (let i = 0; i < STEPS; i++) {
    const t = i * DT
    const sun = sunPosition(cfg.lat, cfg.lon, cfg.tz, doy, t)
    const dc = (cfg.panelKW * poaIrradiance(sun, cfg.lat) * weather.factor(t)) / 1000 * 0.76
    const pvAvail = Math.min(dc * 0.97, cfg.inverterKW)
    base.push({ t, elev: sun.elevation, az: sun.azimuth, pvAvail, clipped: Math.max(0, dc * 0.97 - cfg.inverterKW), load: loadAt(t, cfg.dailyLoad) })
  }

  const runDay = (soc0) => {
    let soc = soc0
    const rows = base.map((b) => {
      let pv = b.pvAvail
      let batt
      let grid = 0
      let unmet = 0
      const surplus = pv - b.load
      if (surplus >= 0) {
        const charge = cap > 0 ? Math.min(surplus, maxP, (cap - soc) / (eff * DT)) : 0
        soc += charge * eff * DT
        batt = charge
        const left = surplus - charge
        if (cfg.gridConnected && cfg.exportEnabled) grid = -left
        else pv -= left // curtailed
      } else {
        const need = -surplus
        const dis = cap > 0 ? Math.min(need, maxP, ((soc - minSoc) * eff) / DT) : 0
        soc -= (Math.max(0, dis) / eff) * DT
        batt = -Math.max(0, dis)
        const rest = need - Math.max(0, dis)
        if (cfg.gridConnected) grid = rest
        else unmet = rest
      }
      return { ...b, pv, batt, grid, unmet, soc: cap > 0 ? (soc / cap) * 100 : 0 }
    })
    return { rows, endSoc: soc }
  }

  const warm = runDay(cap * 0.5)
  const { rows } = runDay(Math.max(minSoc, warm.endSoc))

  const sum = (k, fn = (v) => v) => rows.reduce((a, r) => a + fn(r[k]), 0) * DT
  const totals = {
    pv: sum('pv'),
    pvPotential: sum('pvAvail'),
    load: sum('load'),
    gridImport: sum('grid', (v) => Math.max(0, v)),
    gridExport: sum('grid', (v) => Math.max(0, -v)),
    battIn: sum('batt', (v) => Math.max(0, v)),
    battOut: sum('batt', (v) => Math.max(0, -v)),
    unmet: sum('unmet'),
    clipped: sum('clipped'),
    peakPv: Math.max(...rows.map((r) => r.pv)),
  }
  totals.selfSufficiency = totals.load > 0 ? Math.max(0, 1 - (totals.gridImport + totals.unmet) / totals.load) : 0
  totals.selfConsumption = totals.pv > 0 ? Math.max(0, 1 - totals.gridExport / totals.pv) : 0
  totals.savings = (totals.load - totals.gridImport - totals.unmet) * cfg.importPrice + totals.gridExport * cfg.exportPrice

  return { rows, totals, ...sunEvents(rows) }
}

function sunEvents(rows) {
  let sunrise = null
  let sunset = null
  let noon = 12
  let maxE = -90
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]
    const b = rows[(i + 1) % rows.length]
    if (a.elev > maxE) { maxE = a.elev; noon = a.t }
    if (i === rows.length - 1) break
    const f = a.elev / (a.elev - b.elev)
    if (a.elev <= 0 && b.elev > 0) sunrise = a.t + f * DT
    if (a.elev > 0 && b.elev <= 0) sunset = a.t + f * DT
  }
  return { sunrise, sunset, noon, maxElevation: maxE }
}

export function valueAt(rows, t) {
  const x = (((t % 24) + 24) % 24) / DT
  const i = Math.floor(x)
  const f = x - i
  const a = rows[i % STEPS]
  const b = rows[(i + 1) % STEPS]
  const out = {}
  for (const k of ['pv', 'load', 'batt', 'grid', 'soc', 'elev', 'unmet', 'pvAvail']) out[k] = a[k] * (1 - f) + b[k] * f
  // azimuth wraps at 360
  let d = b.az - a.az
  if (d > 180) d -= 360
  if (d < -180) d += 360
  out.az = (a.az + d * f + 360) % 360
  return out
}

export const fmtTime = (h) => {
  if (h == null) return '—'
  const m = Math.round((((h % 24) + 24) % 24) * 60) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
