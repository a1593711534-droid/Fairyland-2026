import { balance, elements, encounterTuning, hero, items, rules, skills, species, status, titleOf, xpForLevel } from './content.js'
import { distance, inBounds, lineOfSight, movementBlocks, router, travel } from './geometry.js'
import { consume, equipmentBonus, inventory, itemProblem } from './inventory.js'
import { summonPlan } from './summoning.js'
import { encounterAt, random } from './world.js'

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const copy = value => structuredClone(value)
const round = value => Math.round(value * 10) / 10
const controlled = unit => unit?.team === 'ally'
export const active = battle => battle.units.find(unit => unit.id === battle.active)
export const unitById = (battle, id) => battle.units.find(unit => unit.id === id)
export const isWild = unit => unit?.team === 'wild' || unit?.team === 'practice'
export const areOpponents = (a, b) => a !== b && a.team !== b.team && !(isWild(a) && isWild(b))

export const stat = (unit, name) => {
  const level = (unit.level ?? 1) - 1
  const base = unit.kind === 'hero' || unit.kind === 'rival' ? hero : species[unit.kind]
  const scale = unit.practice ? (balance.practice[name] ?? balance.practice.other) : 1
  const evolution = unit.evolved ? (balance.evolution[name] ?? balance.evolution.other) : 1
  const affinity = unit.bond && ['attack', 'aim', 'move'].includes(name) ? rules.matchSummon : 1
  const buff = Object.keys(unit.statuses).reduce((sum, key) => sum + (status[key]?.[name === 'aim' ? 'accuracy' : name] ?? 0), 0)
  const baseValue = (base[name] + level * (balance.growth[name] ?? 0)) * scale * evolution * affinity + equipmentBonus(unit, name)
  if (name === 'move') return baseValue * Object.keys(unit.statuses).reduce((scale, key) => scale * (status[key]?.move ?? 1), 1)
  return Math.round(baseValue + buff)
}

const defaults = { xp: 0, level: 1, evolved: false, statuses: {}, bond: false, mana: 0 }

function makeUnit(id, kind, team, x, z, extras = {}) {
  const unit = { ...defaults, statuses: {}, inventory: inventory(), id, kind, team, pos: { x, z }, ...extras }
  unit.hp ??= stat(unit, 'hp')
  unit.movement = stat(unit, 'move')
  unit.action = true
  unit.bonus = true
  unit.reaction = true
  unit.done = false
  return unit
}

export function startBattle(game, map, seed = Date.now()) {
  const layout = encounterAt(game, map, seed)
  if (!layout || game.battle || !game.hero.hp) return null
  const player = makeUnit('hero', 'hero', 'ally', -8.5, -.1, {
    hp: game.hero.hp, mana: game.hero.mana, statuses: copy(game.hero.statuses),
    inventory: copy(game.hero.inventory), sources: copy(game.hero.sources ?? {}),
  })
  const units = [player, ...layout.units.map(([kind, x, z, team], i) => makeUnit(
    'native-' + i, kind, team, x, z, { practice: team === 'practice',
      ...(kind === 'rival' ? { hp: encounterTuning.rivalHP, mana: encounterTuning.rivalMana } : {}) },
  ))]
  const battle = { seed: seed >>> 0 || 1, map, units, round: 1, active: player.id, order: [], events: [], participants: [], result: null, reward: layout.reward }
  battle.order = units.map(unit => ({ id: unit.id, roll: stat(unit, 'initiative') + 1 + Math.floor(random(battle) * balance.initiativeDie) }))
    .sort((a, b) => b.roll - a.roll || Number(b.id === 'hero') - Number(a.id === 'hero')).map(u => u.id)
  battle.active = battle.order[0]
  game.battle = battle
  beginTurn(battle, active(battle), false)
  note(battle, 'text', { text: '戰鬥開始。' })
  return battle
}

