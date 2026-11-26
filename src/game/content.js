export const elements = {
  water: { name: '水', symbol: '≈', color: '#68c6e9', beats: 'fire' },
  fire: { name: '火', symbol: '♨', color: '#ff9977', beats: 'ice' },
  earth: { name: '地', symbol: '◈', color: '#e5b277', beats: 'thunder' },
  thunder: { name: '雷', symbol: 'ϟ', color: '#efd67a', beats: 'water' },
  ice: { name: '冰', symbol: '❋', color: '#b4dfff', beats: 'wind' },
  wind: { name: '風', symbol: '✧', color: '#9ae1ae', beats: 'earth' },
}

export const rules = {
  board: { minX: -12, maxX: 12, minZ: -8, maxZ: 8 },
  bodyRadius: 0.43, summonRange: 3.5, captureRange: 7, captureMana: 3, tetherMana: 5,
  playerMana: 38, manaRecovery: 5, itemSlots: 3, baseGold: 36,
  maxLevel: 8, evolutionLevel: 3, matchSpell: 1.2, matchSummon: 1.15,
}

export const balance = {
  elements: { advantage: 1.5, disadvantage: .75 },
  armorScale: 60, die: 20, initiativeDie: 4, rush: 1,
  growth: { hp: 7, attack: 2, defense: .35, aim: .35, move: .15 },
  evolution: { hp: 1.24, other: 1.16 },
  practice: { hp: .32, defense: .72, other: .65, xp: 170 },
  capture: { base: -1.4, missing: 4.0, rarity: 2.8, practice: 2.25, min: .08, max: .97 },
  experience: { base: 50, exponent: 1.55, rival: 125 },
}

export const items = {
  fruit: { name: '回復果', type: '消耗品', icon: '✚', text: '回復自身 30 生命。', heal: 30, price: 9 },
  tea: { name: '薄荷茶', type: '消耗品', icon: '≈', text: '解除自身所有異常狀態。', cleanse: true, price: 12 },
  pebble: { name: '暖光石', type: '特殊道具', icon: '✦', text: '莉歐使用後回復 12 魔力。', mana: 12, price: 15 },
  buckle: { name: '鐵木扣', type: '裝備', icon: '◈', text: '攜帶時增加 2 防禦。', stats: { defense: 2 }, price: 21 },
  feather: { name: '輕羽', type: '裝備', icon: '✧', text: '攜帶時增加 1.2 m 移動。', stats: { move: 1.2 }, price: 22 },
}

export const starterItems = { hero: ['fruit', 'pebble'], creature: ['fruit'] }

export const status = {
  burn: { name: '灼傷', duration: 3, dot: 4, capture: .34 },
  soaked: { name: '潮濕', duration: 3, defense: -2, capture: .22 },
  root: { name: '纏足', duration: 2, move: .55, capture: .45 },
  daze: { name: '麻痺', duration: 2, accuracy: -3, capture: .53 },
  frost: { name: '霜寒', duration: 3, move: .7, capture: .31 },
  gust: { name: '失衡', duration: 2, defense: -2, capture: .22 },
}

export const hero = {
  name: '莉歐', className: '餘燼召喚師', element: 'fire', hp: 156, attack: 15, defense: 13, aim: 8,
  move: 8.5, initiative: 9, skill: 'ember', asset: 'hero', byline: '她從爐火旁出發，去聽森林深處的回聲。',
}

export const skills = {
  attack: { name: '普通攻擊', range: 2.35, power: 9, dice: [2, 4], accuracy: 1, melee: true },
  ember: { name: '小焰彈', element: 'fire', range: 11, power: 19, dice: [2, 6], accuracy: 1, mana: 4, status: 'burn' },
  tide: { name: '泡泡潮', element: 'water', range: 8.5, power: 12, dice: [2, 5], accuracy: 2, status: 'soaked' },
  roar: { name: '熔星吼', element: 'fire', range: 5, radius: 2.4, power: 12, dice: [2, 5], accuracy: 0, status: 'burn' },
  stone: { name: '苔石絆', element: 'earth', range: 6.5, radius: 2.05, power: 10, dice: [2, 4], accuracy: 1, status: 'root' },
  gale: { name: '迴羽風', element: 'wind', range: 10, power: 12, dice: [2, 4], accuracy: 2, status: 'gust' },
  spark: { name: '跳跳電', element: 'thunder', range: 8, power: 13, dice: [2, 5], accuracy: 0, status: 'daze' },
  frost: { name: '薄霜牙', element: 'ice', range: 2.55, power: 17, dice: [2, 5], accuracy: 1, status: 'frost' },
}

