import { items, rules, starterItems } from './content.js'

export function inventory(keys = []) {
  const valid = [...new Set(keys.filter(key => items[key]))].slice(0, rules.itemSlots)
  return Array.from({ length: rules.itemSlots }, (_, i) => valid[i] ?? null)
}

export const startingInventory = kind => inventory(starterItems[kind === 'hero' ? 'hero' : 'creature'])
export const equipmentBonus = (unit, stat) => (unit.inventory ?? []).reduce((sum, key) => sum + (items[key]?.stats?.[stat] ?? 0), 0)

export function placeItem(unit, key) {
  if (!unit || !items[key]) return '找不到這件物品。'
  if (unit.inventory.includes(key)) return '同一角色只能攜帶一件同名物品。'
  const index = unit.inventory.indexOf(null)
  if (index < 0) return '三格物品欄已滿。'
  unit.inventory[index] = key
  return null
}

export function itemProblem(unit, key, maxHP) {
  const item = items[key]
  if (!item || !unit.inventory?.includes(key)) return '物品已不在欄位中。'
  if (item.stats) return '攜帶這件裝備就會生效。'
  if (!unit.hp) return '倒下後須到月泉治療。'
  if (item.heal && unit.hp >= maxHP) return '生命值已滿。'
  if (item.cleanse && !Object.keys(unit.statuses).length) return '目前沒有異常狀態。'
  if (item.mana && (unit.kind !== 'hero' || unit.mana >= rules.playerMana)) return '莉歐的魔力不足額時才可使用。'
  return null
}

export function consume(unit, key, maxHP) {
  const problem = itemProblem(unit, key, maxHP)
  if (problem) return problem
  const item = items[key]
  if (item.heal) unit.hp = Math.min(maxHP, unit.hp + item.heal)
  if (item.cleanse) { unit.statuses = {}; unit.sources = {} }
  if (item.mana) unit.mana = Math.min(rules.playerMana, unit.mana + item.mana)
  unit.inventory[unit.inventory.indexOf(key)] = null
  return null
}

export function purchase(game, unit, key) {
  const item = items[key]
  if (!item || game.gold < item.price) return '金幣不足。'
  const problem = placeItem(unit, key)
  if (!problem) game.gold -= item.price
  return problem
}