const note = (battle, type, fields) => {
  battle.events.push({ type, ...fields })
  if (battle.events.length > 50) battle.events.shift()
}

export const skillFor = unit => unit.kind === 'hero' || unit.kind === 'rival' ? hero.skill : species[unit.kind].skill
const elementFor = unit => unit.kind === 'hero' || unit.kind === 'rival' ? hero.element : species[unit.kind].element
export const elementOf = elementFor
export function modifier(attack, defense) {
  if (elements[attack]?.beats === defense) return balance.elements.advantage
  return elements[defense]?.beats === attack ? balance.elements.disadvantage : 1
}

export function forecast(attacker, target, key) {
  const spell = skills[key]
  const attackBonus = stat(attacker, 'aim') + spell.accuracy
  const armor = stat(target, 'defense')
  const die = balance.die
  const accuracy = clamp((die + 1 + attackBonus - armor) / die, 1 / die, 1 - 1 / die)
  const multiplier = spell.element
    ? modifier(spell.element, elementFor(target)) * (spell.element === elementFor(attacker) ? rules.matchSpell : 1)
    : 1
  const protection = balance.armorScale / (balance.armorScale + Math.max(0, armor))
  const [count, sides] = spell.dice
  const base = spell.power + stat(attacker, 'attack')
  const min = Math.max(1, Math.round((base + count) * protection * multiplier))
  const max = Math.max(min, Math.round((base + count * sides) * protection * multiplier))
  return {
    accuracy, min, max, attackBonus, armor, base, protection, multiplier,
    range: spell.range, distance: distance(attacker.pos, target.pos), clear: lineOfSight(attacker.pos, target.pos),
  }
}

export function captureChance(unit) {
  const missing = 1 - clamp(unit.hp / stat(unit, 'hp'), 0, 1)
  const impairment = Object.keys(unit.statuses).reduce((sum, key) => sum + (status[key]?.capture ?? 0), 0)
  const rarity = species[unit.kind]?.rarity ?? 0
  // Independent resistance factors on the log-odds scale keep the probability bounded.
  const cfg = balance.capture
  const odds = cfg.base + cfg.missing * missing + impairment - cfg.rarity * rarity + (unit.practice ? cfg.practice : 0)
  return clamp(1 / (1 + Math.exp(-odds)), cfg.min, cfg.max)
}

function snapshot(unit) {
  const { id, kind, hp, xp, level, evolved, statuses, practice } = unit
  return { id, kind, hp, xp, level, evolved, statuses: copy(statuses), sources: copy(unit.sources ?? {}),
    inventory: copy(unit.inventory), practice: Boolean(practice) }
}

function sync(game, unit) {
  if (unit.id === 'hero') {
    game.hero = { kind: 'hero', hp: unit.hp, mana: unit.mana, statuses: copy(unit.statuses),
      inventory: copy(unit.inventory), sources: copy(unit.sources ?? {}) }
    return
  }
  const index = game.collection.findIndex(entry => entry.id === unit.id)
  if (index >= 0) game.collection[index] = snapshot(unit)
}

function beginTurn(battle, unit, restoreMana) {
  if (unit.begun === battle.round) return
  unit.begun = battle.round
  unit.movement = stat(unit, 'move')
  if (restoreMana && unit.kind === 'hero') unit.mana = Math.min(rules.playerMana, unit.mana + rules.manaRecovery)
}

export function alliesInTurn(battle) {
  if (!controlled(active(battle))) return []
  const current = battle.order.indexOf(battle.active)
  const group = []
  let left = current
  while (left > 0 && controlled(unitById(battle, battle.order[left - 1]))) left--
  for (let i = left; i < battle.order.length; i++) {
    const unit = unitById(battle, battle.order[i])
    if (!controlled(unit)) break
    if (unit.hp > 0 && !unit.done && !unit.dismissed) group.push(unit)
  }
  return group
}

