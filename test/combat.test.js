import test from 'node:test'
import assert from 'node:assert/strict'
import { elements, obstacles, rules, species, xpForLevel } from '../src/game/content.js'
import { active, act, areaAttack, captureChance, evolve, forecast, healParty, modifier, movementReactions,
  selectAlly, startBattle, stat, unitById, validate } from '../src/game/combat.js'
import { enemyCanPlay, enemyTurn } from '../src/game/ai.js'
import { distance, movementBlocks, movementMask, router } from '../src/game/geometry.js'
import { newGame, readSlot, writeSlot } from '../src/game/save.js'
import { inventory, placeItem, purchase } from '../src/game/inventory.js'
import { chooseEvent, encounterAt, requiresBattle } from '../src/game/world.js'
import { movementCheckpoint, reversibleMove, restoreMovement } from '../src/game/undo-move.js'
import { idleSequence } from '../src/render/idle-sequence.js'

function fixture(map = 'glade') {
  const game = newGame()
  game.collection = []
  const battle = startBattle(game, map, 22211)
  battle.active = 'hero'
  return { game, battle, player: active(battle) }
}

const batch = (...placements) => ({ type: 'summon-batch', placements })
const friend = (kind, id = 'friend-1') => ({
  id, kind, hp: 11, xp: 51, level: 2, evolved: false, statuses: { frost: 2 }, inventory: inventory(['tea']), practice: false,
})

test('new games can summon each of the six elements while the hero starts alone', () => {
  for (const kind of Object.keys(species)) {
    const game = newGame()
    const battle = startBattle(game, 'glade', 22211)
    assert.equal(battle.active, 'hero')
    assert.deepEqual(battle.units.filter(unit => unit.team === 'ally').map(unit => unit.kind), ['hero'])
    assert.deepEqual(new Set(game.collection.map(unit => species[unit.kind].element)), new Set(Object.keys(elements)))
    const id = 'starter-' + kind
    const at = { x: -7.2, z: 0 }
    assert.equal(act(game, batch({ id, at })).ok, true)
    assert.equal(unitById(battle, id).hp, species[kind].hp)
  }
})

test('the movement overlay uses path cost for detours and excludes occupied ground', () => {
  const { battle, player } = fixture()
  player.pos = { x: -4.2, z: .8 }
  const budget = 4.8
  const blocks = movementBlocks(battle.units, player)
  const routeTo = router(player.pos, blocks)
  const { bounds, columns, rows, mask } = movementMask(player.pos, budget, routeTo, .18)
  function shaded(x, z) {
    const col = Math.floor(columns * (x - bounds.minX) / (bounds.maxX - bounds.minX))
    const row = Math.floor(rows * (z - bounds.minZ) / (bounds.maxZ - bounds.minZ))
    return mask[row * columns + col]
  }
  assert.ok(shaded(-5.35, .8))
  assert.ok(shaded(-4.9, 2.5))
  const practice = unitById(battle, 'native-3')
  assert.equal(shaded(practice.pos.x, practice.pos.z), 0)
  assert.equal(shaded(-1.9, .8), 0)
  assert.equal(shaded(.4, .8), 0)
  assert.equal(routeTo({ x: .4, z: .8 }, budget), null)
  assert.ok(routeTo({ x: .4, z: .8 }).cost > budget)
})

test('element cycle is complete and hit odds include natural 1 and 20', () => {
  for (const [key, element] of Object.entries(elements)) {
    assert.equal(modifier(key, element.beats), 1.5)
    assert.equal(modifier(element.beats, key), .75)
    assert.equal(modifier(key, key), 1)
  }
  const { battle, player } = fixture()
  const target = unitById(battle, 'native-0')
  const f = forecast(player, target, 'ember')
  assert.equal(f.accuracy, (21 + f.attackBonus - f.armor) / 20)
  assert.equal(f.multiplier, .75 * rules.matchSpell)
  assert.ok(f.min > 0 && f.max > f.min)
})

test('continuous movement routes around blockers and respects reach', () => {
  const start = { x: -4.1, z: .8 }
  const end = { x: .6, z: .8 }
  const path = router(start, [obstacles[0]])(end)
  assert.ok(path.points.length > 2)
  assert.ok(path.cost > distance(start, end))
  assert.equal(router(start, [obstacles[0]])(obstacles[0]), null)
  const { game, player } = fixture()
  const before = player.movement
  assert.equal(act(game, { type: 'move', at: { x: 49, z: 0 } }).ok, false)
  assert.equal(act(game, { type: 'move', at: { x: -7.3, z: 1.5 } }).ok, true)
  assert.ok(player.movement < before && player.action)
})