export const species = {
  turtle: { name: '泡泡龜', evolved: '潮背龜', form: '烏龜', element: 'water', hp: 71, attack: 9, defense: 16, aim: 5, move: 5, initiative: 2, summon: 8, xp: 65, rarity: .08, skill: 'tide' },
  dino:   { name: '炭炭龍', evolved: '熔星龍', form: '恐龍', element: 'fire', hp: 65, attack: 13, defense: 12, aim: 6, move: 6.5, initiative: 4, summon: 8, xp: 78, rarity: .16, skill: 'roar' },
  cat:    { name: '苔苔貓', evolved: '森冠貓', form: '貓', element: 'earth', hp: 55, attack: 11, defense: 13, aim: 6, move: 8, initiative: 6, summon: 7, xp: 70, rarity: .05, skill: 'stone' },
  bird:   { name: '風鈴鳥', evolved: '晴翼鳥', form: '鳥', element: 'wind', hp: 47, attack: 11, defense: 11, aim: 7, move: 9.5, initiative: 7, summon: 7, xp: 73, rarity: .14, skill: 'gale' },
  mouse:  { name: '電栗鼠', evolved: '閃尾鼠', form: '鼠', element: 'thunder', hp: 44, attack: 11, defense: 11, aim: 7, move: 8.5, initiative: 8, summon: 6, xp: 60, rarity: .1, skill: 'spark' },
  dog:    { name: '雪耳犬', evolved: '霜脊犬', form: '狗', element: 'ice', hp: 63, attack: 13, defense: 13, aim: 6, move: 7.5, initiative: 5, summon: 8, xp: 74, rarity: .12, skill: 'frost' },
}

export const obstacles = [
  { x: -1.9, z: .8, radius: 1.28, height: 1.6 },
  { x: 5.1, z: -2.7, radius: 1.6, height: 2.3 },
  { x: -4.5, z: -5.2, radius: 1.02, height: 1.4 },
  { x: 5.8, z: 4.1, radius: 1.5, height: 1.6 },
]

export const waypointTypes = {
  heal: { label: '治療點', icon: '✧' }, main: { label: '主線', icon: '◆' },
  side: { label: '支線', icon: '◇' }, battle: { label: '普通戰役', icon: '✦' },
  shop: { label: '商店', icon: '○' }, event: { label: '旅途事件', icon: '☼' },
}

export const waypoints = {
  camp: { name: '月泉營地', type: 'heal', x: -7.7, z: 4.2, text: '月泉會回復莉歐與精靈的生命與魔力，並解除異常。' },
  glade: { name: '微光林地', type: 'battle', x: -.3, z: -.2, layout: 'practice', reward: 18,
    text: '三隻活躍的野生精靈守著林地。練習精靈不會移動，擊倒牠們可快速累積經驗。' },
  ruin: { name: '月門遺跡', type: 'main', x: 8.2, z: -5.7, layout: 'rival', revisit: 'wood', reward: 30,
    text: '守林人在月門攔路，初次到訪會觸發戰鬥。完成後可自由選擇重訪的普通戰役。' },
  creek: { name: '鈴音溪', type: 'side', x: -7.3, z: -4.1, layout: 'protect', revisit: 'wood', reward: 24,
    text: '溪邊有精靈守著漂走的鈴鐺，初次到訪會觸發戰鬥。' },
  market: { name: '蘑菇小攤', type: 'shop', x: 4.4, z: 5.7,
    text: '樹根旁的小攤販售食物、護具與暖光石。買下後會放入指定角色的空格。' },
  lookout: { name: '風信坡', type: 'event', x: 3.3, z: -5.3,
    text: '坡頂有被風吹落的果籃和幾枚古錢。你可以挑一樣帶走。', event: { gold: 12, item: 'tea' } },
}

export const encounters = {
  practice: [
    ['turtle', -.1, -3.3, 'wild'], ['mouse', 3.2, 1.7, 'wild'], ['cat', 2.6, -4.7, 'wild'],
    ['dino', -3.9, 3.4, 'practice'], ['bird', 8.5, 1.3, 'practice'], ['dog', .5, 5.8, 'practice'],
  ],
  rival: [
    ['rival', 4.2, -4.0, 'enemy'], ['bird', -2.7, -2.4, 'wild'],
    ['dog', 2.8, 3.7, 'wild'], ['turtle', -.4, 5.9, 'practice'],
  ],
  protect: [
    ['mouse', -4.7, -2.2, 'wild'], ['cat', .5, 4.0, 'wild'], ['turtle', 5.8, -5.3, 'wild'],
  ],
  wood: [
    ['cat', -.1, -3.3, 'wild'], ['dino', 3.2, 1.7, 'wild'], ['dog', 2.7, -4.8, 'wild'], ['bird', .5, 5.8, 'wild'],
  ],
}

export const encounterTuning = { jitter: .82, revisitReward: 15, rivalHP: 89, rivalMana: 29, rivalRoster: ['dino', 'turtle', 'cat'] }

export const xpForLevel = level => Math.round(balance.experience.base * (level - 1) ** balance.experience.exponent)
export const titleOf = unit => unit.kind === 'hero' ? hero.name : unit.kind === 'rival' ? '守林人' :
  species[unit.kind][unit.evolved ? 'evolved' : 'name']