export function selectAlly(battle, id) {
  const unit = alliesInTurn(battle).find(u => u.id === id)
  if (!unit) return false
  battle.active = id
  beginTurn(battle, unit, battle.round > 1)
  return true
}

function addExperience(game, battle, defeated) {
  const gain = defeated.practice ? balance.practice.xp : (species[defeated.kind]?.xp ?? balance.experience.rival)
  for (const id of battle.participants) {
    const fighter = unitById(battle, id)
    const saved = game.collection.find(unit => unit.id === id)
    if (!saved || !fighter || fighter.hp <= 0) continue
    fighter.xp += gain
    const oldLevel = fighter.level
    const oldMax = stat(fighter, 'hp')
    while (fighter.level < rules.maxLevel && fighter.xp >= xpForLevel(fighter.level + 1)) fighter.level++
    if (fighter.level !== oldLevel) {
      fighter.hp += stat(fighter, 'hp') - oldMax
      note(battle, 'text', { text: titleOf(fighter) + ' 升到 Lv. ' + fighter.level + '。' })
    }
    sync(game, fighter)
  }
  note(battle, 'text', { text: '擊倒 ' + titleOf(defeated) + '，參戰夥伴獲得 ' + gain + ' 經驗。' })
}

function damage(game, battle, attacker, target, amount, skill) {
  target.hp = Math.max(0, target.hp - amount)
  note(battle, 'impact', { actor: attacker?.id, target: target.id, amount, skill, dead: !target.hp })
  if (!target.hp && attacker?.team === 'ally' && target.team !== 'ally') addExperience(game, battle, target)
  if (target.team === 'ally') sync(game, target)
}

function breakTethers(game, battle, heroUnit) {
  if (heroUnit.mana >= rules.tetherMana) return
  for (const unit of battle.units.filter(u => u.team === 'ally' && u.kind !== 'hero' && !u.dismissed && u.hp > 0)) {
    game.collection = game.collection.filter(entry => entry.id !== unit.id)
    unit.team = 'wild'
    unit.bond = false
    note(battle, 'text', { text: titleOf(unit) + ' 因魔力過低脫離掌控，成為野生精靈。' })
  }
}

function resolve(game, battle) {
  const player = unitById(battle, 'hero')
  const liveOpponent = battle.units.some(unit => unit.hp > 0 && !unit.dismissed && unit.team !== 'ally')
  if (player.hp > 0 && liveOpponent) return
  battle.result = player.hp > 0 ? 'victory' : 'defeat'
  if (battle.result === 'victory') {
    game.wins++
    game.gold += battle.reward ?? 0
    game.cleared[battle.map] = (game.cleared[battle.map] ?? 0) + 1
  }
  sync(game, player)
  if (!player.hp) game.world = 'camp'
  for (const unit of battle.units.filter(u => u.team === 'ally' && u.id !== 'hero' && !u.dismissed)) sync(game, unit)
  note(battle, 'text', { text: battle.result === 'victory' ? '戰鬥勝利。' : '撤退至月泉營地。' })
}

const invalid = problem => ({ ok: false, problem })
const success = fields => ({ ok: true, ...fields })

