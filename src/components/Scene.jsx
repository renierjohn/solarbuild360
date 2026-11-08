import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Sky, Stars, Html } from '@react-three/drei'
import * as THREE from 'three'
import { PANEL_KW, PANEL_TILT } from '../sim'

const RAD = Math.PI / 180
// Modern two-volume house: upper charcoal box with a flat roof carries tilted panel racks.
const UPPER = { x: -1.2, w: 6.4, d: 6.2, top: 6.0 }
const ROOF_COLS = 6
const ROOF_MAX = ROOF_COLS * 3
const GROUND_COLS = 8

// Paths in site coordinates (north = -z, south = +z, east = +x).
const PATHS = {
  solar: [[0.8, 6.35, 1.5], [2.0, 6.05, 1.5], [2.15, 4.6, 1.5], [2.3, 3.3, 1.5], [4.1, 3.3, 1.3], [4.2, 2.18, 1.2]],
  battery: [[4.3, 1.35, 0.95], [4.62, 1.35, 0.35], [4.62, 1.5, -0.04]],
  home: [[4.18, 1.28, 1.56], [4.18, 0.35, 2.6], [3.6, 0.35, 3.3], [1.4, 0.35, 3.3], [0.6, 0.9, 3.15]],
  grid: [[10, 7.25, -6], [7, 4.4, -4.3], [4.12, 2.6, -2.3], [4.12, 2.25, -0.6], [4.12, 1.95, 0.85]],
}

const COLORS = { solar: '#ffc531', battery: '#3ee69d', home: '#ff7a6b', grid: '#55b2ff' }

function sunVector(elev, az) {
  const e = elev * RAD
  const a = az * RAD
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e))
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function usePanelTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 120
    c.height = 200
    const g = c.getContext('2d')
    g.fillStyle = '#c9ced6'
    g.fillRect(0, 0, 120, 200)
    const grad = g.createLinearGradient(0, 0, 120, 200)
    grad.addColorStop(0, '#1d3b78')
    grad.addColorStop(1, '#0d1d40')
    g.fillStyle = grad
    g.fillRect(4, 4, 112, 192)
    g.strokeStyle = 'rgba(160,190,255,0.35)'
    g.lineWidth = 1.2
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(4 + (112 / 6) * i, 4); g.lineTo(4 + (112 / 6) * i, 196); g.stroke() }
    for (let j = 1; j < 10; j++) { g.beginPath(); g.moveTo(4, 4 + (192 / 10) * j); g.lineTo(116, 4 + (192 / 10) * j); g.stroke() }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [])
}

function Panel({ map, ...props }) {
  return (
    <mesh castShadow receiveShadow {...props}>
      <boxGeometry args={[1.0, 0.05, 1.65]} />
      <meshStandardMaterial map={map} metalness={0.55} roughness={0.22} envMapIntensity={1} />
    </mesh>
  )
}

function Rack({ inRow, map, a, legs = 0.55 }) {
  return (
    <>
      <group position={[0, legs, 0]} rotation={[a, 0, 0]}>
        {Array.from({ length: inRow }).map((_, c) => <Panel key={c} map={map} position={[(c - (inRow - 1) / 2) * 1.04, 0, 0]} />)}
      </group>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * ((inRow * 1.04) / 2 - 0.25), 0, 0]}>
          <mesh position={[0, legs * 0.5 + 0.17, -0.62]} castShadow><boxGeometry args={[0.06, legs + 0.35, 0.06]} /><meshStandardMaterial color="#8d939b" metalness={0.6} roughness={0.4} /></mesh>
          <mesh position={[0, legs * 0.5 - 0.17, 0.62]} castShadow><boxGeometry args={[0.06, Math.max(0.05, legs - 0.35), 0.06]} /><meshStandardMaterial color="#8d939b" metalness={0.6} roughness={0.4} /></mesh>
        </group>
      ))}
    </>
  )
}

function SolarArray({ count }) {
  const map = usePanelTexture()
  const roof = Math.min(count, ROOF_MAX)
  const ground = count - roof
  const a = PANEL_TILT * RAD
  const roofRows = []
  for (let r = 0; r * ROOF_COLS < roof; r++) roofRows.push(Math.min(ROOF_COLS, roof - r * ROOF_COLS))
  const rows = []
  for (let r = 0; r * GROUND_COLS < ground; r++) rows.push(Math.min(GROUND_COLS, ground - r * GROUND_COLS))

  return (
    <group>
      {roofRows.map((inRow, r) => (
        <group key={r} position={[UPPER.x, UPPER.top, 2.1 - r * 2.0]}>
          <Rack inRow={inRow} map={map} a={a} />
        </group>
      ))}
      {rows.map((inRow, r) => (
        <group key={r} position={[-15, 0, -1 + r * 3.1]}>
          <Rack inRow={inRow} map={map} a={a} legs={1.05} />
        </group>
      ))}
    </group>
  )
}

