import { useEffect, useRef, useState, useCallback } from 'react'

// ─── tuning constants ────────────────────────────────────────────────────────
const FFT_SIZE     = 512   // → 256 frequency bins
const SMOOTHING    = 0.85
const N_SEGMENTS   = 8     // stamped × 2 = 16-fold rotational symmetry
const TRAIL_ALPHA  = 0.10  // lower = longer ghost trails
const HUE_SPEED    = 0.5   // degrees of colour rotation per frame
const SPIN_SPEED   = 0.0008 // radians of overall rotation per hue degree
const WARM_HUE_START = 12
const WARM_HUE_SPAN = 64

function warmHue(value) {
  return WARM_HUE_START + ((value % 360) / 360) * WARM_HUE_SPAN
}

export default function Visualizer() {
  const canvasRef = useRef(null)
  const stateRef  = useRef({
    audioCtx: null, analyser: null, source: null,
    dataArray: null, animId: null, running: false, hueShift: 0,
  })
  const [status, setStatus] = useState('idle')

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

  // ─── animation loop ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const s = stateRef.current
    if (!s.running || !s.analyser) return

    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height
    const cx = W / 2
    const cy = H / 2

    s.analyser.getByteFrequencyData(s.dataArray)
    s.hueShift = (s.hueShift + HUE_SPEED) % 360

    const BINS       = s.dataArray.length          // 256
    const totalSegs  = N_SEGMENTS * 2              // 16
    const wedgeAngle = (Math.PI * 2) / totalSegs   // ~22.5°
    const maxR       = Math.min(cx, cy) * 0.92
    const minR       = maxR * 0.06
    const spin       = s.hueShift * SPIN_SPEED     // slow overall rotation

    // ── cascading trail ──────────────────────────────────────────────────────
    ctx.fillStyle = `rgba(0,0,0,${TRAIL_ALPHA})`
    ctx.fillRect(0, 0, W, H)

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(spin)

    for (let seg = 0; seg < totalSegs; seg++) {
      ctx.save()
      ctx.rotate((Math.PI * 2 / totalSegs) * seg)
      if (seg % 2 === 1) ctx.scale(1, -1)   // mirror every other wedge

      // ── filled frequency wedge ────────────────────────────────────────────
      // outer edge follows amplitude, inner edge is flat at minR
      ctx.beginPath()
      for (let i = 0; i < BINS; i++) {
        const amp   = s.dataArray[i] / 255
        const r     = minR + amp * (maxR - minR)
        const angle = (i / (BINS - 1)) * wedgeAngle - wedgeAngle / 2
        const x = Math.cos(angle) * r
        const y = Math.sin(angle) * r
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      for (let i = BINS - 1; i >= 0; i--) {
        const angle = (i / (BINS - 1)) * wedgeAngle - wedgeAngle / 2
        ctx.lineTo(Math.cos(angle) * minR, Math.sin(angle) * minR)
      }
      ctx.closePath()

      const hA = warmHue(s.hueShift)
      const hB = warmHue(s.hueShift + 60 + seg * (300 / totalSegs))
      const hC = warmHue(s.hueShift + 150 + seg * (300 / totalSegs))
      const grad = ctx.createLinearGradient(minR, 0, maxR, 0)
      grad.addColorStop(0,   `hsla(${hA},100%,55%,0.80)`)
      grad.addColorStop(0.5, `hsla(${hB},100%,65%,0.75)`)
      grad.addColorStop(1,   `hsla(${hC},100%,50%,0.55)`)
      ctx.fillStyle = grad
      ctx.fill()

      // ── glowing spectrum-line along outer edge ────────────────────────────
      ctx.beginPath()
      for (let i = 0; i < BINS; i++) {
        const amp   = s.dataArray[i] / 255
        const r     = minR + amp * (maxR - minR)
        const angle = (i / (BINS - 1)) * wedgeAngle - wedgeAngle / 2
        i === 0
          ? ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r)
          : ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r)
      }
      const edgeHue = warmHue(s.hueShift + 190)
      ctx.strokeStyle = `hsla(${edgeHue},100%,92%,0.85)`
      ctx.lineWidth   = 1.5
      ctx.shadowColor = `hsl(${edgeHue},100%,75%)`
      ctx.shadowBlur  = 12
      ctx.stroke()
      ctx.shadowBlur  = 0

      ctx.restore()
    }

    // ── pulsing center orb ───────────────────────────────────────────────────
    const bassAmp = s.dataArray.slice(0, 6).reduce((a, b) => a + b, 0) / 6 / 255
    const orbR    = minR * (0.9 + bassAmp * 3)
    const orbGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, orbR)
    orbGrad.addColorStop(0, `hsla(${warmHue(s.hueShift)},100%,98%,1)`)
    orbGrad.addColorStop(0.4, `hsla(${warmHue(s.hueShift + 60)},100%,72%,0.8)`)
    orbGrad.addColorStop(1, `hsla(${warmHue(s.hueShift)},100%,40%,0)`)
    ctx.fillStyle  = orbGrad
    ctx.shadowColor = `hsl(${warmHue(s.hueShift)},100%,70%)`
    ctx.shadowBlur  = 24
    ctx.beginPath()
    ctx.arc(0, 0, orbR, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0

    ctx.restore()

    s.animId = requestAnimationFrame(draw)
  }, [])

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
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      stateRef.current = { audioCtx, analyser, source, dataArray, animId: null, running: true, hueShift: 0 }
      setStatus('running')
      requestAnimationFrame(draw)
    } catch {
      setStatus('denied')
    }
  }, [draw])

  const stop = useCallback(() => {
    const { audioCtx, source, animId } = stateRef.current
    if (animId) cancelAnimationFrame(animId)
    source?.disconnect()
    audioCtx?.close()
    stateRef.current.running = false
    setStatus('idle')
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  // ─── cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => stop(), [stop])

  // ─── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#000' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', position: 'absolute', inset: 0 }}
      />

      {status !== 'running' && (
        <div style={overlayStyle}>
          {status === 'denied' ? (
            <>
              <p style={messageStyle}>Microphone access denied.</p>
              <p style={subStyle}>Allow microphone permissions and refresh the page.</p>
            </>
          ) : (
            <>
              <p style={messageStyle}>Audio Visualizer</p>
              <button style={btnStyle} onClick={start}>
                Start Visualizer
              </button>
            </>
          )}
        </div>
      )}

      {status === 'running' && (
        <button style={stopBtnStyle} onClick={stop} title="Stop visualizer">
          ■
        </button>
      )}
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