export function validate(game, command) {
  const battle = game.battle
  if (!battle || battle.result) return invalid('戰鬥已結束。')
  const actor = active(battle)
  if (!actor?.hp || actor.done || actor.dismissed) return invalid('行動已結束。')
  const { type, at } = command
  const target = unitById(battle, command.target)
  if (type === 'end') return success()
  if (['disengage', 'rush'].includes(type) && actor.action) return success()
  if (type === 'move') {
    const path = inRangeRoute(battle, actor, at)
    if (!path) return invalid('這個位置無法抵達。')
    if (path.cost > actor.movement + .00001) return invalid('移動距離不足。')
    return success({ path, reactions: reactionPoints(battle, actor, path) })
  }
  if (type === 'strike') {
    const key = command.skill
    if (!actor.action || ![skillFor(actor), 'attack'].includes(key)) return invalid('主要行動已用完。')
    const spell = skills[key]
    if (actor.mana < (spell.mana ?? 0)) return invalid('魔力不足。')
    if (spell.radius) return areaAttack(battle, actor, key, at)
    if (!target?.hp || target.dismissed || !areOpponents(actor, target)) return invalid('請指定可攻擊的目標。')
    const preview = forecast(actor, target, key)
    if (preview.distance > preview.range) return invalid('目標超出射程。')
    if (!preview.clear) return invalid('掩體阻擋了視線。')
    return success({ attacks: [{ target, preview }], center: target.pos })
  }
  if (type === 'summon-batch') return summonPlan(game, actor, command.placements)
  if (actor.kind === 'hero' && type === 'capture') {
    if (!actor.action) return invalid('主要行動已用完。')
    if (!target?.hp || target.dismissed || !isWild(target)) return invalid('只有野生精靈可以收服。')
    if (actor.mana < rules.captureMana) return invalid('魔力不足。')
    if (distance(actor.pos, target.pos) > rules.captureRange || !lineOfSight(actor.pos, target.pos)) return invalid('目標超出範圍或被遮擋。')
    return success({ target, chance: captureChance(target) })
  }
  if (controlled(actor) && type === 'item') {
    if (!actor.bonus) return invalid('附贈行動已用完。')
    const problem = itemProblem(actor, command.item, stat(actor, 'hp'))
    return problem ? invalid(problem) : success()
  }
  if (controlled(actor) && actor.kind !== 'hero' && type === 'recall') return success()
  return invalid('現在無法執行此操作。')
}

export function inRangeRoute(battle, actor, destination) {
  return router(actor.pos, movementBlocks(battle.units.filter(u => !u.dismissed), actor))(destination)
}

function finishTurn(game, battle, actor, tickStatuses = true) {
  if (tickStatuses) {
    for (const [key, count] of Object.entries(actor.statuses)) {
      if (status[key]?.dot && actor.hp) {
        const source = unitById(battle, actor.sources?.[key])
        damage(game, battle, source, actor, status[key].dot, key)
      }
      if (count > 1) actor.statuses[key]--
      else delete actor.statuses[key]
    }
    if (controlled(actor)) sync(game, actor)
  }
  actor.done = true
  resolve(game, battle)
  if (battle.result) return

  let next = battle.order.find(id => {
    const unit = unitById(battle, id)
    return unit.hp > 0 && !unit.dismissed && !unit.done
  })
  if (!next) {
    battle.round++
    for (const unit of battle.units) {
      unit.done = false
      unit.action = true
      unit.bonus = true
      unit.reaction = true
      unit.disengaged = false
      unit.summoned = false
    }
    next = battle.order.find(id => {
      const unit = unitById(battle, id)
      return unit.hp > 0 && !unit.dismissed
    })
  }
  battle.active = next
  beginTurn(battle, active(battle), battle.round > 1)
}

function reactionPoints(battle, actor, path) {
  if (actor.disengaged) return []
  const result = []
  const radius = skills.attack.range
  for (const unit of battle.units) {
    if (unit.hp <= 0 || unit.dismissed || unit.team === 'practice' ||
        unit.reaction === false || !areOpponents(unit, actor)) continue
    let passed = 0
    for (let i = 1; i < path.points.length; i++) {
      const from = path.points[i - 1]
      const to = path.points[i]
      const length = distance(from, to)
      if (length < .0001) continue
      const x = (to.x - from.x) / length
      const z = (to.z - from.z) / length
      const dx = from.x - unit.pos.x
      const dz = from.z - unit.pos.z
      const projection = dx * x + dz * z
      const discriminant = projection ** 2 - dx ** 2 - dz ** 2 + radius ** 2
      if (discriminant > .0001) {
        const exit = -projection + Math.sqrt(discriminant)
        const hit = { x: from.x + exit * x, z: from.z + exit * z }
        if (exit >= 0 && exit < length - .0001 && lineOfSight(unit.pos, hit)) {
          result.push({ unit, cost: passed + exit })
          break
        }
      }
      passed += length
    }
  }
  return result.sort((a,b) => a.cost - b.cost)
}

