import { areOpponents } from '../game/combat.js'
import { distance, lineOfSight } from '../game/geometry.js'
import { angularDifference, bearing } from './attention.js'

const ranges = { turtle: 5.4, dino: 6.6, cat: 6.8, bird: 7.3, mouse: 5.9, dog: 7.0 }
const tempo = { turtle: 1.48, dino: 1.14, cat: .91, bird: .73, mouse: .69, dog: 1 }
const opposite = (unit, other) => other && unit.id !== other.id && !other.dead && !other.ghost &&
  other.pivot.visible && Boolean(unit.team && other.team) && areOpponents(unit, other)

export class Vigilance {
  constructor(species, sample) {
    this.kind = species.replace(/-evolved$/, '')
    this.range = ranges[this.kind]
    this.sample = sample
    this.state = null
    this.attacks = new Map()
    this.observations = new Map()
    this.serial = 0
  }

  attacked(unit, attacker, now) {
    if (!this.range || !opposite(unit, attacker)) return
    const prior = this.attacks.get(attacker.id)
    this.attacks.set(attacker.id, {
      point: attacker.pivot.position.clone(), until: now + 8.4, hitAt: now,
      display: prior?.display || !prior || now - prior.hitAt >= 1.7,
    })
    if (this.state) this.state.hit = attacker.id
  }

  update(unit, units, now) {
    if (!this.range || unit.dead || !unit.pivot.visible) return null
    const from = unit.pivot.position
    const old = this.state
    const threats = []
    for (const other of units.values()) {
      if (!opposite(unit, other)) {
        this.attacks.delete(other.id)
        this.observations.delete(other.id)
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
    for (const id of this.observations.keys()) {
      if (!threats.some(other => other.id === id)) this.observations.delete(id)
    }
    if (!threats.length) {
      this.state = null
      return null
    }

    const attackers = threats.filter(other => other.attack).sort((a, b) => b.attack.hitAt - a.attack.hitAt || a.gap - b.gap)
    const nearest = threats.reduce((a, b) => a.gap <= b.gap ? a : b)
    const retained = old?.mode === 'guard' && threats.find(other => other.id === old.primary)
    const main = attackers[0] ?? (retained && nearest.gap >= retained.gap * .71 ? retained : nearest)
    const mode = main.attack ? 'provoked' : 'guard'
    const direction = bearing(from, main.point)
    const bearings = threats.map(other => bearing(from, other.point))
    const multi = bearings.some(yaw => Math.abs(angularDifference(direction, yaw)) > .66)
    const state = old?.mode === mode && old.primary === main.id ? old : {
      mode, primary: main.id, primaryPoint: main.point.clone(), lastSeen: now,
      next: now + (.45 + this.sample() ** 2 * 1.7) * tempo[this.kind],
      scan: 0, scanUntil: 0, nextScan: now + 1.7 + this.sample() * 2, angle: 0,
    }
    state.primaryPoint.copy(main.point)
    if (main.visible) state.lastSeen = now
    for (const other of threats) {
      const prior = this.observations.get(other.id)
      if (!prior) {
        this.observations.set(other.id, { point: other.point.clone(), gap: other.gap, cue: now, seen: -Infinity })
      } else {
        const moved = distance(other.point, prior.point)
        if (moved > .38) {
          if (other.gap < prior.gap - .26 || moved > .67) prior.cue = now
          prior.point.copy(other.point)
          prior.gap = other.gap
        }
      }
    }

    let focus = multi ? threats.find(other => other.id === state.id) ?? main : main
    const hit = threats.find(other => other.id === state.hit)
    const sudden = multi && threats.find(other => other.id !== focus.id && other.gap <= this.range * .53 &&
      now - this.observations.get(other.id).cue < .21)
    let reaction = state.reaction
    if (hit || focus.id !== state.id || sudden && now > (state.started ?? 0) + .22 || multi && now >= state.next) {
      if (hit || sudden && state.id) focus = hit || sudden
      else if (focus.id === state.id) {
        const choices = threats.filter(other => other.id !== state.id &&
          Math.abs(angularDifference(bearing(from, focus.point), bearing(from, other.point))) > .52)
        const grade = other => {
          const memory = this.observations.get(other.id)
          return (other.attack ? 2.4 : 0) + (other.attack?.display ? 3.2 : 0) +
            Math.min(7, now - memory.seen) * .54 + (1 - other.gap / this.range) * 2.6 +
            Math.max(0, 1.2 - (now - memory.cue)) * 2.25 + this.sample() * 2.6
        }
        const steady = this.observations.get(focus.id)
        const wanted = focus.attack ? 1.8 : 0
        const moving = now - steady.cue < .65 ? 2.5 : 0
        let score = 2.8 + this.sample() * 3.6 + wanted + moving -
          Math.min(5, now - (state.started ?? now)) * .43
        for (const other of choices) {
          const interest = grade(other)
          if (interest > score) { score = interest; focus = other }
        }
      }
      const change = focus.id !== state.id || hit
      if (change) {
        state.started = now
        state.ticket = ++this.serial
        const yaw = Math.abs(angularDifference(unit.pivot.rotation?.y ?? direction, bearing(from, focus.point)))
        const urgent = Boolean(hit || sudden || focus.attack?.display || focus.gap < this.range * .43)
        const step = focus === main || urgent || focus.gap < this.range * .70 && yaw > 1.37 && this.sample() > .31
        state.step = step
        state.fast = urgent || yaw > 1.45
        reaction = urgent ? 'brace' : 'listen'
      } else if (multi && this.sample() > .68) {
        state.ticket = ++this.serial
        reaction = 'settle'
      }
      this.observations.get(focus.id).seen = now
      const pause = this.sample()
      const calmWindow = !sudden && !hit && pause > .68 ? 1.7 + this.sample() * 1.5 : 0
      state.next = now + (reaction === 'brace' ? .96 : reaction === 'listen' ? .68 : .85) * tempo[this.kind] +
        pause ** 2 * (mode === 'provoked' ? 2.25 : 2.9) + calmWindow
      state.hit = null
    }
    if (!multi && !main.attack && now >= state.nextScan) {
      state.scanUntil = now + .36 + this.sample() * .32
      state.nextScan = state.scanUntil + 2.05 + this.sample() * 2.75
      state.angle = (this.sample() < .5 ? -1 : 1) * (.31 + this.sample() * .28)
    }
    Object.assign(state, {
      id: focus.id, point: focus.point, multi, checking: focus !== main, reaction,
      scan: !multi && !main.attack && now < state.scanUntil ? state.angle : 0,
      display: Boolean(focus.attack?.display),
    })
    this.state = state
    return state
  }

  consumeDisplay(id = this.state?.id) {
    const attack = this.attacks.get(id)
    if (attack) attack.display = false
  }
}
