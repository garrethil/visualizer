import { useEffect, useRef, useState, useCallback } from 'react'
import LogoImg from './RE.png'

// ─── tuning constants ────────────────────────────────────────────────────────
const FFT_SIZE      = 2048   // → 1024 frequency bins (more spectral detail)
const SMOOTHING     = 0.72   // less smoothing = faster response to transients
const ANALYSER_MIN_DB = -100
const ANALYSER_MAX_DB = -18
const FREQ_RESPONSE_GAMMA = 0.62
const TRAIL_ALPHA   = 0.42   // lower = longer ghost trails
const HUE_SPEED     = 0.4    // degrees of colour rotation per frame
const MAX_PARTICLES = 40    // maximum simultaneous shapes on screen
const BASE_SPEED    = 3.4    // base fall speed in px/frame
const BASS_TRANSIENT_BOOST = 6
const BAND_TRIGGER_BASE = 0.22
const BAND_TRIGGER_DELTA = 0.035
const BAND_COOLDOWN_MIN = 8
const BAND_COOLDOWN_MAX = 30
const MODES = {
  SHAPES: 'shapes',
  CIRCULAR: 'circular',
  LINE: 'line',
}

const CIRCLE_SEGMENTS = 8
const CIRCLE_TRAIL_ALPHA = 0.1
const CIRCLE_SPIN_SPEED = 0.0008
const LINE_TRAIL_ALPHA = 0.24
const LINE_BASE_WIDTH = 5.2
const LINE_SNAKE_MIN_POINTS = 40
const LINE_SNAKE_MAX_POINTS = 320
const LINE_RANDOM_TURN = 0.03
const LINE_SHARP_TURN_CHANCE = 0.015
const LINE_SNAKE_COUNT = 25
const LINE_BASE_SPEED = 0.2
const LINE_TRANSIENT_BOOST = 5.2
const COLOR_RANGE_COUNT = 128

