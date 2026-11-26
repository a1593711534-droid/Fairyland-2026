import './style.css'
import { elements, hero, rules, skills, species, status, titleOf, waypoints, xpForLevel } from './game/content.js'
import { act, active, alliesInTurn, areOpponents, elementOf, evolve, forecast, healParty, isWild, meters,
  percent, movementReactions, selectAlly, skillFor, startBattle, stat, unitById, validate, captureChance } from './game/combat.js'
import { enemyCanPlay, enemyTurn } from './game/ai.js'
import { distance, movementBlocks, router } from './game/geometry.js'
import { latest, newGame, readSettings, readSlot, slots, writeSettings, writeSlot } from './game/save.js'
import { Stage } from './render/stage.js'

const app = document.querySelector('#app')
app.innerHTML = '<div id="stage" hidden></div><div id="ui"></div><div id="tags"></div><div id="dialog"></div><div id="toast" role="status" aria-live="polite"></div>'
const ui = document.querySelector('#ui')
const tags = document.querySelector('#tags')
const dialog = document.querySelector('#dialog')
const toast = document.querySelector('#toast')
let scene = 'menu'
let game = null
let modal = ''
let settings = readSettings()
let targetMode = 'move'
let pendingSummon = null
let worldPoint = null
let busy = false
let hoverRouter = null
let toastTimer
let audio
let focusId = null
let inspectReturn = null
let selectWorldToken = 0
let stage

const assetKey = u => u.kind === 'rival' ? 'hero' : u.kind + (u.evolved ? '-evolved' : '')
const nodeName = key => waypoints[key]?.name ?? '微光林地'
const sign = (id, label = true) => {
  const e = elements[id]
  return '<span class="element" style="--element:' + e.color + '" title="' + e.name + '屬性">' + e.symbol + (label ? ' <span>' + e.name + '</span>' : '') + '</span>'
}
const brand = '<div class="brand"><span class="brand-mark">✧</span><span>FAIRYLAND</span></div>'
const audioToggle = () => button(settings.volume ? '◖))' : '◖×', 'sound', { css: 'icon', title: settings.volume ? '靜音' : '開啟音效' })

function button(name, code, { css = '', data = '', disabled = false, title = '' } = {}) {
  return '<button type="button" class="' + css + '" data-do="' + code + '" data-value="' + data + '"' +
    (title ? ' title="' + title + '" aria-label="' + title + '"' : '') + (disabled ? ' disabled' : '') + '>' + name + '</button>'
}

function notify(message) {
  clearTimeout(toastTimer)
  toast.textContent = message
  toast.classList.add('show')
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3100)
}

function sound(type = 'tap') {
  if (!settings.volume) return
  const Audio = window.AudioContext ?? window.webkitAudioContext
  if (!Audio) return
  try {
    audio ??= new Audio()
    if (audio.state === 'suspended') void audio.resume().catch(() => {})
    const notes = { tap: [440, 660], move: [244, 330], cast: [340, 550, 820], impact: [142, 220], reward: [392, 523, 659, 784] }
    const now = audio.currentTime
    notes[type].forEach((note, i) => {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = type === 'impact' ? 'triangle' : 'sine'
      osc.frequency.setValueAtTime(note, now + i * .052)
      gain.gain.setValueAtTime(.0001, now + i * .052)
      gain.gain.exponentialRampToValueAtTime(settings.volume * .074, now + i * .052 + .022)
      gain.gain.exponentialRampToValueAtTime(.0001, now + i * .052 + .26)
      osc.connect(gain).connect(audio.destination)
      osc.start(now + i * .052)
      osc.stop(now + i * .052 + .28)
    })
  } catch { /* Sound is optional on browsers that restrict audio contexts. */ }
}

function save() {
  if (game && !writeSlot('auto', game)) notify('瀏覽器無法儲存進度。')
}

