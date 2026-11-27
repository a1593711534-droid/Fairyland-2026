import assert from 'node:assert/strict'
import test from 'node:test'
import { attachTouchControls } from '../src/render/touch-controls.js'

function setup(aiming = false) {
  const canvas = new EventTarget()
  const calls = []
  canvas.setPointerCapture = () => {}
  const record = type => (...args) => calls.push([type, ...args])
  const control = attachTouchControls(canvas, {
    aims: () => aiming, tap: record('tap'), preview: record('preview'), pan: record('pan'),
    clear: record('clear'), pinch: record('pinch'),
  })
  const pointer = (type, clientX, clientY, pointerId = 1, pointerType = 'touch') => {
    canvas.dispatchEvent(Object.assign(new Event('pointer' + type), { clientX, clientY, pointerId, pointerType }))
  }
  return { control, calls, pointer }
}

test('touch tap commits once, motion pans, and mouse input remains independent', () => {
  const { control, calls, pointer } = setup()
  pointer('down', 100, 100)
  pointer('up', 103, 104)
  assert.deepEqual(calls.map(([type]) => type), ['preview', 'clear', 'tap'])
  assert.equal(control.synthetic({}), true)
  pointer('down', 100, 100, 3, 'mouse')
  assert.equal(control.synthetic({ pointerType: 'mouse' }), false)
  pointer('down', 100, 100)
  pointer('move', 114, 100)
  pointer('up', 114, 100)
  assert.equal(calls.filter(([type]) => type === 'pan').length, 1)
  assert.equal(calls.filter(([type]) => type === 'tap').length, 1)
})

test('pinching while aiming or losing pointer capture never commits a command', () => {
  const { calls, pointer, control } = setup(true)
  pointer('down', 100, 100)
  pointer('move', 135, 110)
  pointer('down', 170, 100, 2)
  pointer('move', 204, 96, 2)
  pointer('up', 204, 96, 2)
  pointer('move', 145, 110)
  pointer('up', 145, 110)
  assert.equal(calls.some(([type]) => type === 'pinch'), true)
  assert.equal(calls.some(([type]) => type === 'tap' || type === 'pan'), false)
  pointer('down', 100, 100)
  pointer('cancel', 100, 100)
  pointer('down', 105, 105)
  control.reset()
  pointer('up', 105, 105)
  assert.equal(calls.some(([type]) => type === 'tap'), false)
  pointer('down', 100, 100)
  pointer('move', 144, 136)
  pointer('up', 144, 136)
  assert.equal(calls.find(([type]) => type === 'tap')?.[1].clientX, 144)
})