function Glass({ night, glow, args, ...props }) {
  return (
    <mesh {...props}>
      <boxGeometry args={args} />
      <meshStandardMaterial color={night > 0.3 ? '#ffe2b0' : '#5f7f97'} emissive="#ffb14d" emissiveIntensity={glow} metalness={0.6} roughness={0.08} />
    </mesh>
  )
}

function Slats({ x0, x1, y0, y1, z, rotY = 0 }) {
  const n = Math.round((x1 - x0) / 0.16)
  return (
    <group rotation={[0, rotY, 0]}>
      {Array.from({ length: n }).map((_, i) => (
        <mesh key={i} position={[x0 + (i + 0.5) * ((x1 - x0) / n), (y0 + y1) / 2, z]} castShadow>
          <boxGeometry args={[0.09, y1 - y0, 0.08]} />
          <meshStandardMaterial color={i % 3 ? '#b27848' : '#9c6639'} roughness={0.75} />
        </mesh>
      ))}
    </group>
  )
}

function House({ night, load }) {
  const glow = night * (0.7 + Math.min(1, load / 2)) * 1.4
  const g = { night, glow }
  const white = <meshStandardMaterial color="#f1f0ec" roughness={0.85} />
  const dark = <meshStandardMaterial color="#2a2e34" roughness={0.6} metalness={0.2} />
  const slab = <meshStandardMaterial color="#d9d8d3" roughness={0.7} />
  const frame = <meshStandardMaterial color="#1b1d21" metalness={0.5} roughness={0.4} />
  const { x: ux, w: uw, d: ud, top } = UPPER
  return (
    <group>
      {/* plinth + front deck */}
      <mesh position={[0, 0.12, 0]} receiveShadow><boxGeometry args={[8.8, 0.24, 6.8]} /><meshStandardMaterial color="#9b9a95" roughness={0.9} /></mesh>
      <mesh position={[-1.4, 0.16, 4.2]} receiveShadow castShadow><boxGeometry args={[5.2, 0.12, 1.6]} /><meshStandardMaterial color="#8a5b38" roughness={0.8} /></mesh>

      {/* ground floor volume */}
      <mesh position={[0, 1.62, 0]} castShadow receiveShadow><boxGeometry args={[8, 2.8, 6]} />{white}</mesh>
      {/* floor slab / roof terrace with overhang */}
      <mesh position={[-0.2, 3.1, 0.4]} castShadow receiveShadow><boxGeometry args={[8.8, 0.22, 7]} />{slab}</mesh>
      {/* terrace glass rail */}
      <mesh position={[3.1, 3.65, 3.85]}><boxGeometry args={[2.2, 0.9, 0.04]} /><meshStandardMaterial color="#bfe0ff" transparent opacity={0.25} metalness={0.4} roughness={0.05} /></mesh>
      <mesh position={[3.1, 4.1, 3.85]}><boxGeometry args={[2.2, 0.04, 0.06]} />{frame}</mesh>

      {/* upper floor volume (charcoal, cantilevered west) */}
      <mesh position={[ux, (3.21 + top - 0.2) / 2, 0]} castShadow receiveShadow><boxGeometry args={[uw, top - 0.2 - 3.21, ud]} />{dark}</mesh>
      {/* roof slab with thin overhang */}
      <mesh position={[ux, top - 0.1, 0]} castShadow receiveShadow><boxGeometry args={[uw + 0.5, 0.2, ud + 0.5]} />{slab}</mesh>

      {/* south (front): floor-to-ceiling glazing, wood slat feature wall, door */}
      <Glass {...g} position={[-1.6, 1.55, 3.02]} args={[4.6, 2.3, 0.06]} />
      {[-3.9, -2.37, -0.83, 0.7].map((x) => <mesh key={x} position={[x, 1.55, 3.06]}><boxGeometry args={[0.07, 2.3, 0.05]} />{frame}</mesh>)}
      <Slats x0={1.0} x1={3.95} y0={0.24} y1={3.0} z={3.05} />
      <mesh position={[1.9, 1.3, 3.1]}><boxGeometry args={[0.95, 2.1, 0.06]} /><meshStandardMaterial color="#1b1d21" metalness={0.4} roughness={0.35} /></mesh>
      <mesh position={[2.25, 1.3, 3.15]}><boxGeometry args={[0.04, 0.8, 0.04]} /><meshStandardMaterial color="#c9a46a" metalness={0.8} roughness={0.25} /></mesh>
      {/* upper: wide ribbon window */}
      <Glass {...g} position={[ux - 0.4, 4.45, ud / 2 + 0.02]} args={[uw - 1.6, 1.3, 0.06]} />
      <mesh position={[ux - 0.4, 3.75, ud / 2 + 0.12]}><boxGeometry args={[uw - 1.4, 0.06, 0.25]} />{frame}</mesh>

      {/* west + north + east glazing */}
      <Glass {...g} position={[-4.02, 1.55, -0.6]} args={[0.06, 2.0, 2.6]} />
      <Glass {...g} position={[ux - uw / 2 - 0.02, 4.45, -0.4]} args={[0.06, 1.3, 3.4]} />
      <Glass {...g} position={[-1.8, 1.7, -3.02]} args={[2.6, 1.0, 0.06]} />
      <Glass {...g} position={[ux + 0.6, 4.45, -ud / 2 - 0.02]} args={[3.2, 1.0, 0.06]} />
      <Glass {...g} position={[ux + uw / 2 + 0.02, 4.45, 1.2]} args={[0.06, 1.6, 1.2]} />

      {/* exterior downlights + garden lights */}
      {[-3.4, -0.2, 1.9].map((x) => (
        <mesh key={x} position={[x, 2.96, 3.75]}><cylinderGeometry args={[0.07, 0.07, 0.02, 12]} /><meshStandardMaterial color="#fff2d6" emissive="#ffd28a" emissiveIntensity={night * 3} toneMapped={false} /></mesh>
      ))}
      {night > 0.3 && <pointLight position={[-1, 2.4, 4.6]} intensity={night * 6} distance={7} color="#ffcf8a" />}

      {/* pool */}
      <mesh position={[-8.2, 0.08, 4.4]} receiveShadow><boxGeometry args={[4.6, 0.16, 3]} /><meshStandardMaterial color="#e4e1da" roughness={0.8} /></mesh>
      <mesh position={[-8.2, 0.17, 4.4]}><boxGeometry args={[4, 0.02, 2.4]} /><meshStandardMaterial color="#2fb4d6" emissive="#1ea3d0" emissiveIntensity={night * 1.2} metalness={0.3} roughness={0.1} /></mesh>
    </group>
  )
}