function setScene(next) {
  scene = next
  modal = ''
  tags.replaceChildren()
  targetMode = 'move'
  pendingSummon = null
  hoverRouter = null
  if (next !== 'menu' && !stage) {
    try {
      stage = new Stage(document.querySelector('#stage'), {
        frame: projectTags, click: stageClick, hover: stageHover, error: () => notify('3D 資源載入失敗，請重新整理後再試。'),
      })
    } catch {
      notify('此瀏覽器無法啟用 WebGL 2。')
      scene = 'menu'
      render()
      return
    }
  }
  stage?.setMode(next)
  if (next === 'choose') stage.bind('preview', 'hero', { x: .78, z: 0 }, { angle: -.14 })
  if (next === 'world') {
    worldPoint = game.world
    stage.bind('map-hero', 'hero', waypoints[game.world], { scale: .82, angle: 1.27 })
  }
  if (next === 'battle') syncModels()
  if (next === 'inspect') {
    const unit = game.collection.find(u => u.id === focusId)
    if (unit) stage.bind('collection-view', assetKey(unit), { x: .78, z: 0 }, { angle: -.22 })
  }
  render()
}

function resume(entry) {
  if (!entry) return
  game = structuredClone(entry.game)
  setScene(game.battle ? 'battle' : 'world')
  if (game.battle) void advanceEnemies()
}

function renderMenu() {
  const saved = Boolean(latest())
  ui.innerHTML = '<section class="title-screen"><header class="topbar">' + brand + '<div class="top-right">' +
    audioToggle() + '</div></header><div class="title-content"><div class="eyebrow"><i></i> FAIRYLAND CHRONICLES</div>' +
    '<h1>精靈幻境<span>2026</span></h1><p class="title-sub">在精靈仍低聲說話的年代。</p><nav aria-label="主選單" class="title-nav">' +
    button('繼續遊戲 <b>↗</b>', 'continue', { css: 'menu-entry' + (saved ? ' primary' : ''), disabled: !saved }) +
    button('新遊戲 <b>↗</b>', 'new', { css: 'menu-entry' + (saved ? '' : ' primary') }) +
    button('讀取存檔 <b>↗</b>', 'load', { css: 'menu-entry' }) +
    button('設定 <b>↗</b>', 'settings', { css: 'menu-entry' }) +
    button('說明 <b>↗</b>', 'help', { css: 'menu-entry' }) +
    '</nav></div><footer class="title-footer"><div><span class="live-dot"></span> 測試版 <span class="footer-divider"></span> v0.1.0</div>' +
    '<div class="scene-caption"><span>✦</span> 微光林地</div></footer></section>'
}

function renderChoose() {
  ui.innerHTML = '<section class="overlay character-screen"><header class="topbar">' + brand +
    button('← 主選單', 'menu', { css: 'subtle' }) + '</header><div class="character-copy"><div class="eyebrow"><i></i> 選擇角色</div>' +
    '<h1>' + hero.name + '</h1><div class="character-class">' + sign(hero.element) + ' <span>' + hero.className + '</span></div>' +
    '<p>' + hero.byline + '</p><dl class="character-stats"><div><dt>生命</dt><dd>' + hero.hp + '</dd></div><div><dt>魔力</dt><dd>' + rules.playerMana +
    '</dd></div><div><dt>移動</dt><dd>' + hero.move + ' m</dd></div></dl>' +
    button('踏上旅程 <b>↗</b>', 'start', { css: 'primary large' }) + '</div></section>'
}

function renderWorld() {
  const stop = waypoints[worldPoint]
  ui.innerHTML = '<section class="overlay world-screen"><header class="topbar">' + brand + '<div class="top-right">' +
    button('精靈手冊', 'collection', { css: 'subtle' }) + button('存檔', 'save', { css: 'subtle' }) +
    button('選單', 'pause', { css: 'subtle' }) + '</div></header><div class="world-title"><div class="eyebrow"><i></i> 大地圖</div><h1>月見森林</h1></div>' +
    '<aside class="world-card"><div class="eyebrow">' + stop.type + '</div><h2>' + stop.name + '</h2><p>' + stop.text + '</p>' +
    (worldPoint === 'camp' ? button('在月泉休息 <b>✧</b>', 'heal', { css: 'primary full', disabled: busy }) :
      button('進入戰場 <b>↗</b>', 'enter', { css: 'primary full', disabled: busy || !game.hero.hp })) + '</aside>' +
    '<footer class="map-footer"><span>拖曳右鍵旋轉　／　滾輪縮放</span><span>戰鬥勝利 ' + game.wins + ' 場</span></footer></section>'
  tags.innerHTML = Object.entries(waypoints).map(([key, node]) => '<div class="tag waypoint" data-node="' + key + '">' +
    button('<span class="waypoint-icon">' + ({ camp: '✧', glade: '✦', ruin: '◈' }[key]) + '</span><span>' + node.name + '</span>',
      'walk', { css: key === worldPoint ? 'selected' : '', data: key }) + '</div>').join('')
}

