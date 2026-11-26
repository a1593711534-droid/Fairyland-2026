import { elements, encounters, hero, rules, skills, species, status, titleOf, xpForLevel } from './content.js'
import { distance, free, lineOfSight, movementBlocks, router } from './geometry.js'

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const copy = value => structuredClone(value)
const round = value => Math.round(value * 10) / 10
const controlled = unit => unit?.team === 'ally'
export const active = battle => battle.units.find(unit => unit.id === battle.active)
export const unitById = (battle, id) => battle.units.find(unit => unit.id === id)
export const isWild = unit => unit?.team === 'wild' || unit?.team === 'practice'
export const areOpponents = (a, b) => a !== b && a.team !== b.team && !(isWild(a) && isWild(b))

function random(battle) {
  let n = battle.seed >>> 0
  n ^= n << 13
  n ^= n >>> 17
  n ^= n << 5
  battle.seed = n >>> 0 || 1
  return battle.seed / 4294967296
}

export const stat = (unit, name) => {
  const level = unit.level - 1
  const base = unit.kind === 'hero' || unit.kind === 'rival' ? hero : species[unit.kind]
  const growth = { hp: 7, attack: 2, defense: .35, aim: .35, move: .15 }
  const scale = unit.practice ? (name === 'hp' ? .32 : name === 'defense' ? .72 : .65) : 1
  const evolution = unit.evolved ? (name === 'hp' ? 1.24 : 1.16) : 1
  const affinity = unit.bond && ['attack', 'aim', 'move'].includes(name) ? rules.matchSummon : 1
  const buff = Object.keys(unit.statuses).reduce((sum, key) => sum + (status[key]?.[name === 'aim' ? 'accuracy' : name] ?? 0), 0)
  const baseValue = (base[name] + level * (growth[name] ?? 0)) * scale * evolution * affinity
  if (name === 'move') return baseValue * Object.keys(unit.statuses).reduce((scale, key) => scale * (status[key]?.move ?? 1), 1)
  return Math.round(baseValue + buff)
}

const defaults = { xp: 0, level: 1, evolved: false, statuses: {}, bond: false, mana: 0 }

function makeUnit(id, kind, team, x, z, extras = {}) {
  const unit = { ...defaults, statuses: {}, id, kind, team, pos: { x, z }, ...extras }
  unit.hp ??= stat(unit, 'hp')
  unit.movement = stat(unit, 'move')
  unit.action = true
  unit.bonus = true
  unit.reaction = true
  unit.done = false
  return unit
}

export function startBattle(game, map, seed = Date.now()) {
  const player = makeUnit('hero', 'hero', 'ally', -8.5, -.1, {
    hp: game.hero.hp, mana: game.hero.mana, statuses: copy(game.hero.statuses),
  })
  const units = [player, ...encounters[map].map(([kind, x, z, team], i) => makeUnit(
    'native-' + i, kind, team, x, z, { practice: team === 'practice', ...(kind === 'rival' ? { hp: 89, mana: 29 } : {}) },
  ))]
  const battle = { seed: seed >>> 0 || 1, map, units, round: 1, active: player.id, order: [], events: [], participants: [], result: null }
  battle.order = units.map(unit => ({ id: unit.id, roll: stat(unit, 'initiative') + 1 + Math.floor(random(battle) * 4) }))
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
  if (elements[attack]?.beats === defense) return 1.5
  return elements[defense]?.beats === attack ? .75 : 1
}

export function forecast(attacker, target, key) {
  const spell = skills[key]
  const attackBonus = stat(attacker, 'aim') + spell.accuracy
  const armor = stat(target, 'defense')
  const accuracy = clamp((21 + attackBonus - armor) / 20, .05, .95)
  const multiplier = spell.element
    ? modifier(spell.element, elementFor(target)) * (spell.element === elementFor(attacker) ? rules.matchSpell : 1)
    : 1
  const protection = 60 / (60 + Math.max(0, armor))
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
  return clamp(1 / (1 + Math.exp(-(-1.4 + 4.0 * missing + impairment - 2.8 * rarity + (unit.practice ? 2.25 : 0)))), .08, .97)
}

function snapshot(unit) {
  const { id, kind, hp, xp, level, evolved, statuses, practice } = unit
  return { id, kind, hp, xp, level, evolved, statuses: copy(statuses), practice: Boolean(practice) }
}

