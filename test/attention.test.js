import assert from 'node:assert/strict'
import test from 'node:test'
import { idleSequence } from '../src/render/idle-sequence.js'
import { advanceBearing, angularDifference, initialBearing, observedPoint, turnProgress } from '../src/render/attention.js'

test('encounter facing comes from visible opponents and position', () => {
  const hero = { id: 'hero', hp: 100, team: 'ally', pos: { x: -10, z: 0 } }
  const dog = { id: 'dog', hp: 50, team: 'wild', pos: { x: -6, z: 0 } }
  const bird = { id: 'bird', hp: 50, team: 'wild', pos: { x: -10, z: 4 } }
  assert.equal(initialBearing(dog, [hero, dog, bird]), -Math.PI / 2)
  assert.equal(Math.abs(initialBearing(bird, [hero, dog, bird])), Math.PI)
  assert.equal(observedPoint({ pos: hero.pos, team: 'ally' }, [{ pos: { x: 0, z: .8 }, team: 'enemy' }],
    .2), null)
})

test('turns use a short arc with time for each foot to settle', () => {
  assert.ok(Math.abs(angularDifference(3.12, -3.12)) < .05)
  assert.ok(advanceBearing(3.12, -3.12, .01) > 3.12)
  assert.equal(turnProgress(.12), 0)
  assert.equal(turnProgress(.50), .48)
  assert.equal(turnProgress(.94), 1)
})

test('idle reactions vary by species and cause without an immediate repeated rest pose', () => {
  const dog = idleSequence('dog', 'one', false, 120)
  const turtle = idleSequence('turtle', 'two', false, 120)
  assert.ok(turtle.quick > dog.quick)
  assert.equal(dog.next('alert').clip, 'idle_listen')
  assert.equal(turtle.next('alert').clip, 'idle_retreat')
  let previous
  for (let i = 0; i < 12; i++) {
    const { clip } = dog.next()
    assert.notEqual(clip, previous)
    previous = clip
  }
})