function card(actor) {
  const max = stat(actor, 'hp')
  const info = actor.kind === 'hero' ? ' • ' + hero.className : ' • Lv. ' + actor.level
  return '<div class="fighter"><div class="fighter-line">' + sign(elementOf(actor), false) + '<strong>' + titleOf(actor) +
    '</strong><span class="muted">' + info + '</span></div>' +
    '<div class="meter"><i style="width:' + actor.hp / max * 100 + '%"></i><span>生命　' + actor.hp + ' / ' + max + '</span></div>' +
    (actor.kind === 'hero' ? '<div class="meter mana"><i style="width:' + actor.mana / rules.playerMana * 100 + '%"></i><span>魔力　' +
      actor.mana + ' / ' + rules.playerMana + '</span></div>' : '') +
    '<div class="fighter-line resources"><span>移動 ' + meters(actor.movement) + '</span><span class="' + (actor.action ? 'ready' : '') +
    '">● 主要行動</span><span class="' + (actor.bonus ? 'ready' : '') + '">◆ 附贈行動</span></div></div>'
}

const turnName = unit => unit.team === 'ally' ? '我方' : unit.team === 'enemy' ? '敵方' : unit.practice ? '練習' : '野生'
const shortStatus = unit => Object.keys(unit.statuses).map(key => status[key].name).join('・')

function renderBattle() {
  const b = game.battle
  const actor = active(b)
  const canAct = actor.team === 'ally' && !busy && !b.result
  const group = alliesInTurn(b)
  const summonable = game.collection.some(unit => unit.hp > 0 && !b.units.some(u => u.id === unit.id && !u.dismissed))
  const action = (label, code, isDisabled = false, data = code) => button(label, code, {
    css: 'action' + (targetMode === data ? ' selected' : ''), disabled: !canAct || isDisabled, data,
  })
  ui.innerHTML = '<section class="overlay battle-screen"><header class="topbar"><div><div class="eyebrow">' + nodeName(b.map) +
    '</div><h2 class="round">第 ' + b.round + ' 回合</h2></div><div class="initiative" aria-label="先攻順序">' +
    b.order.map(id => unitById(b, id)).filter(unit => unit.hp && !unit.dismissed)
      .map(unit => button(sign(elementOf(unit), false) + '<span>' + titleOf(unit) + '</span>', 'select', {
        css: 'initiative-unit ' + unit.team + (unit.id === actor.id ? ' current' : '') + (unit.done ? ' done' : ''),
        data: unit.id, disabled: !canAct || !group.includes(unit),
      })).join('') + '</div><div class="top-right">' + button('存檔', 'save', { css: 'subtle', disabled: busy }) +
      button('選單', 'pause', { css: 'subtle', disabled: busy }) + '</div></header>' +
    '<div class="battle-phase"><span class="live-dot"></span>' + (busy ? '行動結算中' : turnName(actor) + '回合') + '</div>' +
    '<div id="preview"></div><div class="combat-log" aria-live="polite">' +
    b.events.filter(event => event.type === 'text').slice(-3).map(event => '<div>' + event.text + '</div>').join('') + '</div>' +
    '<footer class="battle-footer">' + card(actor) +
    '<div class="toolbar"><div class="toolbar-actions">' + action('↗ 移動', 'mode', false, 'move') +
    action('† 攻擊', 'mode', !actor.action, 'attack') + action('脫離', 'disengage', !actor.action) + action(sign(elementOf(actor), false) + ' ' + skills[skillFor(actor)].name, 'mode',
      !actor.action || actor.mana < (skills[skillFor(actor)].mana ?? 0), 'skill') +
    (actor.kind === 'hero' ? action('✧ 召喚', 'summons', !summonable) + action('◎ 收服', 'mode', !actor.action || actor.mana < rules.captureMana, 'capture') :
      action('↶ 撤回', 'recall', false)) + action('✚ 回復果 ×' + game.items, 'item', !actor.bonus || !game.items || actor.hp >= stat(actor, 'hp')) +
    button('狀態', 'status', { css: 'action', disabled: busy }) + '</div><p class="action-hint">' + hint() + '</p></div>' +
    button('待機 <b>→</b>', 'end', { css: 'primary end-turn', disabled: !canAct }) + '</footer></section>'
  tags.innerHTML = settings.labels || ['attack', 'skill', 'capture'].includes(targetMode)
    ? b.units.filter(u => u.hp > 0 && !u.dismissed).map(u => {
      const selected = u.id === actor.id
      const preview = targetPreview(u)
      return '<div class="tag unit-tag ' + u.team + (selected ? ' active' : '') + '" data-unit="' + u.id + '">' +
        button('<span class="unit-title">' + sign(elementOf(u), false) + titleOf(u) +
          (u.team === 'practice' ? '<small>練習</small>' : '') + (preview ? '<small>' + preview + '</small>' : '') +
          '</span><span class="tiny-hp"><i style="width:' + (u.hp / stat(u, 'hp') * 100) + '%"></i></span>',
        'unit', { data: u.id, title: titleOf(u) + '，' + u.hp + ' 生命' + (shortStatus(u) ? '，' + shortStatus(u) : '') }) + '</div>'
    }).join('') : ''
}