function Equipment({ soc, pvOn, battState }) {
  const level = Math.max(0.02, soc / 100)
  return (
    <group>
      {/* inverter */}
      <mesh position={[4.15, 1.75, 1.2]} castShadow><boxGeometry args={[0.28, 0.9, 0.7]} /><meshStandardMaterial color="#e1e5ea" metalness={0.3} roughness={0.4} /></mesh>
      <mesh position={[4.3, 1.95, 1.2]}><boxGeometry args={[0.02, 0.18, 0.4]} /><meshStandardMaterial color="#0c1424" emissive={pvOn ? '#3ee69d' : '#334'} emissiveIntensity={pvOn ? 1.5 : 0.3} /></mesh>
      {/* battery */}
      <mesh position={[4.62, 1.1, -0.6]} castShadow receiveShadow><boxGeometry args={[0.72, 1.9, 1.1]} /><meshStandardMaterial color="#f4f6f8" metalness={0.15} roughness={0.35} /></mesh>
      <mesh position={[4.99, 0.42 + (1.4 * level) / 2, -0.6]}><boxGeometry args={[0.02, 1.4 * level, 0.12]} /><meshStandardMaterial color="#3ee69d" emissive="#3ee69d" emissiveIntensity={battState === 0 ? 0.6 : 1.6} toneMapped={false} /></mesh>
      <mesh position={[4.985, 1.12, -0.6]}><boxGeometry args={[0.01, 1.44, 0.16]} /><meshStandardMaterial color="#1b2333" /></mesh>
      {/* meter */}
      <mesh position={[4.08, 2.25, -2.3]}><boxGeometry args={[0.18, 0.5, 0.36]} /><meshStandardMaterial color="#9aa3ad" metalness={0.5} roughness={0.4} /></mesh>
      {/* utility pole */}
      <mesh position={[10, 4, -6]} castShadow><cylinderGeometry args={[0.14, 0.2, 8, 12]} /><meshStandardMaterial color="#6e5440" roughness={0.9} /></mesh>
      <mesh position={[10, 7.4, -6]} castShadow><boxGeometry args={[2.4, 0.14, 0.14]} /><meshStandardMaterial color="#6e5440" /></mesh>
      <mesh position={[10.45, 6.3, -6]} castShadow><cylinderGeometry args={[0.32, 0.32, 0.9, 16]} /><meshStandardMaterial color="#8f99a3" metalness={0.5} roughness={0.4} /></mesh>
      <mesh position={[12, 7.1, -14]} castShadow><cylinderGeometry args={[0.14, 0.2, 7.5, 12]} /><meshStandardMaterial color="#6e5440" /></mesh>
      <Wire a={[10, 7.4, -6]} b={[12, 7.3, -14]} />
    </group>
  )
}