function sync(game, unit) {
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
  const gain = defeated.practice ? 170 : (species[defeated.kind]?.xp ?? 125)
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
  if (battle.result === 'victory') game.wins++
  game.hero = { hp: player.hp, mana: player.mana, statuses: copy(player.statuses) }
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
  if (type === 'disengage' && actor.action) return success()
  if (type === 'move') {
    const path = inRangeRoute(battle, actor, at)
    if (!path) return invalid('這個位置無法抵達。')
    if (path.cost > actor.movement + .00001) return invalid('移動距離不足。')
    return success({ path, reactions: movementReactions(battle, actor, path) })
  }
  if (type === 'strike') {
    const key = command.skill
    if (!actor.action || ![skillFor(actor), 'attack'].includes(key)) return invalid('主要行動已用完。')
    if (!target?.hp || target.dismissed || !areOpponents(actor, target)) return invalid('請指定可攻擊的目標。')
    if (actor.mana < (skills[key].mana ?? 0)) return invalid('魔力不足。')
    const preview = forecast(actor, target, key)
    if (preview.distance > preview.range) return invalid('目標超出射程。')
    if (!preview.clear) return invalid('掩體阻擋了視線。')
    return success({ preview, target })
  }
  if (type === 'summon' && ['hero', 'rival'].includes(actor.kind)) {
    const rival = actor.kind === 'rival'
    const saved = rival ? { kind: command.kind, id: 'rival-' + command.kind } : game.collection.find(unit => unit.id === command.id)
    if (!species[saved?.kind] || (!rival && !saved.hp) || battle.units.some(u => u.id === saved.id && !u.dismissed)) return invalid('這隻精靈無法召喚。')
    if (actor.mana < species[saved.kind].summon) return invalid('魔力不足。')
    if (!at || !free(at, movementBlocks(battle.units.filter(u => !u.dismissed), actor)) ||
      distance(at, actor.pos) < rules.bodyRadius * 2 || distance(at, actor.pos) > rules.summonRange ||
      !lineOfSight(actor.pos, at)) return invalid('請選擇範圍內且無遮擋的空地。')
    return success({ saved })
  }
  if (actor.kind === 'hero' && type === 'capture') {
    if (!actor.action) return invalid('主要行動已用完。')
    if (!target?.hp || target.dismissed || !isWild(target)) return invalid('只有野生精靈可以收服。')
    if (actor.mana < rules.captureMana) return invalid('魔力不足。')
    if (distance(actor.pos, target.pos) > rules.captureRange || !lineOfSight(actor.pos, target.pos)) return invalid('目標超出範圍或被遮擋。')
    return success({ target, chance: captureChance(target) })
  }
  if (controlled(actor) && type === 'item') {
    if (!actor.bonus || game.items < 1) return invalid('附贈行動或回復果已用完。')
    if (actor.hp >= stat(actor, 'hp')) return invalid('生命值已滿。')
    return success()
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
    }
    next = battle.order.find(id => {
      const unit = unitById(battle, id)
      return unit.hp > 0 && !unit.dismissed
    })
  }
  battle.active = next
  beginTurn(battle, active(battle), battle.round > 1)
}

export function movementReactions(battle, actor, path) {
  if (actor.disengaged) return []
  return battle.units.filter(unit => unit.hp > 0 && !unit.dismissed && !unit.practice &&
    unit.reaction !== false && areOpponents(unit, actor) && path.points.slice(1).some((point, i) => {
      const from = path.points[i]
      return distance(unit.pos, from) <= skills.attack.range && distance(unit.pos, point) > skills.attack.range &&
        lineOfSight(unit.pos, from)
    }))
}

function strike(game, battle, actor, target, key, preview) {
  const spell = skills[key]
  const roll = 1 + Math.floor(random(battle) * 20)
  const hit = roll === 20 || (roll !== 1 && roll + preview.attackBonus >= preview.armor)
  note(battle, 'cast', { actor: actor.id, target: target.id, clip: spell.melee ? 'attack' : 'skill', element: spell.element ?? elementFor(actor) })
  if (!hit) { note(battle, 'miss', { actor: actor.id, target: target.id }); return }
  const [count, sides] = spell.dice
  let dice = 0
  for (let i = 0; i < count * (roll === 20 ? 2 : 1); i++) dice += 1 + Math.floor(random(battle) * sides)
  if (spell.status) {
    target.statuses[spell.status] = Math.max(status[spell.status].duration, target.statuses[spell.status] ?? 0)
    target.sources = { ...target.sources, [spell.status]: actor.id }
  }
  const amount = Math.max(1, Math.round((preview.base + dice) * preview.protection * preview.multiplier))
  damage(game, battle, actor, target, amount, key)
}

export function act(game, command) {
  const result = validate(game, command)
  if (!result.ok) return result
  const battle = game.battle
  const actor = active(battle)
  const { type, at } = command
  if (type === 'move') {
    const from = actor.pos
    actor.pos = { x: at.x, z: at.z }
    actor.movement = Math.max(0, actor.movement - result.path.cost)
    note(battle, 'move', { actor: actor.id, from, points: result.path.points })
    for (const reactor of result.reactions) {
      if (!actor.hp) break
      reactor.reaction = false
      note(battle, 'text', { text: titleOf(reactor) + ' 發動了借機攻擊。' })
      strike(game, battle, reactor, actor, 'attack', forecast(reactor, actor, 'attack'))
    }
  }
  if (type === 'disengage') {
    actor.action = false
    actor.disengaged = true
    note(battle, 'text', { text: titleOf(actor) + ' 小心脫離，本回合不引發借機攻擊。' })
  }
  if (type === 'strike') {
    actor.action = false
    actor.mana -= skills[command.skill].mana ?? 0
    strike(game, battle, actor, result.target, command.skill, result.preview)
    if (actor.kind === 'hero') breakTethers(game, battle, actor)
  }
  if (type === 'summon') {
    const { saved } = result
    actor.mana -= species[saved.kind].summon
    const unit = makeUnit(saved.id, saved.kind, actor.team, at.x, at.z, {
      ...saved, statuses: copy(saved.statuses ?? {}), bond: species[saved.kind].element === elementFor(actor),
    })
    const oldIndex = battle.units.findIndex(other => other.id === unit.id)
    const originalOrder = battle.order.indexOf(unit.id)
    if (oldIndex >= 0) {
      const previous = battle.units[oldIndex]
      unit.sources = previous.sources
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
    note(battle, 'summon', { actor: actor.id, target: unit.id, element: elementFor(unit) })
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
    game.items--
    actor.hp = Math.min(stat(actor, 'hp'), actor.hp + rules.healAmount)
    note(battle, 'text', { text: titleOf(actor) + ' 使用了回復果。' })
  }
  if (type === 'end' || type === 'recall' || actor.hp <= 0) finishTurn(game, battle, actor, type === 'end')
  else resolve(game, battle)
  return result
}

export function healParty(game) {
  game.hero = { hp: hero.hp, mana: rules.playerMana, statuses: {} }
  game.items = rules.itemCharges
  for (const unit of game.collection) {
    unit.statuses = {}
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