function hint() {
  if (busy) return '行動結算中'
  if (targetMode === 'move') return '點擊地面移動。右鍵旋轉，滾輪縮放。'
  if (targetMode === 'summon') return '選擇法陣範圍內的空地。Esc 取消。'
  if (targetMode === 'capture') return '選擇野生精靈。降低血量或施加異常可提高成功率。'
  return '點選目標確認攻擊。名稱旁顯示命中率或不可攻擊的原因。'
}

function targetPreview(unit) {
  if (busy || !['attack', 'skill', 'capture'].includes(targetMode)) return ''
  const actor = active(game.battle)
  if (!areOpponents(actor, unit)) return ''
  if (targetMode === 'capture') {
    if (!isWild(unit)) return '不可收服'
    return validate(game, { type: 'capture', target: unit.id }).ok ? percent(captureChance(unit)) : '無法觸及'
  }
  const f = forecast(actor, unit, targetMode === 'attack' ? 'attack' : skillFor(actor))
  if (f.distance > f.range) return '太遠'
  if (!f.clear) return '掩體'
  return percent(f.accuracy)
}

function renderInspect() {
  const unit = game.collection.find(u => u.id === focusId)
  const next = !unit.evolved && unit.level >= rules.evolutionLevel
  ui.innerHTML = '<section class="overlay character-screen"><header class="topbar">' + brand +
    button('← 精靈手冊', 'inspect-back', { css: 'subtle' }) + '</header><div class="character-copy"><div class="eyebrow"><i></i> 精靈手冊</div><h1>' +
    titleOf(unit) + '</h1><div class="character-class">' + sign(elementOf(unit)) + ' <span>Lv. ' + unit.level + '</span></div><p>' +
    species[unit.kind].form + '　/　' + skills[species[unit.kind].skill].name + '　/　' + (unit.evolved ? '已進化' : 'Lv. ' + rules.evolutionLevel + ' 可進化') +
    '</p><dl class="character-stats"><div><dt>生命</dt><dd>' + unit.hp + ' / ' + stat(unit, 'hp') + '</dd></div><div><dt>經驗</dt><dd>' + unit.xp +
    (unit.level < rules.maxLevel ? ' / ' + xpForLevel(unit.level + 1) : '') + '</dd></div></dl>' +
    (next ? button('進化為 ' + species[unit.kind].evolved + ' <b>✧</b>', 'evolve', { css: 'primary large' }) : '') + '</div></section>'
}

function render() {
  document.body.classList.toggle('reduced', settings.reduced)
  if (scene === 'menu') renderMenu()
  if (scene === 'choose') renderChoose()
  if (scene === 'world') renderWorld()
  if (scene === 'battle') renderBattle()
  if (scene === 'inspect') renderInspect()
  renderModal()
  refreshMarks()
}