test('departing threatened space can trigger a reaction and disengage prevents it', () => {
  const { game, battle, player } = fixture()
  const foe = unitById(battle, 'native-0')
  foe.pos = { x: -7, z: -.1 }
  const at = { x: -10.7, z: 0 }
  const path = validate(game, { type: 'move', at }).path
  assert.ok(movementReactions(battle, player, path).includes(foe))
  assert.equal(act(game, { type: 'disengage' }).ok, true)
  assert.equal(player.action, false)
  assert.equal(movementReactions(battle, player, path).length, 0)
})

test('successive free moves can be undone in reverse order with the exact movement budget', () => {
  const { game, battle, player } = fixture()
  const initial = movementCheckpoint(battle)
  const first = reversibleMove(battle, initial, act(game, { type: 'move', at: { x: -9.8, z: 1.1 } }))
  const intermediate = movementCheckpoint(battle)
  const second = reversibleMove(battle, intermediate, act(game, { type: 'move', at: { x: -10.6, z: .3 } }))
  assert.ok(first && second)
  assert.equal(restoreMovement(battle, first), false)
  assert.equal(restoreMovement(battle, second), true)
  assert.deepEqual(player.pos, intermediate.start)
  assert.equal(player.movement, intermediate.allowance)
  assert.equal(restoreMovement(battle, first), true)
  assert.deepEqual(player.pos, initial.start)
  assert.equal(player.movement, initial.allowance)
  assert.equal(player.action, true)
})

test('opportunity attacks commit movement even when the player survives', () => {
  const { game, battle, player } = fixture()
  const foe = unitById(battle, 'native-0')
  foe.pos = { x: -7, z: -.1 }
  const before = movementCheckpoint(battle)
  const result = act(game, { type: 'move', at: { x: -10.7, z: 0 } })
  assert.equal(result.ok, true)
  assert.equal(player.hp > 0, true)
  assert.equal(foe.reaction, false)
  assert.equal(reversibleMove(battle, before, result), null)
})

test('capture uses health and status, preserves captured state and rejects enemy summons', () => {
  const { game, battle } = fixture()
  const target = unitById(battle, 'native-3')
  const full = captureChance(target)
  target.hp = 9
  const injured = captureChance(target)
  assert.ok(injured > full)
  target.statuses = { frost: 2 }
  assert.ok(captureChance(target) > injured)
  target.team = 'enemy'
  assert.equal(validate(game, { type: 'capture', target: target.id }).ok, false)
  target.team = 'practice'
  target.hp = 3
  battle.seed = 1
  assert.equal(act(game, { type: 'capture', target: target.id }).ok, true)
  assert.ok(target.dismissed)
  assert.equal(game.collection[0].hp, 3)
  assert.deepEqual(game.collection[0].statuses, { frost: 2 })
})

test('summon, recall and re-summon preserve HP and statuses without refreshing actions', () => {
  const { game, battle, player } = fixture()
  game.collection.push(friend('dino'))
  const place = { x: -7.2, z: 0 }
  assert.ok(act(game, batch({ id: 'friend-1', at: place })).ok)
  const summoned = unitById(battle, 'friend-1')
  assert.equal(summoned.hp, 11)
  assert.equal(summoned.bond, true)
  assert.equal(player.action, true)
  assert.ok(selectAlly(battle, summoned.id))
  assert.ok(act(game, { type: 'recall' }).ok)
  assert.deepEqual(game.collection[0].statuses, { frost: 2 })
  assert.equal(act(game, batch({ id: 'friend-1', at: place })).ok, false)
  assert.equal(game.collection[0].hp, 11)
  assert.deepEqual(game.collection[0].inventory, ['tea', null, null])
  act(game, { type: 'end' })
  while (enemyCanPlay(battle)) enemyTurn(game)
  assert.equal(active(battle).id, 'hero')
  assert.ok(act(game, batch({ id: 'friend-1', at: active(battle).pos.x < -8 ? place : { x: -9.9, z: 0 } })).ok)
  assert.equal(unitById(battle, summoned.id).hp, 11)
})

test('multiple summons work in one turn and low mana releases them', () => {
  const { game, battle, player } = fixture()
  game.collection.push(friend('cat', 'cat'), friend('mouse', 'mouse'))
  player.mana = 16
  const a = { id: 'cat', at: { x: -7.2, z: -1.7 } }
  const b = { id: 'mouse', at: { x: -7.2, z: 1.7 } }
  assert.equal(act(game, batch(a, { ...b, at: a.at })).ok, false)
  assert.equal(act(game, batch(a, a)).ok, false)
  assert.equal(battle.units.some(unit => unit.id === 'cat'), false)
  assert.equal(player.mana, 16)
  assert.ok(act(game, batch(a, b)).ok)
  assert.equal(battle.events.filter(event => event.type === 'summon-batch').length, 1)
  assert.equal(player.mana, 3)
  assert.equal(game.collection.length, 0)
  for (const id of ['cat', 'mouse']) assert.equal(unitById(battle, id).team, 'wild')
})

