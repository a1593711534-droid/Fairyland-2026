import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Vector3 } from 'three'
import { Vigilance } from '../src/render/vigilance.js'

const unit = (id, team, x, z) => ({ id, team, pivot: { visible: true, position: new Vector3(x, 0, z) } })

test('a nearby opponent holds attention while the head briefly scans', () => {
  const actor = unit('cat', 'wild', -9, -3)
  const enemy = unit('hero', 'ally', -7, -3)
  const companion = unit('bird', 'practice', -8.5, -3)
  const fight = new Map([actor, enemy, companion].map(item => [item.id, item]))
  const vigilance = new Vigilance('cat', () => .5)
  const initial = vigilance.update(actor, fight, 0)
  assert.equal(initial.id, enemy.id)
  assert.equal(initial.mode, 'guard')
  assert.equal(initial.scan, 0)
  const glance = vigilance.update(actor, fight, 2.8)
  assert.equal(glance.id, enemy.id)
  assert.ok(glance.scan > .38)
  assert.equal(vigilance.update(actor, fight, 3.35).scan, 0)
  enemy.pivot.position.x = 10
  assert.equal(vigilance.update(actor, fight, 4), null)
})

test('a hit overrides a closer threat and tracks its actual attacker without scanning', () => {
  const target = unit('turtle', 'wild', -9, -3)
  const closer = unit('closer', 'ally', -8, -3)
  const attacker = unit('attacker', 'ally', -5, -3)
  const fight = new Map([target, closer, attacker].map(item => [item.id, item]))
  const vigilance = new Vigilance('turtle', () => .5)
  assert.equal(vigilance.update(target, fight, 0).id, closer.id)
  vigilance.attacked(target, attacker, .2)
  let locked = vigilance.update(target, fight, .3)
  assert.equal(locked.mode, 'provoked')
  assert.equal(locked.id, attacker.id)
  assert.ok(locked.display)
  vigilance.consumeDisplay()
  vigilance.attacked(target, attacker, .7)
  assert.equal(vigilance.update(target, fight, .9).display, false)
  attacker.pivot.position.z = -2.2
  for (let time = 1; time < 18; time++) {
    locked = vigilance.update(target, fight, time)
    assert.equal(locked.id, attacker.id)
    assert.equal(locked.scan, 0)
  }
  assert.equal(locked.point.z, -2.2)
  attacker.dead = true
  assert.equal(vigilance.update(target, fight, 18).id, closer.id)
})