function renderModal() {
  ui.inert = Boolean(modal)
  tags.inert = Boolean(modal)
  if (!modal) { dialog.replaceChildren(); return }
  let title = ''
  let body = ''
  if (modal === 'settings') {
    title = '設定'
    body = '<label class="setting"><span>音效音量</span><input type="range" id="volume" min="0" max="1" step=".05" value="' +
      settings.volume + '"></label><label class="setting"><span>簡化動畫與特效</span><input type="checkbox" id="reduced"' +
      (settings.reduced ? ' checked' : '') + '></label><label class="setting"><span>顯示戰場名稱</span><input type="checkbox" id="labels"' +
      (settings.labels ? ' checked' : '') + '></label>'
  }
  if (modal === 'help') {
    title = '玩法說明'
    body = '<div class="guide"><h3>移動與行動</h3><p>點地面移動。點選攻擊或法術後，再點目標。行動與移動距離分開計算，待機才交給下一位。離開敵人的近戰範圍會引來借機攻擊，可先用主要行動脫離。</p>' +
      '<h3>召喚與收服</h3><p>莉歐可在同一回合耗魔召喚多隻夥伴。魔力低於 ' + rules.tetherMana +
      ' 時，場上夥伴會變回野生。野生精靈生命愈低、異常愈多，收服機率愈高。回到月泉可回復生命與魔力。</p>' +
      '<h3>屬性與進化</h3><p>水克火、火克冰、冰克風、風克地、地克雷、雷克水。同屬性施法有加成，莉歐召喚火屬性精靈也有加成。召喚上場的夥伴可獲經驗，Lv. ' +
      rules.evolutionLevel + ' 可從手冊進化。</p><p><kbd>Esc</kbd> 取消或開啟選單　<kbd>Space</kbd> 待機</p></div>'
  }
  if (modal === 'save' || modal === 'load') {
    const loading = modal === 'load'
    title = loading ? '讀取存檔' : '儲存遊戲'
    body = slots.filter(slot => loading || slot !== 'auto').map(slot => {
      const entry = readSlot(slot)
      const label = slot === 'auto' ? '自動存檔' : '存檔 ' + slot
      return button('<span><strong>' + label + '</strong><small>' +
        (entry ? (entry.game.battle ? '戰鬥中' : nodeName(entry.game.world)) + ' ・ ' + new Date(entry.at).toLocaleString('zh-TW') : '空欄位') +
        '</small></span><b>' + (loading ? '↗' : '↓') + '</b>', loading ? 'load-slot' : 'save-slot',
      { css: 'dialog-row', data: slot, disabled: loading && !entry })
    }).join('')
  }
  if (modal === 'pause') {
    title = '遊戲選單'
    body = button('繼續遊戲 <b>↗</b>', 'close', { css: 'dialog-row' }) +
      button('儲存遊戲 <b>↗</b>', 'save', { css: 'dialog-row' }) +
      button('設定 <b>↗</b>', 'settings', { css: 'dialog-row' }) +
      button('說明 <b>↗</b>', 'help', { css: 'dialog-row' }) +
      button('返回主選單 <b>↗</b>', 'menu', { css: 'dialog-row' })
  }
  if (modal === 'collection' || modal === 'summons') {
    const summoning = modal === 'summons'
    title = summoning ? '召喚精靈' : '精靈手冊'
    const available = summoning ? game.collection.filter(u => u.hp > 0 &&
      !game.battle.units.some(onField => u.id === onField.id && !onField.dismissed)) : game.collection
    body = available.map(unit => button('<span>' + sign(elementOf(unit), false) + ' <strong>' + titleOf(unit) +
      '</strong><small> Lv. ' + unit.level + '　生命 ' + unit.hp + ' / ' + stat(unit, 'hp') +
      (shortStatus(unit) ? '　' + shortStatus(unit) : '') + '</small></span><b>' +
      (summoning ? '魔力 ' + species[unit.kind].summon : unit.evolved ? '已進化' : unit.level >= rules.evolutionLevel ? '可進化 ✧' : '↗') + '</b>',
    summoning ? 'pick-summon' : 'inspect', {
      css: 'dialog-row', data: unit.id, disabled: summoning && active(game.battle).mana < species[unit.kind].summon,
    })).join('') || '<p class="muted">在戰場收服野生精靈後，就能在這裡查看。</p>'
  }
  if (modal === 'status') {
    const unit = active(game.battle)
    title = titleOf(unit) + '的狀態'
    body = card(unit) + '<div class="guide"><p>攻擊 ' + stat(unit, 'attack') + '　／　防禦 ' + stat(unit, 'defense') + '　／　命中加值 ' + stat(unit, 'aim') + '</p>' +
      (Object.keys(unit.statuses).length ? Object.entries(unit.statuses).map(([key, n]) => '<p>' + status[key].name + '　剩餘 ' + n + ' 回合</p>').join('') :
        '<p>沒有異常狀態。</p>') + '</div>'
  }
  if (modal === 'result') {
    const victory = game.battle.result === 'victory'
    title = victory ? '戰鬥勝利' : '撤退'
    body = '<p class="muted">' + (victory ? '林地暫時恢復平靜。夥伴會帶著目前的生命值與異常狀態返回手冊。' :
      '莉歐倒下了。回到月泉營地可以治療隊伍，再次挑戰。') + '</p>' +
      button('返回大地圖 <b>↗</b>', 'leave-battle', { css: 'primary full' })
  }
  dialog.innerHTML = '<div class="modal-shade"><section class="dialog-panel" role="dialog" aria-modal="true" aria-label="' + title + '">' +
    '<header><h2>' + title + '</h2>' + (modal === 'result' ? '' : button('×', 'close', { css: 'icon', title: '關閉' })) + '</header>' +
    '<div class="dialog-body">' + body + '</div></section></div>'
}

