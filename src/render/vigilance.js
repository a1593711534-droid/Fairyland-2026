import { areOpponents } from '../game/combat.js'
import { distance, lineOfSight } from '../game/geometry.js'

const ranges = { turtle: 5.4, dino: 6.6, cat: 6.8, bird: 7.3, mouse: 5.9, dog: 7.0 }

function opposite(unit, other) {
  return other && unit.id !== other.id && !other.dead && !other.ghost && other.pivot.visible &&
    Boolean(unit.team && other.team) && areOpponents(unit, other)
}

export class Vigilance {
  constructor(species, sample) {
    this.range = ranges[species.replace(/-evolved$/, '')]
    this.sample = sample
    this.state = null
    this.attack = null
  }

  attacked(unit, attacker, now) {
    if (!this.range || !opposite(unit, attacker)) return
    const repeat = this.attack?.id === attacker.id && now - this.attack.hitAt < 1.7
    this.attack = { id: attacker.id, point: attacker.pivot.position.clone(),
      until: now + 8.4, hitAt: now, display: !repeat || this.attack.display }
  }

  update(unit, units, now) {
    if (!this.range || unit.dead || !unit.pivot.visible) return null
    const from = unit.pivot.position
    if (this.attack) {
      const threat = units.get(this.attack.id)
      if (now < this.attack.until && opposite(unit, threat)) {
        const target = threat.pivot.position
        if (lineOfSight(from, target)) {
          this.attack.point.copy(target)
          if (distance(from, target) < this.range + 1.8)
            this.attack.until = Math.max(this.attack.until, now + 3.1)
        }
        this.state = { mode: 'provoked', id: threat.id, point: this.attack.point, scan: 0, display: this.attack.display }
        return this.state
      }
      this.attack = null
    }

    const prior = this.state?.mode === 'guard' ? this.state : null
    const old = prior && units.get(prior.id)
    const visible = other => lineOfSight(from, other.pivot.position)
    let target = opposite(unit, old) && distance(from, old.pivot.position) < this.range + .9 &&
      (visible(old) || now < prior.lastSeen + .85) ? old : null
    let radius = target ? distance(from, target.pivot.position) * .71 : this.range
    for (const other of units.values()) {
      if (!opposite(unit, other) || other === target) continue
      const gap = distance(from, other.pivot.position)
      if (gap < radius && visible(other)) { target = other; radius = gap }
    }
    if (!target) {
      this.state = null
      return null
    }
    if (prior?.id !== target.id) {
      this.state = { mode: 'guard', id: target.id, point: target.pivot.position.clone(), lastSeen: now,
        scan: 0, scanUntil: 0, nextScan: now + 1.7 + this.sample() * 2.0, angle: 0 }
    }
    const watch = this.state
    if (visible(target)) {
      watch.point.copy(target.pivot.position)
      watch.lastSeen = now
    }
    if (now >= watch.nextScan) {
      watch.scanUntil = now + .36 + this.sample() * .32
      watch.nextScan = watch.scanUntil + 2.05 + this.sample() * 2.75
      watch.angle = (this.sample() < .5 ? -1 : 1) * (.31 + this.sample() * .28)
    }
    watch.scan = now < watch.scanUntil ? watch.angle : 0
    return watch
  }

  consumeDisplay() {
    if (this.attack) this.attack.display = false
  }
}