test('practice XP permits a single evolution and the world healing point restores the team', () => {
  const { game, battle } = fixture()
  const creature = friend('dino')
  game.collection.push(creature)
  assert.ok(act(game, batch({ id: creature.id, at: { x: -7.3, z: 1.6 } })).ok)
  const opponent = unitById(battle, 'native-3')
  opponent.hp = 1
  const command = { type: 'strike', skill: 'ember', target: opponent.id }
  assert.ok(validate(game, command).ok)
  battle.seed = 8192
  act(game, command)
  assert.equal(opponent.hp, 0)
  const saved = game.collection[0]
  assert.ok(saved.xp >= xpForLevel(rules.evolutionLevel))
  const max = stat(saved, 'hp')
  assert.ok(evolve(saved))
  assert.ok(stat(saved, 'hp') > max)
  assert.equal(evolve(saved), false)
  saved.hp = 0
  healParty(game)
  assert.equal(saved.hp, stat(saved, 'hp'))
  assert.deepEqual(saved.statuses, {})
  assert.equal(game.hero.mana, rules.playerMana)
})

test('enemy turns use different tactics from inert training creatures', () => {
  const { game, battle } = fixture('ruin')
  const rival = unitById(battle, 'native-0')
  battle.active = rival.id
  assert.ok(enemyCanPlay(battle))
  enemyTurn(game)
  const summoned = battle.units.filter(u => u.id.startsWith('rival-'))
  assert.ok(summoned.length >= 2)
  assert.ok(summoned.every(unit => unit.team === 'enemy'))
  const practice = unitById(battle, 'native-3')
  const pos = structuredClone(practice.pos)
  battle.active = practice.id
  enemyTurn(game)
  assert.deepEqual(practice.pos, pos)
})

test('versioned saves reload a complete fight snapshot', () => {
  const mock = new Map()
  globalThis.localStorage = { setItem: (k, v) => mock.set(k, v), getItem: k => mock.get(k) }
  const { game } = fixture()
  assert.ok(writeSlot('1', game))
  assert.deepEqual(readSlot('1').game, game)
  const original = structuredClone(game)
  original.items = 3
  original.collection.push(friend('dino'))
  mock.set('fairyland-2026.1', JSON.stringify({ version: 1, at: 30, game: original }))
  const upgraded = readSlot('1')
  assert.equal(upgraded.game.collection.length, 7)
  assert.equal(upgraded.game.collection[0].id, 'friend-1')
  assert.deepEqual(upgraded.game.battle.order, original.battle.order)
  assert.deepEqual(upgraded.game.battle.units[0].inventory, original.battle.units[0].inventory)
  assert.equal(upgraded.game.gold, rules.baseGold + 10)
  assert.ok(writeSlot('1', upgraded.game))
  assert.equal(readSlot('1').game.collection.length, 7)
  mock.set('fairyland-2026.1', '{broken')
  assert.equal(readSlot('1'), null)
  delete globalThis.localStorage
})

test('separate three-slot inventories prevent duplicates and preserve purchases and gear across battle', () => {
  const { game, battle, player } = fixture()
  game.collection.push(friend('dino'))
  const companion = game.collection[0]
  assert.equal(purchase(game, companion, 'buckle'), null)
  assert.ok(purchase(game, companion, 'buckle'))
  assert.equal(placeItem(companion, 'fruit'), null)
  assert.ok(placeItem(companion, 'pebble'))
  const before = player.hp
  player.hp -= 40
  assert.equal(act(game, { type: 'item', item: 'fruit' }).ok, true)
  assert.equal(player.hp, before - 10)
  assert.notEqual(player.inventory, companion.inventory)
  assert.equal(act(game, { type: 'item', item: 'pebble' }).ok, false)
  assert.equal(game.hero.inventory[0], null)
  assert.equal(act(game, batch({ id: companion.id, at: { x: -7.3, z: 1.5 } })).ok, true)
  assert.equal(stat(unitById(battle, companion.id), 'defense'), 14)
})

test('world maps have mandatory first visits, optional revisits, seeded layouts and one-time choices', () => {
  const game = newGame()
  assert.equal(requiresBattle(game, 'ruin'), true)
  assert.equal(requiresBattle(game, 'creek'), true)
  assert.equal(requiresBattle(game, 'glade'), false)
  assert.equal(encounterAt(game, 'market', 11), null)
  assert.deepEqual(encounterAt(game, 'ruin', 11), encounterAt(game, 'ruin', 11))
  assert.notDeepEqual(encounterAt(game, 'ruin', 11), encounterAt(game, 'ruin', 12))
  assert.ok(encounterAt(game, 'ruin', 11).units.some(unit => unit[0] === 'rival'))
  game.cleared.ruin = 1
  assert.equal(requiresBattle(game, 'ruin'), false)
  assert.ok(encounterAt(game, 'ruin', 11).units.every(unit => unit[3] === 'wild'))
  assert.equal(chooseEvent(game, 'lookout', 'gold'), null)
  assert.ok(chooseEvent(game, 'lookout', 'item'))
})