const DEFAULT_CONTROLS = {
  [MODES.SHAPES]: {
    spawnThreshold: BAND_TRIGGER_BASE,
    motionGain: 1,
    strokeGain: 1,
  },
  [MODES.CIRCULAR]: {
    segments: CIRCLE_SEGMENTS,
    trail: CIRCLE_TRAIL_ALPHA,
    spin: CIRCLE_SPIN_SPEED,
    orbGain: 3,
  },
  [MODES.LINE]: {
    snakeCount: LINE_SNAKE_COUNT,
    baseSpeed: LINE_BASE_SPEED,
    randomTurn: LINE_RANDOM_TURN,
    transientBoost: LINE_TRANSIENT_BOOST,
    maxLength: LINE_SNAKE_MAX_POINTS,
  },
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1 = 0
  let g1 = 0
  let b1 = 0

  if (hp >= 0 && hp < 1) {
    r1 = c; g1 = x
  } else if (hp < 2) {
    r1 = x; g1 = c
  } else if (hp < 3) {
    g1 = c; b1 = x
  } else if (hp < 4) {
    g1 = x; b1 = c
  } else if (hp < 5) {
    r1 = x; b1 = c
  } else {
    r1 = c; b1 = x
  }

  const m = l - c / 2
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

function buildColorScale(count) {
  const out = []
  const goldenAngle = 137.50776405003785
  for (let i = 0; i < count; i++) {
    const hue = (i * goldenAngle) % 360
    const sat = 0.78 + (i % 3) * 0.07      // 0.78, 0.85, 0.92
    const light = 0.42 + (i % 4) * 0.09    // 0.42, 0.51, 0.60, 0.69
    out.push(hslToRgb(hue, Math.min(sat, 0.98), Math.min(light, 0.82)))
  }
  return out
}

const COLOR_SCALE = buildColorScale(COLOR_RANGE_COUNT)

function freqRangeIndex(binIndex, totalBins) {
  const pos = Math.max(0, Math.min(0.999999, binIndex / Math.max(1, totalBins)))
  return Math.floor(pos * COLOR_RANGE_COUNT)
}

function paletteColor(index, alpha = 1) {
  const safeIndex = ((index % COLOR_SCALE.length) + COLOR_SCALE.length) % COLOR_SCALE.length
  const { r, g, b } = COLOR_SCALE[safeIndex]
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function normAmp(byteValue) {
  return Math.pow(byteValue / 255, FREQ_RESPONSE_GAMMA)
}

function rangeEnergy(dataArray, start, end) {
  let sum = 0
  const s = Math.max(0, start)
  const e = Math.min(dataArray.length, end)
  for (let i = s; i < e; i++) sum += normAmp(dataArray[i])
  return e > s ? sum / (e - s) : 0
}

function createSnake(W, H, rangeIndex) {
  const x = Math.random() * W
  const y = Math.random() * H
  return {
    head: { x, y, angle: Math.random() * Math.PI * 2 },
    points: Array.from({ length: LINE_SNAKE_MIN_POINTS }, () => ({ x, y })),
    turnVel: 0,
    rangeIndex,
  }
}

function Knob({ label, value, min, max, step = 0.01, onChange }) {
  const pct = (value - min) / Math.max(1e-6, max - min)
  const angle = -135 + pct * 270

  const startRef = useRef({ y: 0, value: 0, active: false })

  const clamp = useCallback((n) => Math.max(min, Math.min(max, n)), [min, max])

  const onPointerDown = useCallback((e) => {
    startRef.current = { y: e.clientY, value, active: true }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [value])

  const onPointerMove = useCallback((e) => {
    if (!startRef.current.active) return
    const delta = startRef.current.y - e.clientY
    const sensitivity = (max - min) / 140
    const next = clamp(startRef.current.value + delta * sensitivity)
    const snapped = Math.round(next / step) * step
    onChange(clamp(snapped))
  }, [clamp, max, min, onChange, step])

  const onPointerUp = useCallback((e) => {
    startRef.current.active = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

  return (
    <div style={knobWrapStyle}>
      <div
        style={knobStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title={`${label}: ${value.toFixed(2)}`}
      >
        <div style={{ ...knobNeedleStyle, transform: `translateX(-50%) rotate(${angle}deg)` }} />
        <div style={knobCenterStyle} />
      </div>
      <div style={knobLabelStyle}>{label}</div>
      <div style={knobValueStyle}>{value.toFixed(step >= 1 ? 0 : 2)}</div>
    </div>
  )
}

// ─── frequency band → shape + hue mapping ───────────────────────────────────
// 256 bins: sub-bass → bass → low-mid → mid → high-mid → presence → highs
const BANDS = [
  { max:  10, shape: 'circle',   hue:   5 },  // sub-bass  → red/orange
  { max:  30, shape: 'triangle', hue:  25 },  // bass      → orange
  { max:  70, shape: 'square',   hue:  55 },  // low-mid   → yellow
  { max: 120, shape: 'diamond',  hue: 115 },  // mid       → green
  { max: 170, shape: 'hexagon',  hue: 190 },  // high-mid  → cyan
  { max: 220, shape: 'pentagon', hue: 235 },  // presence  → blue
  { max: 256, shape: 'star',     hue: 285 },  // highs     → violet
]

function bandFor(binIndex) {
  return BANDS.find(b => binIndex <= b.max) ?? BANDS[BANDS.length - 1]
}

function bandBounds(bandIndex, bins) {
  const prevMax = bandIndex === 0 ? 0 : BANDS[bandIndex - 1].max
  const currMax = BANDS[bandIndex].max
  const start = Math.floor((prevMax / 256) * bins)
  const end = bandIndex === BANDS.length - 1
    ? bins
    : Math.max(start + 1, Math.floor((currMax / 256) * bins))
  return { start, end }
}

// ─── shape drawing helpers ───────────────────────────────────────────────────
function polygon(ctx, sides, r) {
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2
    i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
            : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
}

function star(ctx, points, outerR, innerR) {
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
            : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
}

function drawShape(ctx, type, r) {
  ctx.beginPath()
  switch (type) {
    case 'circle':   ctx.arc(0, 0, r, 0, Math.PI * 2); break
    case 'triangle': polygon(ctx, 3, r); break
    case 'square':   ctx.rect(-r, -r, r * 2, r * 2); break
    case 'diamond':
      ctx.moveTo(0, -r * 1.3); ctx.lineTo(r * 0.85, 0)
      ctx.lineTo(0,  r * 1.3); ctx.lineTo(-r * 0.85, 0)
      ctx.closePath(); break
    case 'pentagon': polygon(ctx, 5, r); break
    case 'hexagon':  polygon(ctx, 6, r); break
    case 'star':     star(ctx, 5, r, r * 0.42); break
  }
}

function spawnParticleForBand(W, dataArray, bandIndex) {
  const { start, end } = bandBounds(bandIndex, dataArray.length)
  const binIndex = Math.min(dataArray.length - 1, start + Math.floor(Math.random() * Math.max(1, end - start)))
  const amp      = normAmp(dataArray[binIndex])
  const band     = BANDS[bandIndex]
  const colorIndex = freqRangeIndex(binIndex, dataArray.length)
  const size     = 10 + Math.random() * 22 + amp * 18
  return {
    x:        Math.random() * W,
    y:        -(size * 2),
    vx:       (Math.random() - 0.5) * 1.6,
    vy:       BASE_SPEED * (0.5 + Math.random() * 1.2),
    shape:    band.shape,
    baseHue:  band.hue,
    colorIndex,
    size,
    rotation: Math.random() * Math.PI * 2,
    rotSp:    (Math.random() - 0.5) * 0.05,
    phase:    Math.random() * Math.PI * 2,
    binIndex,
    alpha:    0.55 + amp * 0.45,
  }
}

export default function Visualizer() {
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const stateRef  = useRef({
    audioCtx: null, analyser: null, source: null,
    dataArray: null, animId: null, running: false, hueShift: 0, particles: [],
    prevBass: 0, bassPulse: 0, time: 0,
    prevBandEnergy: Array(BANDS.length).fill(0),
    bandCooldowns: Array(BANDS.length).fill(0),
    mode: MODES.SHAPES,
    snakeLines: [],
    linePrevEnergy: 0,
    linePulse: 0,
  })
  const [status, setStatus] = useState('idle')
  const [mode, setMode] = useState(MODES.SHAPES)
  const [controls, setControls] = useState(DEFAULT_CONTROLS)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const controlsRef = useRef(DEFAULT_CONTROLS)

  useEffect(() => {
    controlsRef.current = controls
  }, [controls])

  const updateControl = useCallback((targetMode, key, value) => {
    setControls(prev => ({
      ...prev,
      [targetMode]: {
        ...prev[targetMode],
        [key]: value,
      },
    }))
  }, [])

  const resetControlsForMode = useCallback((targetMode) => {
    setControls(prev => ({
      ...prev,
      [targetMode]: { ...DEFAULT_CONTROLS[targetMode] },
    }))
  }, [])

  // ─── resize handler ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await rootRef.current?.requestFullscreen()
      }
    } catch {
      // ignore; browser may block fullscreen without user gesture
    }
  }, [])

  // ─── animation loop ────────────────────────────────────────────────────────
  const drawShapes = useCallback((ctx, W, H) => {
    const s = stateRef.current
    const cfg = controlsRef.current[MODES.SHAPES]

    const bins = s.dataArray.length
    const bassEnergy = rangeEnergy(s.dataArray, 0, Math.floor(bins * 0.10))
    const midEnergy  = rangeEnergy(s.dataArray, Math.floor(bins * 0.10), Math.floor(bins * 0.48))
    const highEnergy = rangeEnergy(s.dataArray, Math.floor(bins * 0.48), bins)
    const transient  = Math.max(0, bassEnergy - s.prevBass)
    s.prevBass = bassEnergy
    s.bassPulse = Math.max(s.bassPulse * 0.86, transient * BASS_TRANSIENT_BOOST + bassEnergy * 0.45)

    // spawn only when specific frequency bands rise above threshold
    const bandEnergies = BANDS.map((_, bandIndex) => {
      const { start, end } = bandBounds(bandIndex, bins)
      return rangeEnergy(s.dataArray, start, end)
    })
    for (let i = 0; i < BANDS.length && s.particles.length < MAX_PARTICLES; i++) {
      s.bandCooldowns[i] = Math.max(0, s.bandCooldowns[i] - 1)

      const energy = bandEnergies[i]
      const rise   = Math.max(0, energy - s.prevBandEnergy[i])
      s.prevBandEnergy[i] = energy

      const threshold = cfg.spawnThreshold + i * 0.01
      const transientKick = i <= 1 && s.bassPulse > 0.28 && energy > 0.16
      const shouldSpawn = s.bandCooldowns[i] === 0 && ((energy > threshold && rise > BAND_TRIGGER_DELTA) || transientKick)

      if (shouldSpawn) {
        const spawnCount = (rise > 0.11 || energy > 0.62) ? 2 : 1
        for (let n = 0; n < spawnCount && s.particles.length < MAX_PARTICLES; n++) {
          s.particles.push(spawnParticleForBand(W, s.dataArray, i))
        }
        const cooldown = Math.round(BAND_COOLDOWN_MAX - energy * 14 - rise * 28)
        s.bandCooldowns[i] = Math.max(BAND_COOLDOWN_MIN, cooldown)
      }
    }

    // trail fade
    const dynamicTrail = Math.max(0.08, TRAIL_ALPHA - bassEnergy * 0.25)
    ctx.fillStyle = `rgba(0,0,0,${dynamicTrail})`
    ctx.fillRect(0, 0, W, H)

    // remove off-screen particles
    s.particles = s.particles.filter(p => p.y < H + p.size * 2)

    for (const p of s.particles) {
      const amp = normAmp(s.dataArray[p.binIndex])
      const freqNorm = p.binIndex / (bins - 1)
      const sideSway = Math.sin(s.time * (0.015 + freqNorm * 0.032) + p.phase)

      p.y += p.vy * (0.65 + amp * 1.25 + bassEnergy * 0.8 + s.bassPulse * 0.55) * cfg.motionGain
      p.x += (p.vx + sideSway * (0.25 + highEnergy * 3.4 + amp * 1.8)) * cfg.motionGain
      p.rotation += p.rotSp * (1 + midEnergy * 2.5 + amp * 1.8 + s.bassPulse * 0.6) * cfg.motionGain

      // wrap horizontally
      if (p.x < -p.size * 2) p.x = W + p.size
      if (p.x > W + p.size * 2) p.x = -p.size

      const drawSize = p.size * (0.62 + amp * 0.72 + s.bassPulse * 0.45)
      const fillIndex = p.colorIndex
      const strokeIndex = fillIndex + 2
      const alpha     = p.alpha * (0.45 + amp * 0.45 + highEnergy * 0.25)

      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)

      // glow
      ctx.shadowColor = paletteColor(strokeIndex, 0.92)
      ctx.shadowBlur  = 10 + amp * 28   // strong glow on loud bins

      // filled shape
      drawShape(ctx, p.shape, drawSize)
      ctx.fillStyle = paletteColor(fillIndex, alpha * 0.58)
      ctx.fill()

      // bright stroke edge
      drawShape(ctx, p.shape, drawSize)
      ctx.strokeStyle = paletteColor(strokeIndex, alpha * 0.95)
      ctx.lineWidth   = (1.2 + amp * 1.8) * cfg.strokeGain
      ctx.stroke()

      ctx.shadowBlur = 0
      ctx.restore()
    }
  }, [])

  const drawCircular = useCallback((ctx, W, H) => {
    const s = stateRef.current
    const cfg = controlsRef.current[MODES.CIRCULAR]
    const cx = W / 2
    const cy = H / 2
    const bins = s.dataArray.length
    const totalSegs = Math.max(4, Math.round(cfg.segments)) * 2
    const wedgeAngle = (Math.PI * 2) / totalSegs
    const maxR = Math.min(cx, cy) * 0.92
    const minR = maxR * 0.06
    const spin = s.hueShift * cfg.spin

    ctx.fillStyle = `rgba(0,0,0,${cfg.trail})`
    ctx.fillRect(0, 0, W, H)

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(spin)

    for (let seg = 0; seg < totalSegs; seg++) {
      ctx.save()
      ctx.rotate((Math.PI * 2 / totalSegs) * seg)
      if (seg % 2 === 1) ctx.scale(1, -1)

      ctx.beginPath()
      for (let i = 0; i < bins; i++) {
        const amp = normAmp(s.dataArray[i])
        const r = minR + amp * (maxR - minR)
        const angle = (i / (bins - 1)) * wedgeAngle - wedgeAngle / 2
        const x = Math.cos(angle) * r
        const y = Math.sin(angle) * r
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      for (let i = bins - 1; i >= 0; i--) {
        const angle = (i / (bins - 1)) * wedgeAngle - wedgeAngle / 2
        ctx.lineTo(Math.cos(angle) * minR, Math.sin(angle) * minR)
      }
      ctx.closePath()

      const hA = freqRangeIndex(0, bins)
      const hB = freqRangeIndex(Math.floor(bins * 0.45), bins)
      const hC = freqRangeIndex(Math.floor(bins * 0.92), bins)
      const grad = ctx.createLinearGradient(minR, 0, maxR, 0)
      grad.addColorStop(0, paletteColor(hA, 0.8))
      grad.addColorStop(0.5, paletteColor(hB, 0.75))
      grad.addColorStop(1, paletteColor(hC, 0.55))
      ctx.fillStyle = grad
      ctx.fill()

      ctx.beginPath()
      for (let i = 0; i < bins; i++) {
        const amp = normAmp(s.dataArray[i])
        const r = minR + amp * (maxR - minR)
        const angle = (i / (bins - 1)) * wedgeAngle - wedgeAngle / 2
        i === 0
          ? ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r)
          : ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r)
      }
      const edgeIndex = freqRangeIndex(Math.floor(bins * 0.75), bins)
      ctx.strokeStyle = paletteColor(edgeIndex, 0.85)
      ctx.lineWidth = 1.5
      ctx.shadowColor = paletteColor(edgeIndex, 0.92)
      ctx.shadowBlur = 12
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.restore()
    }

    const bassAmp = s.dataArray.slice(0, 6).reduce((a, b) => a + normAmp(b), 0) / 6
    const orbR = minR * (0.9 + bassAmp * cfg.orbGain)
    const orbGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, orbR)
    const orbBase = freqRangeIndex(2, bins)
    orbGrad.addColorStop(0, paletteColor(orbBase + 1, 1))
    orbGrad.addColorStop(0.4, paletteColor(orbBase + 4, 0.8))
    orbGrad.addColorStop(1, paletteColor(orbBase + 7, 0))
    ctx.fillStyle = orbGrad
    ctx.shadowColor = paletteColor(orbBase + 5, 0.9)
    ctx.shadowBlur = 24
    ctx.beginPath()
    ctx.arc(0, 0, orbR, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.restore()
  }, [])

  const drawLine = useCallback((ctx, W, H) => {
    const s = stateRef.current
    const cfg = controlsRef.current[MODES.LINE]
    const bins = s.dataArray.length
    const bassEnergy = rangeEnergy(s.dataArray, 0, Math.floor(bins * 0.12))
    const midEnergy = rangeEnergy(s.dataArray, Math.floor(bins * 0.12), Math.floor(bins * 0.55))
    const highEnergy = rangeEnergy(s.dataArray, Math.floor(bins * 0.5), bins)

    // leave a faint trail so the snake body lingers
    ctx.fillStyle = `rgba(0,0,0,${LINE_TRAIL_ALPHA})`
    ctx.fillRect(0, 0, W, H)

    // lazily initialize snake swarm when mode starts
    const snakeCount = Math.max(1, Math.round(cfg.snakeCount))
    if (s.snakeLines.length !== snakeCount) {
      s.snakeLines = Array.from({ length: snakeCount }, (_, i) => {
        const rangeIndex = Math.floor((i / Math.max(1, snakeCount - 1)) * (COLOR_RANGE_COUNT - 1))
        return createSnake(W, H, rangeIndex)
      })
    }

    const overallEnergy = rangeEnergy(s.dataArray, 0, bins)
    const transient = Math.max(0, overallEnergy - s.linePrevEnergy)
    s.linePrevEnergy = overallEnergy
    s.linePulse = Math.max(s.linePulse * 0.87, transient * cfg.transientBoost + bassEnergy * 0.45)

    const lowSlice = rangeEnergy(s.dataArray, 0, Math.floor(bins * 0.28))
    const highSlice = rangeEnergy(s.dataArray, Math.floor(bins * 0.65), bins)
    const turnBias = (highSlice - lowSlice) * (0.04 + overallEnergy * 0.14)

    for (let i = 0; i < s.snakeLines.length; i++) {
      const snake = s.snakeLines[i]
      const start = Math.floor((snake.rangeIndex / COLOR_RANGE_COUNT) * bins)
      const end = Math.max(start + 1, Math.floor(((snake.rangeIndex + 1) / COLOR_RANGE_COUNT) * bins))
      const snakeEnergy = rangeEnergy(s.dataArray, start, Math.min(bins, end))
      const randomKick =
        (Math.random() - 0.5) *
        cfg.randomTurn *
        (0.2 + snakeEnergy * 2.4 + overallEnergy * 1.2 + s.linePulse * 1.2)
      snake.turnVel = snake.turnVel * 0.92 + randomKick
      if (Math.random() < LINE_SHARP_TURN_CHANCE + s.linePulse * 0.04 + snakeEnergy * 0.08) {
        snake.turnVel += (Math.random() - 0.5) * (0.2 + s.linePulse * 1.2 + snakeEnergy * 1.4)
      }
      snake.head.angle += snake.turnVel + turnBias

      const speed =
        cfg.baseSpeed +
        snakeEnergy * 1.8 +
        bassEnergy * 0.8 +
        midEnergy * 0.3 +
        s.linePulse * 6.2 +
        (i / s.snakeLines.length) * 0.15
      snake.head.x += Math.cos(snake.head.angle) * speed
      snake.head.y += Math.sin(snake.head.angle) * speed

      if (snake.head.x < 0 || snake.head.x > W) {
        snake.head.x = Math.max(0, Math.min(W, snake.head.x))
        snake.head.angle = Math.PI - snake.head.angle
      }
      if (snake.head.y < 0 || snake.head.y > H) {
        snake.head.y = Math.max(0, Math.min(H, snake.head.y))
        snake.head.angle = -snake.head.angle
      }

      snake.points.unshift({ x: snake.head.x, y: snake.head.y })
      const lenWeight = Math.min(1, snakeEnergy * 0.6 + bassEnergy * 0.25 + s.linePulse * 0.25)
      const maxLen = Math.max(LINE_SNAKE_MIN_POINTS + 8, Math.round(cfg.maxLength))
      const targetLen = Math.round(LINE_SNAKE_MIN_POINTS + (maxLen - LINE_SNAKE_MIN_POINTS) * lenWeight)
      if (snake.points.length > targetLen) snake.points.length = targetLen

      const hueA = snake.rangeIndex
      const hueB = snake.rangeIndex + 2
      const hueC = snake.rangeIndex + 4
      const grad = ctx.createLinearGradient(0, 0, W, H)
      grad.addColorStop(0, paletteColor(hueA, 0.92))
      grad.addColorStop(0.5, paletteColor(hueB, 0.92))
      grad.addColorStop(1, paletteColor(hueC, 0.92))

      ctx.beginPath()
      for (let j = 0; j < snake.points.length; j++) {
        const p = snake.points[j]
        j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
      }

      ctx.strokeStyle = grad
      ctx.lineWidth = LINE_BASE_WIDTH + bassEnergy * 3.2 + (i / s.snakeLines.length) * 0.8
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = paletteColor(hueB, 0.98)
      ctx.shadowBlur = 10 + bassEnergy * 20
      ctx.stroke()

      ctx.shadowBlur = 0
      ctx.strokeStyle = paletteColor(hueB + 1, 0.5)
      ctx.lineWidth = 0.8 + bassEnergy * 0.8
      ctx.stroke()
    }

  }, [])

  const draw = useCallback(() => {
    const s = stateRef.current
    if (!s.running || !s.analyser) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height

    s.analyser.getByteFrequencyData(s.dataArray)
    s.hueShift = (s.hueShift + HUE_SPEED) % 360
    s.time += 1

    if (s.mode === MODES.CIRCULAR) {
      drawCircular(ctx, W, H)
    } else if (s.mode === MODES.LINE) {
      drawLine(ctx, W, H)
    } else {
      drawShapes(ctx, W, H)
    }

    s.animId = requestAnimationFrame(draw)
  }, [drawCircular, drawLine, drawShapes])

  // ─── start / stop ──────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const audioCtx = new AudioContext()
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = FFT_SIZE
      analyser.smoothingTimeConstant = SMOOTHING
      const source    = audioCtx.createMediaStreamSource(stream)
      source.connect(analyser)
      // intentionally NOT connected to destination — avoids feedback
      analyser.minDecibels = ANALYSER_MIN_DB
      analyser.maxDecibels = ANALYSER_MAX_DB
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      stateRef.current = {
        audioCtx,
        analyser,
        source,
        dataArray,
        animId: null,
        running: true,
        hueShift: 0,
        particles: [],
        prevBass: 0,
        bassPulse: 0,
        time: 0,
        prevBandEnergy: Array(BANDS.length).fill(0),
        bandCooldowns: Array(BANDS.length).fill(0),
        mode,
        snakeLines: [],
        linePrevEnergy: 0,
        linePulse: 0,
      }
      setStatus('running')
      requestAnimationFrame(draw)
    } catch {
      setStatus('denied')
    }
  }, [draw, mode])

  const stop = useCallback(() => {
    const { audioCtx, source, animId } = stateRef.current
    if (animId) cancelAnimationFrame(animId)
    source?.disconnect()
    audioCtx?.close()
    stateRef.current.running = false
    setStatus('idle')
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  // ─── cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => stop(), [stop])

  const activeMode = status === 'running' ? stateRef.current.mode : mode
  const hideUi = isFullscreen
  const activeKnobs = activeMode === MODES.SHAPES
    ? [
      { key: 'spawnThreshold', label: 'Spawn', min: 0.08, max: 0.6, step: 0.01 },
      { key: 'motionGain', label: 'Motion', min: 0.2, max: 2.4, step: 0.01 },
      { key: 'strokeGain', label: 'Stroke', min: 0.4, max: 2.4, step: 0.01 },
    ]
    : activeMode === MODES.CIRCULAR
      ? [
        { key: 'segments', label: 'Segments', min: 4, max: 18, step: 1 },
        { key: 'trail', label: 'Trail', min: 0.02, max: 0.4, step: 0.01 },
        { key: 'spin', label: 'Spin', min: 0, max: 0.01, step: 0.0001 },
        { key: 'orbGain', label: 'Orb', min: 1, max: 7, step: 0.1 },
      ]
      : [
        { key: 'snakeCount', label: 'Count', min: 1, max: 40, step: 1 },
        { key: 'baseSpeed', label: 'Speed', min: 0.01, max: 2.2, step: 0.01 },
        { key: 'randomTurn', label: 'Turn', min: 0.001, max: 0.09, step: 0.001 },
        { key: 'transientBoost', label: 'Pulse', min: 0.4, max: 12, step: 0.1 },
        { key: 'maxLength', label: 'Length', min: 60, max: 500, step: 1 },
      ]

  // ─── render ────────────────────────────────────────────────────────────────
  return (
    <div ref={rootRef} style={{ width: '100vw', height: '100vh', position: 'relative', background: '#000' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', position: 'absolute', inset: 0 }}
      />

      {/* Center Logo - only during animation */}
      {status === 'running' && (
        <img
          src={LogoImg}
          alt="Logo"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            maxWidth: '200px',
            maxHeight: '200px',
            zIndex: 10,
            pointerEvents: 'none',
            animation: 'logoEffervescent 4.5s ease-in-out infinite',
          }}
        />
      )}

      {!isFullscreen && (
        <button
          type="button"
          style={fullscreenBtnStyle}
          onClick={toggleFullscreen}
          title="Enter fullscreen"
        >
          Fullscreen
        </button>
      )}

      {!hideUi && status !== 'running' && (
        <div style={overlayStyle}>
          {status === 'denied' ? (
            <>
              <p style={messageStyle}>Microphone access denied.</p>
              <p style={subStyle}>Allow microphone permissions and refresh the page.</p>
            </>
          ) : (
            <>
              <p style={messageStyle}>Audio Visualizer</p>
              <div style={modePickerStyle}>
                <button
                  style={mode === MODES.SHAPES ? activeModeBtnStyle : modeBtnStyle}
                  onClick={() => setMode(MODES.SHAPES)}
                  type="button"
                >
                  Falling Shapes
                </button>
                <button
                  style={mode === MODES.CIRCULAR ? activeModeBtnStyle : modeBtnStyle}
                  onClick={() => setMode(MODES.CIRCULAR)}
                  type="button"
                >
                  Circular Kaleidoscope
                </button>
                <button
                  style={mode === MODES.LINE ? activeModeBtnStyle : modeBtnStyle}
                  onClick={() => setMode(MODES.LINE)}
                  type="button"
                >
                  Color Line
                </button>
              </div>
              <button style={btnStyle} onClick={start}>
                Start Visualizer
              </button>
            </>
          )}
        </div>
      )}

      {!hideUi && status === 'running' && (
        <button style={stopBtnStyle} onClick={stop} title="Stop visualizer">
          ■
        </button>
      )}

      {!hideUi && controlsVisible ? (
        <div style={controlPanelStyle}>
          <div style={panelHeaderStyle}>
            <div style={panelTitleStyle}>{activeMode === MODES.SHAPES ? 'Shapes' : activeMode === MODES.CIRCULAR ? 'Circular' : 'Line'} Controls</div>
            <div style={panelActionsStyle}>
              <button
                type="button"
                style={panelBtnStyle}
                onClick={() => resetControlsForMode(activeMode)}
                title="Reset this mode's knobs"
              >
                Reset
              </button>
              <button
                type="button"
                style={panelBtnStyle}
                onClick={() => setControlsVisible(false)}
                title="Hide controls"
              >
                Hide
              </button>
            </div>
          </div>

          <div style={knobGridStyle}>
            {activeKnobs.map(knob => (
              <Knob
                key={knob.key}
                label={knob.label}
                min={knob.min}
                max={knob.max}
                step={knob.step}
                value={controls[activeMode][knob.key]}
                onChange={(next) => updateControl(activeMode, knob.key, next)}
              />
            ))}
          </div>
        </div>
      ) : !hideUi ? (
        <button
          type="button"
          style={showControlsBtnStyle}
          onClick={() => setControlsVisible(true)}
          title="Show controls"
        >
          Show Controls
        </button>
      ) : null}
    </div>
  )
}

// ─── inline styles ──────────────────────────────────────────────────────────

const overlayStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '1.5rem',
}