function syncModels() {
  if (!stage || !game?.battle) return
  for (const u of game.battle.units) {
    if (u.dismissed) { stage.remove(u.id); continue }
    stage.bind(u.id, assetKey(u), u.pos, {
      scale: u.practice ? .86 : 1, angle: u.team === 'ally' ? 1.13 : -.65,
      tint: u.kind === 'rival' ? '#d7a8ef' : null, dead: !u.hp,
    })
  }
}

function projectTags(renderer) {
  for (const tag of tags.children) {
    const u = tag.dataset.unit && unitById(game.battle, tag.dataset.unit)
    const pivot = u && renderer.units.get(u.id)?.pivot.position
    const node = waypoints[tag.dataset.node]
    if (!pivot && !node) continue
    const at = renderer.project(pivot ?? node, node ? .38 : u.kind === 'hero' || u.kind === 'rival' ? 2.65 : u.evolved ? 2.85 : 2.05)
    tag.style.transform = 'translate(' + at.x.toFixed(1) + 'px,' + at.y.toFixed(1) + 'px) translate(-50%,-100%)'
    tag.style.visibility = at.show ? 'visible' : 'hidden'
  }
}

function refreshMarks() {
  if (!stage || scene !== 'battle') return
  stage.clearMarks()
  stage.clearHover()
  const b = game.battle
  if (!b || b.result) return
  for (const unit of b.units) {
    if (!unit.hp || unit.dismissed) continue
    stage.mark(unit.pos, unit.id === b.active ? .68 : .51,
      unit.id === b.active ? '#f3deaa' : unit.team === 'ally' ? '#8adab4' : unit.team === 'enemy' ? '#fa8e80' : '#c5ad77')
  }
  const actor = active(b)
  if (busy || actor.team !== 'ally') return
  const range = { capture: rules.captureRange, summon: rules.summonRange,
    attack: skills.attack.range, skill: skills[skillFor(actor)].range }[targetMode]
  if (range) stage.mark(actor.pos, range, '#ebce92', true)
}

function stageHover(pos) {
  if (!pos) {
    const label = document.querySelector('#preview')
    if (label) label.textContent = ''
    return
  }
  if (busy || modal || scene !== 'battle' || game.battle.result) return
  const b = game.battle
  const actor = active(b)
  if (actor.team !== 'ally') return
  if (targetMode === 'summon') {
    const check = validate(game, { type: 'summon', id: pendingSummon, at: pos })
    stage.path(null, pos, check.ok)
    return
  }
  if (targetMode !== 'move') return
  hoverRouter ??= router(actor.pos, movementBlocks(b.units.filter(u => !u.dismissed), actor))
  const path = hoverRouter(pos)
  const risk = path && movementReactions(b, actor, path).length
  stage.path(path?.points, pos, Boolean(path && path.cost <= actor.movement && !risk))
  const label = document.querySelector('#preview')
  const projected = stage.project(pos, .14)
  if (label) {
    label.style.left = projected.x + 'px'
    label.style.top = projected.y + 'px'
    label.textContent = path ? meters(path.cost) + (risk ? ' · 借機攻擊' : '') : '無法抵達'
    label.classList.toggle('invalid', !path || path.cost > actor.movement || Boolean(risk))
  }
}