function Wire({ a, b }) {
  const curve = useMemo(() => {
    const A = new THREE.Vector3(...a)
    const B = new THREE.Vector3(...b)
    const M = A.clone().lerp(B, 0.5)
    M.y -= 0.6
    return new THREE.QuadraticBezierCurve3(A, M, B)
  }, [a, b])
  return <mesh><tubeGeometry args={[curve, 24, 0.02, 5, false]} /><meshStandardMaterial color="#1d1f23" /></mesh>
}

const DOTS = 9
function Flow({ path, power, max, color }) {
  const curve = useMemo(() => new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p))), [path])
  const dots = useRef([])
  const off = useRef(0)
  const mag = Math.abs(power)
  const active = mag > 0.03
  const speed = 0.08 + 0.45 * Math.min(1, mag / Math.max(max, 0.1))
  const dir = Math.sign(power)
  const size = 0.06 + 0.07 * Math.min(1, mag / Math.max(max, 0.1))
  useFrame((_, dt) => {
    off.current += dt * speed * dir
    dots.current.forEach((m, i) => {
      if (!m) return
      const t = (((i / DOTS + off.current) % 1) + 1) % 1
      m.position.copy(curve.getPointAt(t))
      m.scale.setScalar(size / 0.1)
    })
  })
  return (
    <group>
      <mesh>
        <tubeGeometry args={[curve, 64, 0.035, 6, false]} />
        <meshStandardMaterial color={active ? color : '#2b2f36'} emissive={color} emissiveIntensity={active ? 0.35 : 0} roughness={0.6} />
      </mesh>
      {active &&
        Array.from({ length: DOTS }).map((_, i) => (
          <mesh key={i} ref={(el) => (dots.current[i] = el)}>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        ))}
    </group>
  )
}

function Label({ position, color, title, value, sub }) {
  return (
    <Html position={position} center distanceFactor={16} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className="tag" style={{ '--c': color }}>
        <span className="tag-title">{title}</span>
        <span className="tag-value">{value}</span>
        {sub && <span className="tag-sub">{sub}</span>}
      </div>
    </Html>
  )
}

function Trees() {
  const spots = [[-7, -9, 1.1], [-2, -12, 1.4], [6, -11, 1.0], [15, 4, 1.3], [-20, -6, 1.2], [17, -3, 0.9], [-6, 11, 0.8], [9, 12, 1.1]]
  return spots.map(([x, z, s], i) => (
    <group key={i} position={[x, 0, z]} scale={s}>
      <mesh position={[0, 0.8, 0]} castShadow><cylinderGeometry args={[0.15, 0.22, 1.6, 8]} /><meshStandardMaterial color="#6b4b32" /></mesh>
      <mesh position={[0, 2.6, 0]} castShadow><coneGeometry args={[1.3, 2.8, 10]} /><meshStandardMaterial color="#3f7a45" roughness={0.9} /></mesh>
      <mesh position={[0, 3.7, 0]} castShadow><coneGeometry args={[0.95, 2, 10]} /><meshStandardMaterial color="#4a8c50" roughness={0.9} /></mesh>
    </group>
  ))
}