export const movementReactions = (battle, actor, path) => reactionPoints(battle, actor, path).map(contact => contact.unit)

export function areaAttack(battle, actor, key, center) {
  const spell = skills[key]
  if (!inBounds(center) || distance(actor.pos, center) > spell.range) return invalid('目標超出法術射程。')
  if (!lineOfSight(actor.pos, center)) return invalid('掩體阻擋了視線。')
  const attacks = battle.units.map(unit => unit.id === actor.id ? actor : unit)
    .filter(unit => unit.hp > 0 && !unit.dismissed &&
      distance(unit.pos, center) <= spell.radius && lineOfSight(center, unit.pos))
    .map(target => ({ target, preview: forecast(actor, target, key) }))
  return attacks.some(({ target }) => areOpponents(actor, target))
    ? success({ attacks, center }) : invalid('範圍內沒有可攻擊的目標。')
}

function emitCast(battle, actor, key, center, target) {
  const spell = skills[key]
  note(battle, 'cast', { actor: actor.id, target: target?.id, center, radius: spell.radius,
    clip: spell.melee ? 'attack' : 'skill', element: spell.element ?? elementFor(actor) })
}

function strike(game, battle, actor, target, key, preview) {
  const spell = skills[key]
  const roll = 1 + Math.floor(random(battle) * balance.die)
  const hit = roll === balance.die || (roll !== 1 && roll + preview.attackBonus >= preview.armor)
  if (!hit) { note(battle, 'miss', { actor: actor.id, target: target.id }); return }
  const [count, sides] = spell.dice
  let dice = 0
  for (let i = 0; i < count * (roll === balance.die ? 2 : 1); i++) dice += 1 + Math.floor(random(battle) * sides)
  if (spell.status) {
    target.statuses[spell.status] = Math.max(status[spell.status].duration, target.statuses[spell.status] ?? 0)
    target.sources = { ...target.sources, [spell.status]: actor.id }
  }
  const amount = Math.max(1, Math.round((preview.base + dice) * preview.protection * preview.multiplier))
  damage(game, battle, actor, target, amount, key)
}

function deploySummon(battle, actor, { saved, at }) {
  const unit = makeUnit(saved.id, saved.kind, actor.team, at.x, at.z, {
    ...saved, statuses: copy(saved.statuses ?? {}), inventory: copy(saved.inventory ?? inventory()), bond: species[saved.kind].element === elementFor(actor),
  })
  const oldIndex = battle.units.findIndex(other => other.id === unit.id)
  const originalOrder = battle.order.indexOf(unit.id)
  if (oldIndex >= 0) {
    const previous = battle.units[oldIndex]
    unit.sources = copy(previous.sources ?? {})
    if (previous.begun === battle.round) {
      Object.assign(unit, { done: true, begun: previous.begun, action: false, bonus: false,
        reaction: previous.reaction, movement: 0, disengaged: previous.disengaged })
    }
    battle.units[oldIndex] = unit
  } else battle.units.push(unit)
  if (actor.team === 'ally' && !battle.participants.includes(unit.id)) battle.participants.push(unit.id)
  if (originalOrder >= 0) battle.order.splice(originalOrder, 1)
  let insert = battle.order.indexOf(actor.id) + 1
  while (battle.order[insert] && unitById(battle, battle.order[insert]).team === actor.team) insert++
  battle.order.splice(insert, 0, unit.id)
}

