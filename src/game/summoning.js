import { rules, species } from './content.js'
import { distance, free, lineOfSight, movementBlocks } from './geometry.js'

export function availableSummons(game, actor) {
  const collection = actor.kind === 'rival'
    ? Object.keys(species).map(kind => ({ id: 'rival-' + kind, kind, hp: species[kind].hp }))
    : game.collection
  return collection.filter(u => u.hp > 0 && !game.battle.units.some(other => other.id === u.id && !other.dismissed))
}

export function summonPlan(game, actor, placements) {
  const fail = problem => ({ ok: false, problem })
  if (!['hero', 'rival'].includes(actor.kind) || actor.summoned) return fail('本回合已使用召喚。')
  if (!Array.isArray(placements) || !placements.length) return fail('請先配置至少一隻精靈。')
  const available = availableSummons(game, actor)
  const blockers = movementBlocks(game.battle.units.filter(u => !u.dismissed), actor)
  const gap = rules.bodyRadius * 2
  const entries = []
  let cost = 0
  for (const { id, at } of placements) {
    const saved = available.find(u => u.id === id)
    if (!saved || entries.some(row => row.saved.id === id)) return fail('精靈已配置或無法召喚。')
    if (!at || !free(at, blockers) || distance(actor.pos, at) < gap ||
        distance(actor.pos, at) > rules.summonRange || !lineOfSight(actor.pos, at)) {
      return fail('請選擇範圍內、未被遮擋的空地。')
    }
    cost += species[saved.kind].summon
    if (cost > actor.mana) return fail('魔力不足。')
    blockers.push({ ...at, radius: gap })
    entries.push({ saved, at })
  }
  return { ok: true, entries, cost }
}