function Environment({ elev, az }) {
  const dir = sunVector(elev, az)
  const day = smooth(-8, 12, elev)
  const sunI = Math.max(0, Math.sin(elev * RAD))
  const low = smooth(0, 25, elev)
  const sunColor = new THREE.Color('#ff9a4d').lerp(new THREE.Color('#fff6e5'), low)
  const skyColor = new THREE.Color('#1b2550').lerp(new THREE.Color('#cfe8ff'), day)
  const groundColor = new THREE.Color('#0d1410').lerp(new THREE.Color('#5d6f45'), day)
  const moonDir = sunVector(Math.max(15, -elev), (az + 180) % 360)
  return (
    <>
      <Sky distance={4000} sunPosition={dir.clone().multiplyScalar(100).toArray()} turbidity={7} rayleigh={elev > 0 ? 1.2 : 0.6} mieCoefficient={0.005} mieDirectionalG={0.85} />
      {elev < -2 && <Stars radius={300} depth={80} count={4000} factor={5} fade speed={0.4} />}
      <hemisphereLight args={[skyColor, groundColor, 0.25 + 0.75 * day]} />
      <directionalLight
        position={dir.clone().multiplyScalar(40).toArray()}
        intensity={elev > -1 ? 0.2 + 3.2 * Math.pow(sunI, 0.6) : 0}
        color={sunColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
      />
      <directionalLight position={moonDir.clone().multiplyScalar(40).toArray()} intensity={(1 - day) * 0.45} color="#9db4ff" />
      {elev > -4 && (
        <mesh position={dir.clone().multiplyScalar(220).toArray()}>
          <sphereGeometry args={[7, 32, 32]} />
          <meshBasicMaterial color={sunColor.clone().multiplyScalar(1.5)} toneMapped={false} />
        </mesh>
      )}
      {elev < 4 && (
        <mesh position={moonDir.clone().multiplyScalar(220).toArray()}>
          <sphereGeometry args={[4.5, 32, 32]} />
          <meshBasicMaterial color="#e8eeff" toneMapped={false} />
        </mesh>
      )}
    </>
  )
}

function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[160, 64]} />
        <meshStandardMaterial color="#6d9a55" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, 0.01, 7]} receiveShadow>
        <planeGeometry args={[3, 8]} />
        <meshStandardMaterial color="#a9a49a" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 12]} receiveShadow>
        <planeGeometry args={[160, 5]} />
        <meshStandardMaterial color="#3f4247" roughness={1} />
      </mesh>
    </group>
  )
}

export default function Scene({ state, config, lat }) {
  const { elev, az, pv, load, batt, grid, soc } = state
  const night = 1 - smooth(-4, 6, elev)
  const count = Math.max(1, Math.round(config.panelKW / PANEL_KW))
  const maxFlow = Math.max(config.inverterKW, 1)
  const kw = (v) => `${Math.abs(v).toFixed(2)} kW`
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [19, 12, 22], fov: 42, near: 0.1, far: 6000 }} gl={{ antialias: true }}>
      <Environment elev={elev} az={az} />
      <Ground />
      <Trees />
      <group rotation={[0, lat < 0 ? Math.PI : 0, 0]}>
        <House night={night} load={load} />
        <SolarArray count={count} />
        <Equipment soc={soc} pvOn={pv > 0.02} battState={Math.sign(Math.round(batt * 50))} />
        <Flow path={PATHS.solar} power={pv} max={maxFlow} color={COLORS.solar} />
        <Flow path={PATHS.battery} power={batt} max={maxFlow} color={COLORS.battery} />
        <Flow path={PATHS.home} power={load} max={maxFlow} color={COLORS.home} />
        <Flow path={PATHS.grid} power={config.gridConnected ? grid : 0} max={maxFlow} color={COLORS.grid} />
        <Label position={[-1.2, 8.0, 2.4]} color={COLORS.solar} title="Solar" value={kw(pv)} sub={`${config.panelKW} kWp · ${count} panels`} />
        <Label position={[5.4, 3.3, 2.1]} color="#c9d3e0" title="Inverter" value={kw(Math.min(pv, config.inverterKW))} sub={`${Math.round((pv / config.inverterKW) * 100)}% of ${config.inverterKW} kW`} />
        {config.batteryKWh > 0 && (
          <Label position={[6.3, 2.6, -1.0]} color={COLORS.battery} title="Battery" value={`${soc.toFixed(0)}%`} sub={batt > 0.03 ? `charging ${kw(batt)}` : batt < -0.03 ? `discharging ${kw(batt)}` : 'idle'} />
        )}
        <Label position={[-1.6, 1.4, 5.4]} color={COLORS.home} title="Home" value={kw(load)} sub="consumption" />
        <Label
          position={[10, 9, -6]}
          color={COLORS.grid}
          title="Grid"
          value={config.gridConnected ? kw(grid) : 'offline'}
          sub={!config.gridConnected ? 'off-grid mode' : grid > 0.03 ? 'importing' : grid < -0.03 ? 'exporting' : 'idle'}
        />
      </group>
      <OrbitControls target={[0, 2.8, 0]} enableDamping maxPolarAngle={1.47} minDistance={9} maxDistance={70} />
    </Canvas>
  )
}