const messageStyle = {
  color: '#ffe7d1',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 'clamp(1.5rem, 4vw, 3rem)',
  fontWeight: 700,
  letterSpacing: '0.05em',
  textShadow: '0 0 24px rgba(255, 146, 56, 0.85)',
}

const subStyle = {
  color: '#c9b3a1',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 'clamp(0.9rem, 2vw, 1.2rem)',
}

const btnStyle = {
  padding: '0.75rem 2.5rem',
  fontSize: 'clamp(1rem, 2vw, 1.3rem)',
  fontFamily: 'system-ui, sans-serif',
  fontWeight: 600,
  background: 'rgba(120, 36, 0, 0.22)',
  color: '#ffd2a3',
  border: '2px solid #ff9740',
  borderRadius: '6px',
  cursor: 'pointer',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  boxShadow: '0 0 20px rgba(255, 128, 36, 0.45)',
  transition: 'box-shadow 0.2s',
}

const modePickerStyle = {
  display: 'flex',
  gap: '0.6rem',
  flexWrap: 'wrap',
  justifyContent: 'center',
}

const modeBtnStyle = {
  padding: '0.5rem 0.9rem',
  fontSize: '0.9rem',
  fontFamily: 'system-ui, sans-serif',
  fontWeight: 600,
  color: '#f2c8a0',
  background: 'rgba(120, 36, 0, 0.16)',
  border: '1px solid rgba(255, 151, 64, 0.45)',
  borderRadius: '999px',
  cursor: 'pointer',
}