test('a real story victory unlocks an optional revisit and pays the reward once', () => {
  const { game, battle, player } = fixture('ruin')
  const enemy = unitById(battle, 'native-0')
  for (const unit of battle.units) {
    if (unit !== player && unit !== enemy) unit.hp = 0
  }
  enemy.hp = 1
  enemy.pos = { x: -7, z: -.1 }
  battle.seed = 26000
  const gold = game.gold
  assert.equal(requiresBattle(game, 'ruin'), true)
  assert.ok(act(game, { type: 'strike', target: enemy.id, skill: 'attack' }).ok)
  assert.equal(battle.result, 'victory')
  assert.equal(game.cleared.ruin, 1)
  assert.equal(game.gold, gold + battle.reward)
  assert.equal(requiresBattle(game, 'ruin'), false)
  assert.equal(act(game, { type: 'end' }).ok, false)
  assert.equal(game.gold, gold + battle.reward)
  game.battle = null
  assert.ok(startBattle(game, 'ruin', 123))
  assert.ok(game.battle.units.every(unit => unit.kind !== 'rival'))
})

test('area preview uses ground origin, includes friendly fire, and spends the main action exactly once', () => {
  const { game, battle, player } = fixture()
  game.collection.push(friend('dino'))
  assert.ok(act(game, batch({ id: 'friend-1', at: { x: -7, z: 0 } })).ok)
  const ally = unitById(battle, 'friend-1')
  const enemy = unitById(battle, 'native-2')
  ally.pos = { x: -7, z: 1.6 }
  enemy.pos = { x: -5.4, z: .7 }
  assert.ok(selectAlly(battle, ally.id))
  const result = areaAttack(battle, ally, 'roar', enemy.pos)
  assert.ok(result.ok)
  assert.ok(result.attacks.some(hit => hit.target === ally))
  assert.ok(result.attacks.some(hit => hit.target === enemy))
  assert.equal(act(game, { type: 'strike', skill: 'roar', at: enemy.pos }).ok, true)
  assert.equal(act(game, { type: 'strike', skill: 'roar', at: enemy.pos }).ok, false)
  assert.equal(player.summoned, true)
})

test('a lethal opportunity attack stops movement when leaving the threatened radius', () => {
  const { game, battle, player } = fixture()
  const foe = unitById(battle, 'native-0')
  foe.pos = { x: -7, z: -.1 }
  player.hp = 1
  const destination = { x: -10.7, z: -.1 }
  battle.seed = 26000
  const result = act(game, { type: 'move', at: destination })
  assert.ok(result.ok)
  assert.equal(battle.result, 'defeat')
  assert.ok(Math.abs(distance(player.pos, foe.pos) - 2.35) < .01)
  assert.ok(distance(player.pos, destination) > 1)
})

test('all twelve Blender forms and the hero provide exported action clips', async () => {
  const { readFile } = await import('node:fs/promises')
  const files = ['hero', ...Object.keys(species).flatMap(key => [key, key + '-evolved'])]
  for (const file of files) {
    const bytes = await readFile(new URL('../public/art/' + file + '.glb', import.meta.url))
    const root = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))
    assert.ok(root.meshes.length && root.skins.length)
    const all = root.animations.map(a => a.name)
    assert.deepEqual(all.filter(name => !name.startsWith('idle_')).sort(),
      ['appear','attack','capture','caught','death','evolve','hit','idle','skill','summon','walk'])
    const sequence = idleSequence(file, 'inspection', true)
    const behaviors = new Set()
    for (let i = 0; i < 8; i++) {
      const { clip, pause } = sequence.next()
      assert.ok(all.includes(clip) && pause >= 4, file + ':' + clip)
      const animation = root.animations.find(action => action.name === clip)
      assert.ok(animation.channels.some(channel => channel.target.path === 'rotation'), file + ':' + clip)
      behaviors.add(clip)
    }
    assert.deepEqual(all.filter(name => name.startsWith('idle_')).sort(), [...behaviors].sort())
    if (file.startsWith('dog')) {
      assert.ok(['idle_sit','idle_wag','idle_listen'].every(name => behaviors.has(name)))
      assert.equal(root.nodes.filter(node => /^(Shin|Paw)/.test(node.name)).length,8)
    }
  }
})
