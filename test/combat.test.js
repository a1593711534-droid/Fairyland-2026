import test from 'node:test'
import assert from 'node:assert/strict'
import { elements, obstacles, rules, species, xpForLevel } from '../src/game/content.js'
import { active, act, captureChance, evolve, forecast, healParty, modifier, movementReactions,
  selectAlly, startBattle, stat, unitById, validate } from '../src/game/combat.js'
import { enemyCanPlay, enemyTurn } from '../src/game/ai.js'
import { distance, router } from '../src/game/geometry.js'
import { newGame, readSlot, writeSlot } from '../src/game/save.js'

function fixture(map = 'glade') {
  const game = newGame()
  const battle = startBattle(game, map, 22211)
  battle.active = 'hero'
  return { game, battle, player: active(battle) }
}

const friend = (kind, id = 'friend-1') => ({
  id, kind, hp: 11, xp: 51, level: 2, evolved: false, statuses: { frost: 2 }, practice: false,
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
  assert.ok(act(game, { type: 'summon', id: 'friend-1', at: place }).ok)
  const summoned = unitById(battle, 'friend-1')
  assert.equal(summoned.hp, 11)
  assert.equal(summoned.bond, true)
  assert.equal(player.action, true)
  assert.ok(selectAlly(battle, summoned.id))
  assert.ok(act(game, { type: 'recall' }).ok)
  assert.deepEqual(game.collection[0].statuses, { frost: 2 })
  assert.ok(act(game, { type: 'summon', id: 'friend-1', at: place }).ok)
  assert.equal(unitById(battle, summoned.id).done, true)
  assert.equal(unitById(battle, summoned.id).hp, 11)
})

test('multiple summons work in one turn and low mana releases them', () => {
  const { game, battle, player } = fixture()
  game.collection.push(friend('cat', 'cat'), friend('mouse', 'mouse'))
  player.mana = 16
  assert.ok(act(game, { type: 'summon', id: 'cat', at: { x: -7.2, z: -1.7 } }).ok)
  assert.ok(act(game, { type: 'summon', id: 'mouse', at: { x: -7.2, z: 1.7 } }).ok)
  assert.equal(player.mana, 3)
  assert.equal(game.collection.length, 0)
  for (const id of ['cat', 'mouse']) assert.equal(unitById(battle, id).team, 'wild')
})

test('practice XP permits a single evolution and the world healing point restores the team', () => {
  const { game, battle } = fixture()
  const creature = friend('dino')
  game.collection.push(creature)
  assert.ok(act(game, { type: 'summon', id: creature.id, at: { x: -7.3, z: 1.6 } }).ok)
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
  mock.set('fairyland-2026.1', '{broken')
  assert.equal(readSlot('1'), null)
  delete globalThis.localStorage
})

test('all twelve Blender forms and the hero provide exported action clips', async () => {
  const { readFile } = await import('node:fs/promises')
  const files = ['hero', ...Object.keys(species).flatMap(key => [key, key + '-evolved'])]
  for (const file of files) {
    const bytes = await readFile(new URL('../public/art/' + file + '.glb', import.meta.url))
    const root = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))
    assert.ok(root.meshes.length && root.skins.length)
    assert.deepEqual(root.animations.map(a => a.name).sort(),
      ['appear','attack','capture','caught','death','hit','idle','skill','summon','walk'])
  }
})