const activeModeBtnStyle = {
  ...modeBtnStyle,
  color: '#fff2de',
  background: 'rgba(255, 126, 39, 0.28)',
  boxShadow: '0 0 16px rgba(255, 136, 46, 0.45)',
}

const controlPanelStyle = {
  position: 'absolute',
  left: '1rem',
  bottom: '1rem',
  width: 'min(92vw, 540px)',
  background: 'rgba(7, 14, 23, 0.72)',
  border: '1px solid rgba(118, 200, 147, 0.35)',
  borderRadius: '12px',
  padding: '0.7rem 0.8rem 0.8rem',
  backdropFilter: 'blur(4px)',
}

const panelTitleStyle = {
  fontFamily: 'system-ui, sans-serif',
  fontWeight: 700,
  color: 'rgba(217, 237, 146, 0.95)',
  fontSize: '0.82rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

const panelHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  marginBottom: '0.55rem',
}

const panelActionsStyle = {
  display: 'flex',
  gap: '0.4rem',
}

const panelBtnStyle = {
  padding: '0.24rem 0.6rem',
  borderRadius: '999px',
  border: '1px solid rgba(255, 151, 64, 0.45)',
  background: 'rgba(120, 36, 0, 0.16)',
  color: '#f2c8a0',
  fontFamily: 'system-ui, sans-serif',
  fontSize: '0.68rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
}

const knobGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))',
  gap: '0.4rem',
}

const knobWrapStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  userSelect: 'none',
}

const knobStyle = {
  width: '56px',
  height: '56px',
  borderRadius: '50%',
  background: 'radial-gradient(circle at 30% 30%, rgba(217, 237, 146, 0.35), rgba(24, 78, 119, 0.9))',
  border: '1px solid rgba(217, 237, 146, 0.45)',
  boxShadow: 'inset 0 -7px 12px rgba(0,0,0,0.35), 0 0 8px rgba(52, 160, 164, 0.35)',
  position: 'relative',
  touchAction: 'none',
  cursor: 'ns-resize',
}

const knobNeedleStyle = {
  position: 'absolute',
  left: '50%',
  top: '6px',
  width: '2px',
  height: '20px',
  background: 'rgba(217, 237, 146, 0.95)',
  borderRadius: '999px',
  transformOrigin: '50% 22px',
}

const knobCenterStyle = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  transform: 'translate(-50%, -50%)',
  background: 'rgba(181, 228, 140, 0.95)',
}

const knobLabelStyle = {
  marginTop: '0.3rem',
  fontFamily: 'system-ui, sans-serif',
  color: 'rgba(181, 228, 140, 0.95)',
  fontSize: '0.68rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const knobValueStyle = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: 'rgba(217, 237, 146, 0.85)',
  fontSize: '0.7rem',
}

