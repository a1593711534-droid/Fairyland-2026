import { active, act, areaAttack, areOpponents, forecast, movementReactions, skillFor, stat, validate } from './combat.js'
import { distance, movementBlocks, router, travel } from './geometry.js'
import { encounterTuning, rules, skills } from './content.js'

function positions(actor, foes, paths, canMove) {
  const options = [{ pos: actor.pos, cost: 0 }]
  if (!canMove || actor.movement < .35) return options
  const probes = []
  const sample = (center, r, count) => {
    for (let i = 0; i < count; i++) {
      const angle = i * Math.PI * 2 / count
      probes.push({ x: center.x + Math.cos(angle) * r, z: center.z + Math.sin(angle) * r })
    }
  }
  sample(actor.pos, actor.movement * .92, 12)
  for (const foe of foes) {
    sample(foe.pos, 1.7, 8)
    sample(foe.pos, 4.6, 6)
  }
  for (const pos of probes) {
    const path = paths(pos)
    if (!path || path.cost < .35) continue
    if (path.cost <= actor.movement) options.push({ pos, cost: path.cost })
    else {
      const last = travel(path, actor.movement).at(-1)
      if (distance(last, actor.pos) > .35) options.push({ pos: last, cost: actor.movement })
    }
  }
  return options
}

function pressure(actor, foe) {
  const f = forecast(foe, actor, skillFor(foe))
  const move = stat(foe, 'move')
  const reach = f.range + move * .68
  if (f.distance > reach || foe.practice) return 0
  const average = (f.min + f.max) * .5 * f.accuracy
  return average * (f.clear ? 1 : .34) * (f.distance <= f.range ? 1 : .58)
}

function summonRival(game, actor, foes) {
  const prey = foes.find(unit => unit.kind === 'hero') ?? foes[0]
  if (!prey) return
  const toward = Math.atan2(prey.pos.z - actor.pos.z, prey.pos.x - actor.pos.x)
  const placements = []
  for (const kind of encounterTuning.rivalRoster) {
    const candidates = []
    for (let i = 0; i < 12; i++) {
      const angle = toward + i * Math.PI / 6
      const at = { x: actor.pos.x + 3.05 * Math.cos(angle), z: actor.pos.z + 3.05 * Math.sin(angle) }
      const placement = { id: 'rival-' + kind, at }
      const check = validate(game, { type: 'summon-batch', placements: [...placements, placement] })
      if (!check.ok || actor.mana - check.cost < (skills[skillFor(actor)].mana ?? 0)) continue
      candidates.push({ placement, value: -distance(at, prey.pos) })
    }
    const best = candidates.sort((a, b) => b.value - a.value)[0]
    if (best) placements.push(best.placement)
  }
  if (placements.length) act(game, { type: 'summon-batch', placements })
}

function attackValue(foe, f, key) {
  const average = (f.min + f.max) * .5
  const kill = Math.max(0, Math.min(1, (f.max + 1 - foe.hp) / (f.max + 1 - f.min)))
  const focus = 1 - foe.hp / stat(foe, 'hp')
  const statusValue = skills[key].status && !foe.statuses[skills[key].status] ? 6 : 0
  return f.accuracy * (Math.min(average, foe.hp) + kill * (foe.kind === 'hero' ? 48 : 24) + focus * 9 + statusValue)
}

export function enemyTurn(game) {
  const battle = game.battle
  const actor = active(battle)
  if (!actor || actor.team === 'ally' || battle.result) return
  if (actor.team === 'practice') {
    act(game, { type: 'end' })
    return
  }
  const foes = battle.units.filter(u => u.hp > 0 && !u.dismissed && areOpponents(actor, u))
  if (actor.kind === 'rival') summonRival(game, actor, foes)
  const paths = router(actor.pos, movementBlocks(battle.units.filter(u => !u.dismissed), actor))
  const options = positions(actor, foes, paths, true)
  const allies = battle.units.filter(u => u !== actor && u.hp > 0 && !u.dismissed && !areOpponents(actor, u))
  const spell = skillFor(actor)
  let best = { score: -Infinity, pos: actor.pos, cost: 0 }
  for (const option of options) {
    const proxy = { ...actor, pos: option.pos }
    const safety = foes.reduce((sum, foe) => sum + pressure(proxy, foe), 0)
    const healthRatio = actor.hp / stat(actor, 'hp')
    const closest = Math.min(20, ...foes.map(foe => distance(option.pos, foe.pos)))
    const clustered = allies.reduce((sum, friend) => sum + Math.max(0, 2.8 - distance(friend.pos, option.pos)), 0)
    const route = option.cost > 0 ? paths(option.pos) : null
    const hazards = route ? movementReactions(battle, actor, route).length : 0
    const posture = -closest * (healthRatio < .3 ? .7 : 2.9) - safety * (healthRatio < .3 ? .51 : .28) -
      clustered * 2 - option.cost * .35 - hazards * (healthRatio < .3 ? 25 : 14)
    if (posture > best.score) best = { ...option, score: posture }
    for (const foe of foes) {
      if (!actor.action) continue
      for (const key of ['attack', spell]) {
        const spellData = skills[key]
        if (actor.mana < (spellData.mana ?? 0)) continue
        const f = forecast(proxy, foe, key)
        if (!f.clear || f.distance > f.range) continue
        const blast = spellData.radius && areaAttack(battle, proxy, key, foe.pos)
        if (blast && !blast.ok) continue
        const value = blast ? blast.attacks.reduce((sum, hit) => sum +
          attackValue(hit.target, hit.preview, key) * (hit.target.id === actor.id || !areOpponents(actor, hit.target) ? -1.3 : 1), 0) :
          attackValue(foe, f, key)
        const score = posture + value * 1.7
        if (score > best.score) best = { ...option, score, key, foe }
      }
    }
  }
  if (best.cost > .01) act(game, { type: 'move', at: best.pos })
  if (best.key && !battle.result && active(battle) === actor) {
    act(game, { type: 'strike', target: best.foe.id, at: best.foe.pos, skill: best.key })
  }
  if (active(battle) !== actor) return
  if (battle.result) return
  // Casters can retreat with unspent movement after attacking.
  if (best.key === spell && actor.movement > 1.7 && actor.hp < stat(actor, 'hp') * .48) {
    const retreat = router(actor.pos, movementBlocks(battle.units.filter(u => !u.dismissed), actor))
    const remaining = positions(actor, [], retreat, true)
    const threat = pos => foes.reduce((sum, foe) => sum + (foe.hp ? pressure({ ...actor, pos }, foe) : 0), 0)
    const candidate = remaining.map(p => ({ ...p, value: threat(p.pos) + p.cost * .6 })).sort((a, b) => a.value - b.value)[0]
    if (candidate.cost > .01) act(game, { type: 'move', at: candidate.pos })
  }
  act(game, { type: 'end' })
}

export const enemyCanPlay = battle => battle && !battle.result && active(battle)?.team !== 'ally'
export const area = rules.board
