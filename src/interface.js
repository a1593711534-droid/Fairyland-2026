import { items, rules, species, titleOf } from './game/content.js'
import { availableSummons } from './game/summoning.js'

export function button(name, code, { css = '', data = '', disabled = false, title = '' } = {}) {
  return '<button type="button" class="' + css + '" data-do="' + code + '" data-value="' + data + '"' +
    (title ? ' title="' + title + '" aria-label="' + title + '"' : '') + (disabled ? ' disabled' : '') + '>' + name + '</button>'
}

export const goldLine = gold => '<span class="gold">◈ ' + gold + ' 金幣</span>'

export function summonPanel(game, actor, plan, sign, pending) {
  const spent = plan.reduce((sum, entry) => sum + species[game.collection.find(u => u.id === entry.id).kind].summon, 0)
  const budget = actor.mana - spent
  const rows = availableSummons(game, actor).map(unit => {
    const chosen = plan.findIndex(entry => entry.id === unit.id)
    const info = species[unit.kind]
    const label = chosen < 0 ? info.summon + ' MP' : '移除'
    return button('<span>' + sign(info.element, false) + ' <strong>' + titleOf(unit) + '</strong></span><b>' + label + '</b>',
    chosen < 0 ? 'pick-summon' : 'drop-summon', {
      css: 'dialog-row' + (chosen >= 0 ? ' planned' : unit.id === pending ? ' selected' : ''),
      data: unit.id, disabled: chosen < 0 && budget < info.summon,
    })
  }).join('')
  return '<div class="plan-summary"><strong>已配置 ' + plan.length + ' 隻</strong><span>消耗 ' + spent + '　剩餘 ' + budget + ' MP</span></div>' +
    (budget < rules.tetherMana && plan.length ? '<p class="plan-warning">魔力將低於 ' + rules.tetherMana + '，場上夥伴會脫離掌控。</p>' : '') +
    '<div class="inventory-rows">' + (rows || '<p class="muted">沒有可召喚的精靈。</p>') + '</div>' +
    button('召喚 ' + plan.length + ' 隻', 'confirm-summons', { css: 'primary full', disabled: !plan.length, title: '提交召喚（Enter）' })
}

export function kitPanel(unit, { battle = false, problem }) {
  return '<div class="inventory-rows">' + unit.inventory.map((key, i) => {
    const info = items[key]
    if (!info) return '<div class="dialog-row slot-empty"><span>物品格 ' + (i + 1) + '</span><small>空</small></div>'
    const message = problem(unit, key)
    const label = '<span><strong>' + info.icon + ' ' + info.name + '</strong><small>' + info.type +
      '　' + info.text + '</small></span>'
    return '<div class="dialog-row item-row">' + label + '<div>' + (info.stats ?
      '<small>已生效</small>' : button('使用', 'use-item', { data: key, disabled: Boolean(message), title: message ?? '' })) +
      (battle ? '' : button('卸下', 'drop-item', { data: key })) + '</div></div>'
  }).join('') + '</div>'
}

export function shopPanel(game, carriers, chosen, problem) {
  const options = carriers.map(({ id, text }) => button(text, 'shop-target', { data: id, css: 'subtle' + (id === chosen ? ' selected' : '') })).join('')
  const goods = Object.entries(items).map(([key, item]) => {
    const unavailable = problem(key)
    return button('<span><strong>' + item.icon + ' ' + item.name + '</strong><small>' + item.type + '　' + item.text +
      '</small></span><b>' + (unavailable ?? item.price + ' 金幣') + '</b>',
    'buy-item', { data: key, css: 'dialog-row', disabled: Boolean(unavailable) })
  }).join('')
  return goldLine(game.gold) + '<div class="kit-carriers" aria-label="收貨角色">' + options + '</div>' + goods
}