const showControlsBtnStyle = {
  position: 'absolute',
  left: '1rem',
  bottom: '1rem',
  padding: '0.5rem 0.9rem',
  borderRadius: '999px',
  border: '1px solid rgba(255, 151, 64, 0.45)',
  background: 'rgba(120, 36, 0, 0.16)',
  color: '#f2c8a0',
  fontFamily: 'system-ui, sans-serif',
  fontSize: '0.8rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
}

const fullscreenBtnStyle = {
  position: 'absolute',
  top: '1rem',
  right: '1rem',
  padding: '0.45rem 0.75rem',
  borderRadius: '8px',
  border: '1px solid rgba(118, 200, 147, 0.55)',
  background: 'rgba(7, 14, 23, 0.78)',
  color: 'rgba(217, 237, 146, 0.96)',
  fontFamily: 'system-ui, sans-serif',
  fontSize: '0.78rem',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  cursor: 'pointer',
}

const stopBtnStyle = {
  position: 'absolute',
  bottom: '1rem',
  right: '1rem',
  background: 'rgba(88, 22, 0, 0.25)',
  color: 'rgba(255, 205, 158, 0.72)',
  border: '1px solid rgba(255, 153, 71, 0.35)',
  borderRadius: '4px',
  padding: '0.3rem 0.6rem',
  cursor: 'pointer',
  fontSize: '1.1rem',
  fontFamily: 'monospace',
  lineHeight: 1,
}