function stageClick(pos, unit) {
  if (busy || modal) return
  if (unit && targetMode !== 'summon') { clickUnit(unit); return }
  if (targetMode === 'move') void playerAct({ type: 'move', at: pos })
  if (targetMode === 'summon') void playerAct({ type: 'summon', at: pos, id: pendingSummon })
}

function clickUnit(id) {
  if (busy || modal || scene !== 'battle') return
  if (targetMode === 'capture') void playerAct({ type: 'capture', target: id })
  else if (targetMode === 'attack' || targetMode === 'skill') void playerAct({
    type: 'strike', target: id, skill: targetMode === 'attack' ? 'attack' : skillFor(active(game.battle)),
  })
  else if (selectAlly(game.battle, id)) { hoverRouter = null; save(); render() }
  else {
    const u = unitById(game.battle, id)
    if (u) notify(titleOf(u) + ' · ' + turnName(u) + ' · 生命 ' + u.hp + ' / ' + stat(u, 'hp') +
      (shortStatus(u) ? ' · ' + shortStatus(u) : ''))
  }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const wait = ms => settings.reduced ? Promise.resolve() : delay(ms)
const pointOf = id => stage.units.get(id)?.pivot.position ?? unitById(game.battle, id)?.pos

function floatText(id, text) {
  const pos = pointOf(id)
  if (!pos || settings.reduced) return
  const p = stage.project(pos, 1.35)
  const float = document.createElement('div')
  float.className = 'float-text'
  float.textContent = text
  float.style.left = p.x + 'px'
  float.style.top = p.y + 'px'
  document.querySelector('#stage').append(float)
  setTimeout(() => float.remove(), 840)
}

async function animate(events) {
  for (const e of events) {
    const actor = pointOf(e.actor)
    const target = pointOf(e.target)
    if (e.type === 'move') {
      sound('move')
      await stage.move(e.actor, e.points, settings.reduced)
    }
    if (e.type === 'cast') {
      stage.face(e.actor, target)
      stage.play(e.actor, e.clip)
      sound('cast')
      if (!settings.reduced && actor && target) stage.effect(actor, e.element, 'cast', target)
      await wait(330)
    }
    if (e.type === 'impact') {
      stage.play(e.target, e.dead ? 'death' : 'hit')
      sound('impact')
      floatText(e.target, '−' + e.amount)
      await wait(e.dead ? 580 : 270)
    }
    if (e.type === 'miss') {
      floatText(e.target, '未命中')
      await wait(330)
    }
    if (e.type === 'summon') {
      const unit = unitById(game.battle, e.target)
      stage.play(e.actor, 'summon')
      await stage.bind(unit.id, assetKey(unit), unit.pos, { scale: unit.practice ? .86 : 1 })
      stage.play(unit.id, 'appear')
      if (!settings.reduced) stage.effect(unit.pos, e.element, 'summon')
      sound('reward')
      await wait(760)
    }
    if (e.type === 'capture') {
      stage.face(e.actor, target)
      stage.play(e.actor, 'capture')
      if (!settings.reduced && target) stage.effect(target, e.element, 'capture')
      if (e.won) {
        stage.play(e.target, 'caught')
        sound('reward')
        await wait(850)
        stage.remove(e.target)
      } else { floatText(e.target, '收服失敗'); await wait(620) }
    }
    if (e.type === 'recall') {
      stage.play(e.actor, 'caught')
      if (!settings.reduced && actor) stage.effect(actor, e.element, 'capture')
      await wait(720)
      stage.remove(e.actor)
    }
  }
}

async function advanceEnemies() {
  if (scene !== 'battle' || !game.battle) return
  if (enemyCanPlay(game.battle)) {
    busy = true
    render()
    await wait(250)
  }
  while (enemyCanPlay(game.battle)) {
    const previous = new Set(game.battle.events)
    enemyTurn(game)
    save()
    await animate(game.battle.events.filter(event => !previous.has(event)))
    syncModels()
    await wait(210)
  }
  busy = false
  if (game.battle.result) {
    modal = 'result'
    if (game.battle.result === 'victory') sound('reward')
  }
  render()
}

async function playerAct(command) {
  if (busy || scene !== 'battle' || enemyCanPlay(game.battle)) return
  const previous = new Set(game.battle.events)
  const result = act(game, command)
  if (!result.ok) { notify(result.problem); return }
  busy = true
  targetMode = 'move'
  pendingSummon = null
  hoverRouter = null
  save()
  render()
  await animate(game.battle.events.filter(event => !previous.has(event)))
  syncModels()
  await advanceEnemies()
}

async function walkTo(key) {
  if (!waypoints[key] || key === worldPoint) return
  worldPoint = key
  busy = true
  render()
  const token = ++selectWorldToken
  const pivot = stage.units.get('map-hero')?.pivot.position
  const from = pivot ? { x: pivot.x, z: pivot.z } : waypoints[game.world]
  const end = waypoints[key]
  const path = router(from, movementBlocks([], null))(end)
  await stage.move('map-hero', path?.points ?? [from, end], settings.reduced)
  if (token !== selectWorldToken || scene !== 'world') return
  busy = false
  game.world = key
  save()
  render()
}

app.addEventListener('click', event => {
  const control = event.target.closest('button[data-do]')
  if (!control || control.disabled) return
  const { do: code, value } = control.dataset
  sound()
  if (code === 'continue') resume(latest())
  if (code === 'new') setScene('choose')
  if (code === 'start') { game = newGame(); save(); setScene('world') }
  if (code === 'menu') { save(); busy = false; setScene('menu') }
  if (['settings', 'load', 'help', 'pause', 'save', 'collection', 'summons', 'status'].includes(code)) {
    modal = code
    stage?.clearHover()
    renderModal()
    dialog.querySelector('button, input')?.focus()
  }
  if (code === 'close') { modal = ''; renderModal() }
  if (code === 'sound') {
    settings.volume = settings.volume ? 0 : .45
    writeSettings(settings)
    render()
  }
  if (code === 'load-slot') resume(readSlot(value))
  if (code === 'save-slot') {
    if (writeSlot(value, game)) { modal = ''; renderModal(); notify('已儲存至存檔 ' + value + '。') }
    else notify('瀏覽器無法儲存進度。')
  }
  if (code === 'walk') void walkTo(value)
  if (code === 'heal') {
    healParty(game)
    save()
    render()
    sound('reward')
    notify('生命、魔力與回復果已補滿，異常已解除。')
  }
  if (code === 'enter') {
    startBattle(game, worldPoint)
    save()
    setScene('battle')
    void advanceEnemies()
  }
  if (code === 'leave-battle') { game.battle = null; save(); setScene('world') }
  if (code === 'mode') { targetMode = value; render() }
  if (code === 'pick-summon') { modal = ''; pendingSummon = value; targetMode = 'summon'; render() }
  if (code === 'select') { if (selectAlly(game.battle, value)) { hoverRouter = null; targetMode = 'move'; save(); render() } }
  if (code === 'unit') clickUnit(value)
  if (['item', 'recall', 'end', 'disengage'].includes(code)) void playerAct({ type: code })
  if (code === 'inspect') { inspectReturn = scene; focusId = value; setScene('inspect') }
  if (code === 'inspect-back') { setScene(inspectReturn); modal = 'collection'; renderModal() }
  if (code === 'evolve') {
    const unit = game.collection.find(u => u.id === focusId)
    if (evolve(unit)) {
      save()
      stage.remove('collection-view')
      stage.bind('collection-view', assetKey(unit), { x: .78, z: 0 }, { angle: -.22 }).then(() => {
        stage.play('collection-view', 'appear')
        if (!settings.reduced) stage.effect({ x: .78, z: 0 }, elementOf(unit), 'summon')
      })
      sound('reward')
      render()
    }
  }
})

dialog.addEventListener('input', event => {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  settings[input.id] = input.type === 'checkbox' ? input.checked : Number(input.value)
  writeSettings(settings)
  if (input.id !== 'volume') {
    if (scene === 'battle') renderBattle()
    document.body.classList.toggle('reduced', settings.reduced)
  }
})

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !busy) {
    if (modal === 'result') return
    if (modal) { modal = ''; renderModal() }
    else if (scene === 'battle' && targetMode !== 'move') { targetMode = 'move'; render() }
    else if (scene !== 'menu') { modal = 'pause'; renderModal() }
  }
  if (event.code === 'Space' && !event.repeat && !modal && scene === 'battle' &&
      !['BUTTON', 'INPUT'].includes(document.activeElement?.tagName)) {
    event.preventDefault()
    void playerAct({ type: 'end' })
  }
})

render()
