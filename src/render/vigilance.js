import { areOpponents } from '../game/combat.js'
import { distance, lineOfSight } from '../game/geometry.js'
import { angularDifference, bearing } from './attention.js'

const ranges = { turtle: 5.4, dino: 6.6, cat: 6.8, bird: 7.3, mouse: 5.9, dog: 7.0 }
const opposite = (unit, other) => other && unit.id !== other.id && !other.dead && !other.ghost &&
  other.pivot.visible && Boolean(unit.team && other.team) && areOpponents(unit, other)

export class Vigilance {
  constructor(species, sample) {
    this.kind = species.replace(/-evolved$/, '')
    this.range = ranges[this.kind]
    this.sample = sample
    this.state = null
    this.attacks = new Map()
    this.checked = new Map()
  }

  attacked(unit, attacker, now) {
    if (!this.range || !opposite(unit, attacker)) return
    const prior = this.attacks.get(attacker.id)
    this.attacks.set(attacker.id, {
      point: attacker.pivot.position.clone(), until: now + 8.4, hitAt: now,
      display: prior?.display || !prior || now - prior.hitAt >= 1.7,
    })
    if (this.state?.glance) this.state.glance = null
  }

  update(unit, units, now) {
    if (!this.range || unit.dead || !unit.pivot.visible) return null
    const from = unit.pivot.position
    const old = this.state
    const threats = []
    for (const other of units.values()) {
      if (!opposite(unit, other)) {
        this.attacks.delete(other.id)
        this.checked.delete(other.id)
        continue
      }
      const target = other.pivot.position
      const gap = distance(from, target)
      let attack = this.attacks.get(other.id)
      if (attack && now >= attack.until) {
        this.attacks.delete(other.id)
        attack = null
      }
      const hold = old?.mode === 'guard' && old.primary === other.id
      if (!attack && gap > this.range + (hold ? .9 : 0)) continue
      const visible = lineOfSight(from, target)
      if (attack && visible) {
        attack.point.copy(target)
        if (gap < this.range + 1.8) attack.until = Math.max(attack.until, now + 3.1)
      }
      if (attack || visible || hold && now < old.lastSeen + .85) {
        threats.push({ id: other.id, gap, attack, visible, point: attack?.point ?? (visible ? target : old.primaryPoint) })
      }
    }
    for (const id of this.attacks.keys()) if (!units.has(id)) this.attacks.delete(id)
    for (const id of this.checked.keys()) if (!threats.some(other => other.id === id)) this.checked.delete(id)
    if (!threats.length) {
      this.state = null
      return null
    }
    const attackers = threats.filter(other => other.attack).sort((a,b) => b.attack.hitAt - a.attack.hitAt || a.gap - b.gap)
    const nearest = threats.reduce((a,b) => a.gap <= b.gap ? a : b)
    const retained = old?.mode === 'guard' && threats.find(other => other.id === old.primary)
    const main = attackers[0] ?? (retained && nearest.gap >= retained.gap * .71 ? retained : nearest)
    const mode = main.attack ? 'provoked' : 'guard'
    const direction = bearing(from, main.point)
    const secondary = threats.filter(other => other.id !== main.id && (other.visible || other.attack) &&
      Math.abs(angularDifference(direction, bearing(from, other.point))) > .66)
    const multi = secondary.length > 0
    const state = old?.mode === mode && old.primary === main.id ? old : {
      mode, primary: main.id, primaryPoint: main.point.clone(), lastSeen: now,
      scan: 0, scanUntil: 0, nextScan: now + 1.7 + this.sample() * 2, angle: 0,
      nextCheck: now + (mode === 'provoked' ? .94 : .63) + this.sample() * .25, glance: null,
    }
    state.primaryPoint.copy(main.point)
    if (main.visible) state.lastSeen = now
    let focus = main
    if (multi) {
      const ongoing = state.glance && secondary.find(other => other.id === state.glance.id)
      if (ongoing && now < state.glance.until) {
        focus = ongoing
      } else {
        state.glance = null
        if (now >= state.nextCheck) {
          const choices = secondary.map(other => {
            const last = this.checked.get(other.id)
            const time = last === undefined ? 4 : Math.min(4, now - last)
            return { other, priority: time * 1.7 + (other.attack ? 3.4 : 0) + (this.range - other.gap) * .58 }
          })
          focus = choices.reduce((a,b) => a.priority >= b.priority ? a : b).other
          const separation = Math.abs(angularDifference(direction, bearing(from, focus.point)))
          const rear = separation > 2.05
          const step = separation > 1.07 && (Boolean(focus.attack) || focus.gap <= this.range * (rear ? .72 : .52))
          const duration = (step ? (rear ? 1.88 : 1.2) : .64) * (this.kind === 'turtle' ? 1.25 : 1)
          this.checked.set(focus.id, now)
          state.glance = { id: focus.id, step, until: now + duration }
          state.nextCheck = state.glance.until + (mode === 'provoked' ? 1.04 : .69) + this.sample() * .36
        }
      }
      state.scan = 0
    } else {
      state.glance = null
      if (mode === 'guard' && now >= state.nextScan) {
        state.scanUntil = now + .36 + this.sample() * .32
        state.nextScan = state.scanUntil + 2.05 + this.sample() * 2.75
        state.angle = (this.sample() < .5 ? -1 : 1) * (.31 + this.sample() * .28)
      }
      state.scan = mode === 'guard' && now < state.scanUntil ? state.angle : 0
    }
    const checking = focus !== main
    Object.assign(state, {
      id: focus.id, point: focus.point, multi, checking,
      step: !checking || state.glance.step, display: Boolean(focus.attack?.display),
    })
    this.state = state
    return state
  }

  consumeDisplay(id = this.state?.id) {
    const attack = this.attacks.get(id)
    if (attack) attack.display = false
  }
}