export function act(game, command) {
  const result = validate(game, command)
  if (!result.ok) return result
  const battle = game.battle
  const actor = active(battle)
  const { type, at } = command
  if (type === 'move') {
    const { path, reactions } = result
    let traveled = 0
    const walkUntil = total => {
      if (Math.abs(total - traveled) < .0001) return
      const old = travel(path, traveled)
      const next = travel(path, total)
      const segment = [actor.pos, ...next.slice(old.length - 1)]
      actor.pos = next.at(-1)
      note(battle, 'move', { actor: actor.id, points: segment })
      traveled = total
    }
    for (const { unit: reactor, cost } of reactions) {
      walkUntil(cost)
      reactor.reaction = false
      note(battle, 'text', { text: titleOf(reactor) + ' 發動了借機攻擊。' })
      emitCast(battle, reactor, 'attack', actor.pos, actor)
      strike(game, battle, reactor, actor, 'attack', forecast(reactor, actor, 'attack'))
      if (!actor.hp) break
    }
    if (actor.hp) walkUntil(path.cost)
    actor.movement = Math.max(0, actor.movement - traveled)
  }
  if (type === 'disengage') {
    actor.action = false
    actor.disengaged = true
    note(battle, 'text', { text: titleOf(actor) + ' 小心脫離，本回合不引發借機攻擊。' })
  }
  if (type === 'rush') {
    actor.action = false
    actor.movement += stat(actor, 'move') * balance.rush
    note(battle, 'text', { text: titleOf(actor) + ' 衝刺，增加了本回合的移動距離。' })
  }
  if (type === 'strike') {
    actor.action = false
    actor.mana -= skills[command.skill].mana ?? 0
    emitCast(battle, actor, command.skill, result.center, result.attacks.length === 1 ? result.attacks[0].target : null)
    for (const { target, preview } of result.attacks) strike(game, battle, actor, target, command.skill, preview)
    if (actor.kind === 'hero') breakTethers(game, battle, actor)
  }
  if (type === 'summon-batch') {
    actor.summoned = true
    actor.mana -= result.cost
    for (const placement of result.entries) deploySummon(battle, actor, placement)
    note(battle, 'summon-batch', { actor: actor.id, targets: result.entries.map(row => row.saved.id) })
    if (actor.kind === 'hero') breakTethers(game, battle, actor)
  }
  if (type === 'capture') {
    const { target, chance } = result
    actor.action = false
    actor.mana -= rules.captureMana
    const won = random(battle) < chance
    note(battle, 'capture', { actor: actor.id, target: target.id, element: elementFor(target), won })
    if (won) {
      const entry = { ...snapshot(target), id: 'friend-' + game.serial++ }
      game.collection.push(entry)
      target.dismissed = true
    }
    breakTethers(game, battle, actor)
  }
  if (type === 'recall') {
    actor.dismissed = true
    sync(game, actor)
    note(battle, 'recall', { actor: actor.id, element: elementFor(actor) })
  }
  if (type === 'item') {
    actor.bonus = false
    consume(actor, command.item, stat(actor, 'hp'))
    note(battle, 'text', { text: titleOf(actor) + ' 使用了' + items[command.item].name + '。' })
  }
  if (controlled(actor)) sync(game, actor)
  if (type === 'end' || type === 'recall' || actor.hp <= 0) finishTurn(game, battle, actor, type === 'end')
  else resolve(game, battle)
  return result
}

export function healParty(game) {
  Object.assign(game.hero, { hp: stat({ ...game.hero, level: 1 }, 'hp'), mana: rules.playerMana, statuses: {}, sources: {} })
  for (const unit of game.collection) {
    unit.statuses = {}
    unit.sources = {}
    unit.hp = stat(unit, 'hp')
  }
}

export function evolve(unit) {
  if (!unit || unit.level < rules.evolutionLevel || unit.evolved) return false
  const oldMax = stat(unit, 'hp')
  unit.evolved = true
  if (unit.hp) unit.hp += stat(unit, 'hp') - oldMax
  return true
}

export const percent = probability => Math.round(probability * 100) + '%'
export const meters = amount => round(amount).toFixed(1) + ' m'
