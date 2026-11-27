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

test('summoned allies ignore the summoner and use guard and retaliation toward hostile attackers', () => {
  const summon = unit('starter-dog', 'ally', -9, -3)
  const summoner = unit('hero', 'ally', -8.5, -3)
  const foe = unit('rival', 'enemy', -7, -3)
  const shooter = unit('wild', 'wild', -5, -3)
  const fight = new Map([summon, summoner, foe, shooter].map(item => [item.id, item]))
  const focus = new Vigilance('dog', () => .25)
  summon.pivot.visible = false
  assert.equal(focus.update(summon, fight, 0), null)
  summon.pivot.visible = true
  assert.equal(focus.update(summon, fight, .16).id, foe.id)
  focus.attacked(summon, summoner, .24)
  assert.equal(focus.update(summon, fight, .3).mode, 'guard')
  focus.attacked(summon, shooter, .4)
  const defense = focus.update(summon, fight, .5)
  assert.equal(defense.id, shooter.id)
  assert.equal(defense.mode, 'provoked')
  assert.equal(defense.scan, 0)
  assert.equal(defense.display, true)
})

test('a moving hostile breaks a settled guard without requiring a return to the main target', () => {
  const actor = unit('actor', 'ally', -8, -1)
  const front = unit('front', 'wild', -6.5, -1)
  const rear = unit('rear', 'enemy', -13.2, -1)
  const flank = unit('flank', 'enemy', -8, 3.1)
  const friendly = unit('friendly', 'ally', -8, -.5)
  const fight = new Map([actor, front, rear, flank, friendly].map(item => [item.id, item]))
  const focus = new Vigilance('dog', () => .42)
  assert.equal(focus.update(actor, fight, 0).id, front.id)
  const frontTicket = focus.state.ticket
  focus.update(actor, fight, .3)
  rear.pivot.position.x = -10
  const rearward = focus.update(actor, fight, .39)
  assert.equal(rearward.id, rear.id)
  assert.equal(rearward.step, true)
  assert.equal(rearward.fast, true)
  assert.equal(rearward.reaction, 'brace')
  assert.notEqual(rearward.ticket, frontTicket)
  flank.pivot.position.z = 1.5
  assert.equal(focus.update(actor, fight, .81).id, flank.id)
})

test('static threats do not force a primary-secondary rhythm and both attackers remain in memory', () => {
  const actor = unit('actor', 'wild', -6, -1)
  const front = unit('front', 'ally', -4, -1)
  const rear = unit('rear', 'ally', -11.8, -1)
  const fight = new Map([actor, front, rear].map(item => [item.id, item]))
  let seed = 921
  const focus = new Vigilance('dog', () => (seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 2 ** 32)
  const changes = []
  let lastId
  let glanced
  for (let t = 0; t < 17; t += .11) {
    const state = focus.update(actor, fight, t)
    if (state.id !== lastId) {
      changes.push(t)
      lastId = state.id
    }
    if (state.id === rear.id) glanced ??= state.step
  }
  assert.equal(glanced, false)
  const timing = changes.slice(1).map((t, i) => Math.round((t - changes[i]) * 10))
  assert.ok(new Set(timing).size >= 2)
  focus.attacked(actor, rear, 17)
  assert.equal(focus.update(actor, fight, 17.01).id, 'rear')
  focus.attacked(actor, front, 17.3)
  assert.equal(focus.update(actor, fight, 17.31).id, 'front')
  focus.consumeDisplay('front')
  assert.equal(focus.attacks.get('rear').display, true)
  rear.dead = true
  assert.equal(focus.update(actor, fight, 17.42).multi, false)
})
