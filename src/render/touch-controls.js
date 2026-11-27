const point = event => ({ x: event.clientX, y: event.clientY })
const position = ({ x, y }) => ({ clientX: x, clientY: y })
const gap = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)

function pair(touches) {
  const [a, b] = touches.values()
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: gap(a, b),
    angle: Math.atan2(b.y - a.y, b.x - a.x) }
}

const angleBetween = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

export function attachTouchControls(canvas, controls) {
  const touches = new Map()
  let gesture = null
  let lastTouch = -Infinity

  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') {
      lastTouch = -Infinity
      return
    }
    lastTouch = performance.now()
    const start = point(event)
    touches.set(event.pointerId, start)
    canvas.setPointerCapture(event.pointerId)
    if (touches.size === 1) {
      gesture = { mode: controls.aims() ? 'aim' : 'tap', start, previous: start }
      controls.preview(event)
    } else {
      gesture = { mode: 'pair', previous: pair(touches), turning: false }
      gesture.startAngle = gesture.previous.angle
      controls.clear()
    }
  })

  canvas.addEventListener('pointermove', event => {
    if (!touches.has(event.pointerId) || !gesture) return
    const next = point(event)
    touches.set(event.pointerId, next)
    if (gesture.mode === 'pair') {
      if (touches.size < 2) return
      const summary = pair(touches)
      const previous = gesture.previous
      gesture.turning ||= Math.abs(angleBetween(gesture.startAngle, summary.angle)) >= .22
      const turn = gesture.turning ? angleBetween(previous.angle, summary.angle) : 0
      controls.pinch(position(previous), position(summary),
        previous.spread >= 12 && summary.spread >= 12 ? previous.spread / summary.spread : 1, turn)
      gesture.previous = summary
    } else if (gesture.mode === 'aim') {
      controls.preview(event)
    } else if (gesture.mode === 'pan' || gap(gesture.start, next) >= 9) {
      if (gesture.mode !== 'pan') controls.clear()
      gesture.mode = 'pan'
      controls.pan(position(gesture.previous), event)
      gesture.previous = next
    }
  })

  function finish(event) {
    if (!touches.delete(event.pointerId)) return
    lastTouch = performance.now()
    if (touches.size) {
      if (touches.size >= 2) {
        gesture = { mode: 'pair', previous: pair(touches), turning: false }
        gesture.startAngle = gesture.previous.angle
      }
      return
    }
    const commit = event.type === 'pointerup' && (gesture?.mode === 'aim' ||
      (gesture?.mode === 'tap' && gap(gesture.start, point(event)) < 9))
    gesture = null
    controls.clear()
    if (commit) controls.tap(event)
  }

  canvas.addEventListener('pointerup', finish)
  canvas.addEventListener('pointercancel', finish)
  canvas.addEventListener('lostpointercapture', finish)

  return {
    reset() {
      touches.clear()
      gesture = null
    },
    synthetic: event => event.pointerType === 'touch' || performance.now() - lastTouch < 700,
  }
}
