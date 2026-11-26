import './style.css'
import { version } from '../package.json'
import { elements, hero, items, rules, skills, species, status, titleOf, waypoints, waypointTypes, xpForLevel } from './game/content.js'
import { act, active, alliesInTurn, areaAttack, areOpponents, elementOf, evolve, forecast, healParty, isWild, meters,
  percent, movementReactions, selectAlly, skillFor, startBattle, stat, unitById, validate, captureChance } from './game/combat.js'
import { enemyCanPlay, enemyTurn } from './game/ai.js'
import { distance, movementBlocks, movementMask, router, travel } from './game/geometry.js'
import { latest, newGame, readSettings, readSlot, slots, writeSettings, writeSlot } from './game/save.js'
import { chooseEvent, requiresBattle } from './game/world.js'
import { availableSummons, summonPlan } from './game/summoning.js'
import { consume, itemProblem, purchase, purchaseProblem } from './game/inventory.js'
import { button, goldLine, kitPanel, shopPanel, summonPanel } from './interface.js'
import { FairylandAudio } from './render/audio.js'

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
let placementPlan = []
let shopTarget = 'hero'
let worldPoint = null
let busy = false
let hoverRouter = null
let toastTimer
const audio = new FairylandAudio()
audio.configure(settings.volume, settings.music)
let focusId = null
let inspectReturn = null
let selectWorldToken = 0
let stage
let Stage
let sceneLoad

const assetKey = u => u.kind === 'rival' ? 'hero' : u.kind + (u.evolved ? '-evolved' : '')
const nodeName = key => waypoints[key]?.name ?? '微光林地'
const sign = (id, label = true) => {
  const e = elements[id]
  return '<span class="element" style="--element:' + e.color + '" title="' + e.name + '屬性">' + e.symbol + (label ? ' <span>' + e.name + '</span>' : '') + '</span>'
}
const brand = '<div class="brand"><span class="brand-mark">✧</span><span>FAIRYLAND</span></div>'
const audioToggle = () => button(settings.volume ? '◖))' : '◖×', 'sound', { css: 'icon', title: settings.volume ? '關閉音效' : '開啟音效' })

function notify(message) {
  clearTimeout(toastTimer)
  toast.textContent = message
  toast.classList.add('show')
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3100)
}

const sound = (type = 'tap', element) => audio.play(type, element)

function save() {
  if (game && !writeSlot('auto', game)) notify('瀏覽器無法儲存進度。')
}

async function openGame(enter) {
  if (stage) { enter(); return }
  if (sceneLoad) return
  sceneLoad = import('./render/stage.js')
  const loading = setTimeout(() => notify('正在載入 3D 場景…'), 240)
  ui.setAttribute('aria-busy', 'true')
  try {
    Stage = (await sceneLoad).Stage
    enter()
  } catch {
    notify('3D 模組載入失敗，請再試一次。')
  } finally {
    clearTimeout(loading)
    ui.removeAttribute('aria-busy')
    sceneLoad = null
  }
}

function setScene(next) {
  scene = next
  toast.classList.remove('show')
  audio.choose(next)
  modal = ''
  tags.replaceChildren()
  targetMode = 'move'
  placementPlan = []
  pendingSummon = null
  hoverRouter = null
  if (next !== 'menu' && !stage) {
    try {
      stage = new Stage(document.querySelector('#stage'), {
        frame: projectTags, click: stageClick, hover: stageHover, cancel: cancelInteraction,
        error: () => notify('3D 資源載入失敗，請重新整理後再試。'),
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
    button('查看莉歐 <b>↗</b>', 'hero-preview', { css: 'menu-entry' }) +
    button('讀取存檔 <b>↗</b>', 'load', { css: 'menu-entry' }) +
    button('設定 <b>↗</b>', 'settings', { css: 'menu-entry' }) +
    button('說明 <b>↗</b>', 'help', { css: 'menu-entry' }) +
    '</nav></div><footer class="title-footer"><div><span class="live-dot"></span> 測試版 <span class="footer-divider"></span> v' + version + '</div>' +
    '<div class="scene-caption"><span>✦</span> 微光林地</div></footer></section>'
}

function renderChoose() {
  ui.innerHTML = '<section class="overlay character-screen"><header class="topbar">' + brand +
    button('← 主選單', 'menu', { css: 'subtle' }) + '</header><div class="character-copy"><div class="eyebrow"><i></i> 選擇角色</div>' +
    '<h1>' + hero.name + '</h1><div class="character-class">' + sign(hero.element) + ' <span>' + hero.className + '</span></div>' +
    '<p>' + hero.byline + '</p><dl class="character-stats"><div><dt>生命</dt><dd>' + hero.hp + '</dd></div><div><dt>魔力</dt><dd>' + rules.playerMana +
    '</dd></div><div><dt>移動</dt><dd>' + hero.move + ' m</dd></div></dl>' +
    '<p class="starter-elements" aria-label="起始夥伴含六種屬性">' + Object.keys(elements).map(key => sign(key)).join('') + '</p>' +
    button('踏上旅程 <b>↗</b>', 'start', { css: 'primary large' }) + '</div></section>'
}

function waypointAction(key) {
  const site = waypoints[key]
  if (site.type === 'shop') return 'shop'
  if (site.type === 'heal') return 'heal'
  if (site.type === 'event') return game.eventsSeen[key] ? null : 'world-event'
  return game.hero.hp ? 'enter' : null
}

const shopCarrier = () => shopTarget === 'hero' ? game.hero :
  game.collection.find(unit => unit.id === shopTarget) ?? game.hero

function renderWorld() {
  const stop = waypoints[worldPoint]
  const mandatory = requiresBattle(game, worldPoint)
  const seen = game.eventsSeen[worldPoint]
  const type = stop.revisit && !mandatory ? 'battle' : stop.type
  let details = type === 'battle' && stop.revisit
    ? '你已完成這裡的任務。現在可以選擇與新的野生精靈交手。' : stop.text
  const action = {
    heal: ['在月泉休息', 'heal'],
    shop: ['瀏覽商品', 'shop'],
    event: ['查看果籃', 'world-event'],
  }[type] ?? [mandatory ? '開始任務戰鬥' : '進入戰場', 'enter']
  if (seen) details = '你已查看過被風吹落的果籃。'
  ui.innerHTML = '<section class="overlay world-screen"><header class="topbar">' + brand + '<div class="top-right">' +
    button('物品', 'world-kit', { css: 'subtle', disabled: busy }) +
    button('精靈手冊', 'collection', { css: 'subtle', disabled: busy }) + button('存檔', 'save', { css: 'subtle', disabled: busy }) +
    button('選單', 'pause', { css: 'subtle' }) + '</div></header><div class="world-title"><div class="eyebrow"><i></i> 大地圖</div><h1>月見森林</h1></div>' +
    '<aside class="world-card"><div class="eyebrow">' + waypointTypes[type].label + '</div><h2>' + stop.name + '</h2><p>' + details + '</p>' +
    button(action[0], action[1], { css: 'primary full', disabled: busy || Boolean(seen) || (action[1] === 'enter' && !game.hero.hp) }) + '</aside>' +
    '<footer class="map-footer"><span>拖曳右鍵旋轉　／　滾輪縮放</span><span>' + goldLine(game.gold) + '　勝利 ' + game.wins + ' 場</span></footer></section>'
  tags.innerHTML = Object.entries(waypoints).map(([key, node]) => {
    const action = waypointAction(key)
    return '<div class="tag waypoint" data-node="' + key + '">' +
      button('<span class="waypoint-icon">' + waypointTypes[node.revisit && !requiresBattle(game, key) ? 'battle' : node.type].icon +
        '</span><span>' + node.name + '</span>', 'walk', {
          css: key === worldPoint ? 'selected' : '', data: key, disabled: busy,
          title: node.name + ' · ' + (action === 'shop' ? '購物' : action === 'world-event' ? '查看事件' :
            action === 'heal' ? '休息' : action === 'enter' ? '開始戰鬥' : '前往'),
        }) + '</div>'
  }).join('')
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
  const summonable = !actor.summoned && actor.kind === 'hero' &&
    availableSummons(game, actor).some(unit => actor.mana >= species[unit.kind].summon)
  const action = (label, code, isDisabled = false, data = code) => button(label, code, {
    css: 'action' + (targetMode === data ? ' selected' : ''), disabled: !canAct || isDisabled, data,
  })
  const spell = skills[skillFor(actor)]
  const combatBar = '<div class="combat-actions" role="group" aria-label="戰鬥指令">' +
    action('攻擊', 'mode', !actor.action, 'attack') +
    action(sign(elementOf(actor), false) + ' ' + spell.name, 'mode', !actor.action || actor.mana < (spell.mana ?? 0), 'skill') +
    (actor.kind === 'hero' ? action('召喚', 'summons', !summonable, 'summon') +
      action('收服', 'mode', !actor.action || actor.mana < rules.captureMana, 'capture') :
      action('撤回', 'recall')) +
    action('物品', 'battle-kit') + action('狀態', 'status') + action('脫離', 'disengage', !actor.action) +
    action('衝刺', 'rush', !actor.action) + action('待機', 'end') +
    (targetMode !== 'move' ? action('取消', 'cancel-target') : '') + '</div>'
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
    '<div class="battle-control">' + combatBar + '<div class="battle-caption">' + hint() + '</div></div>' +
    '</footer></section>'
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
  if (targetMode === 'summon') tags.insertAdjacentHTML('beforeend', '<aside class="summon-dock" aria-label="召喚配置">' +
    summonPanel(game, actor, placementPlan, sign, pendingSummon) + '</aside>')
}

function hint() {
  if (busy) return '行動結算中'
  if (targetMode === 'move') return '點青色地面移動，點可命中的敵人普攻。金色路線會引發借機攻擊。'
  if (targetMode === 'summon') return pendingSummon ? '點藍紫色範圍內的空地。短按右鍵取消這次選擇。' : '選精靈、點落點。可一次配置多隻。'
  if (targetMode === 'skill' && skills[skillFor(active(game.battle))].radius) return '選擇法術中心。範圍內的我方也可能受到傷害。'
  if (targetMode === 'capture') return '選擇野生精靈。降低血量或施加異常可提高成功率。'
  return '點選目標確認攻擊。名稱旁顯示命中率或不可攻擊的原因。'
}

function targetPreview(unit) {
  if (busy || targetMode === 'summon') return ''
  const actor = active(game.battle)
  if (!areOpponents(actor, unit)) return ''
  if (targetMode === 'move' && (!actor.action || actor.team !== 'ally')) return ''
  if (targetMode === 'capture') {
    if (!isWild(unit)) return '不可收服'
    return validate(game, { type: 'capture', target: unit.id }).ok ? percent(captureChance(unit)) : '無法觸及'
  }
  const key = targetMode === 'skill' ? skillFor(actor) : 'attack'
  const f = forecast(actor, unit, key)
  if (f.distance > f.range) return targetMode === 'move' ? '' : '太遠'
  if (!f.clear) return targetMode === 'move' ? '' : '掩體'
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
    '<div class="inspect-buttons">' +
    (next ? button('進化為' + species[unit.kind].evolved, 'evolve', { css: 'primary large', disabled: busy }) : '') +
    button('物品欄', 'inspect-kit', { css: 'subtle', disabled: busy }) +
    (game.collection.length > 1 ? button('‹', 'inspect-shift', { css: 'subtle', data: '-1', title: '上一隻精靈' }) +
      button('›', 'inspect-shift', { css: 'subtle', data: '1', title: '下一隻精靈' }) : '') + '</div></div></section>'
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
      settings.volume + '"></label><label class="setting"><span>背景音樂</span><input type="range" id="music" min="0" max="1" step=".05" value="' +
      settings.music + '"></label><label class="setting"><span>簡化動畫與特效</span><input type="checkbox" id="reduced"' +
      (settings.reduced ? ' checked' : '') + '></label><label class="setting"><span>顯示戰場名稱</span><input type="checkbox" id="labels"' +
      (settings.labels ? ' checked' : '') + '></label>'
  }
  if (modal === 'help') {
    title = '玩法說明'
    body = '<div class="guide"><h3>移動與行動</h3><p>選擇角色後，點青色區域即可移動。滑鼠移到地面可預覽繞路，紅線表示超出剩餘距離。點選攻擊或法術後，再點目標。行動與移動距離分開計算，待機才交給下一位。離開敵人的近戰範圍會引來借機攻擊，可先用主要行動脫離。</p>' +
      '<h3>召喚與收服</h3><p>莉歐開局就有六種屬性的夥伴，進場時會獨自站在戰場上。她可在同一回合耗魔召喚多隻夥伴。魔力低於 ' + rules.tetherMana +
      ' 時，場上夥伴會變回野生。野生精靈生命愈低、異常愈多，收服機率愈高。回到月泉可回復生命與魔力。</p>' +
      '<h3>屬性與進化</h3><p>水克火、火克冰、冰克風、風克地、地克雷、雷克水。同屬性施法有加成，莉歐召喚火屬性精靈也有加成。召喚上場的夥伴可獲經驗，Lv. ' +
      rules.evolutionLevel + ' 可從手冊進化。</p><p>短按右鍵取消，拖曳右鍵旋轉。<kbd>Esc</kbd> 返回或開啟選單　<kbd>Space</kbd> 待機　<kbd>Enter</kbd> 提交召喚</p></div>'
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
  if (modal === 'collection') {
    title = '精靈手冊'
    const available = game.collection
    body = available.map(unit => button('<span>' + sign(elementOf(unit), false) + ' <strong>' + titleOf(unit) +
      '</strong><small> Lv. ' + unit.level + '　生命 ' + unit.hp + ' / ' + stat(unit, 'hp') +
      (shortStatus(unit) ? '　' + shortStatus(unit) : '') + '</small></span><b>' +
      (unit.evolved ? '已進化' : unit.level >= rules.evolutionLevel ? '可進化 ✧' : '↗') + '</b>',
    'inspect', {
      css: 'dialog-row', data: unit.id,
    })).join('') || '<p class="muted">在戰場收服野生精靈後，就能在這裡查看。</p>'
  }
  if (['battle-kit', 'world-kit', 'inspect-kit'].includes(modal)) {
    const unit = kitUnit()
    title = titleOf(unit) + '的物品欄'
    body = kitPanel(unit, { battle: modal === 'battle-kit',
      problem: (owner, key) => itemProblem(owner, key, stat(owner, 'hp')) || (modal === 'battle-kit' && !owner.bonus ? '附贈行動已用完。' : null),
    })
  }
  if (modal === 'shop') {
    title = waypoints[worldPoint].name
    const carriers = [{ id: 'hero', text: hero.name }, ...game.collection.map(unit => ({ id: unit.id, text: titleOf(unit) }))]
    body = shopPanel(game, carriers, shopTarget, key => purchaseProblem(game, shopCarrier(), key))
  }
  if (modal === 'world-event') {
    const site = waypoints[worldPoint]
    title = site.name
    body = '<p class="muted">' + site.text + '</p>' +
      button('拾起 ' + site.event.gold + ' 金幣', 'event-choose', { data: 'gold', css: 'dialog-row' }) +
      button('帶走' + items[site.event.item].name, 'event-choose', { data: 'item', css: 'dialog-row' })
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
      (victory ? goldLine(game.battle.reward ?? 0) : '') +
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

function kitUnit() {
  if (modal === 'battle-kit') return active(game.battle)
  if (modal === 'inspect-kit') return game.collection.find(unit => unit.id === focusId)
  return game.hero
}

function drawGhosts() {
  if (!stage || scene !== 'battle') return
  const ids = placementPlan.map(entry => 'ghost-' + entry.id)
  for (const id of stage.units.keys()) if (id.startsWith('ghost-') && !ids.includes(id)) stage.remove(id)
  for (const row of placementPlan) {
    const unit = game.collection.find(entry => entry.id === row.id)
    if (unit) stage.bind('ghost-' + row.id, assetKey(unit), row.at, { ghost: true, scale: .94 })
  }
}

function projectTags(renderer) {
  for (const tag of tags.children) {
    const u = tag.dataset.unit && unitById(game.battle, tag.dataset.unit)
    const body = u && renderer.units.get(u.id)?.pivot
    const pivot = body?.position
    const node = waypoints[tag.dataset.node]
    if (!pivot && !node) continue
    const at = renderer.project(pivot ?? node, node ? .38 : u.kind === 'hero' || u.kind === 'rival' ? 2.65 : u.evolved ? 2.85 : 2.05)
    tag.style.transform = 'translate(' + at.x.toFixed(1) + 'px,' + at.y.toFixed(1) + 'px) translate(-50%,-100%)'
    tag.style.visibility = at.show && body?.visible !== false ? 'visible' : 'hidden'
  }
}

function refreshMarks() {
  if (!stage || scene !== 'battle') return
  stage.clearMarks()
  stage.clearHover()
  const b = game.battle
  drawGhosts()
  if (!b || b.result) return
  for (const unit of b.units) {
    if (!unit.hp || unit.dismissed) continue
    stage.mark(unit.pos, unit.id === b.active ? .68 : .51,
      unit.id === b.active ? '#f3deaa' : unit.team === 'ally' ? '#8adab4' : unit.team === 'enemy' ? '#fa8e80' : '#c5ad77')
  }
  const actor = active(b)
  if (busy || actor.team !== 'ally') return
  if (targetMode === 'move' && actor.movement >= .18) {
    hoverRouter ??= router(actor.pos, movementBlocks(b.units.filter(u => !u.dismissed), actor))
    stage.movementArea(movementMask(actor.pos, actor.movement, hoverRouter))
  }
  const overlayMode = targetMode
  const range = { capture: rules.captureRange, summon: rules.summonRange,
    attack: skills.attack.range, skill: skills[skillFor(actor)].range }[overlayMode]
  const colors = { summon: '#abacff', attack: '#ff906f', skill: elements[elementOf(actor)].color, capture: '#efdc9e' }
  if (range) stage.mark(actor.pos, range, colors[overlayMode], true)
  for (const { at } of placementPlan) stage.mark(at, rules.bodyRadius * 1.5, colors.summon)
}

function stageHover(pos) {
  if (!pos) {
    const label = document.querySelector('#preview')
    if (label) label.textContent = ''
    stage?.clearHover()
    return
  }
  if (busy || modal || scene !== 'battle' || game.battle.result) return
  const b = game.battle
  const actor = active(b)
  if (actor.team !== 'ally') return
  if (targetMode === 'summon') {
    if (!pendingSummon) return
    const check = summonPlan(game, actor, [...placementPlan, { id: pendingSummon, at: pos }])
    stage.path(pos, [], check.ok ? '#b9b9ff' : '#f7827c')
    return
  }
  const spell = skills[skillFor(actor)]
  if (targetMode === 'skill' && spell.radius) {
    const preview = areaAttack(b, actor, skillFor(actor), pos)
    stage.path(pos, [], preview.ok ? elements[elementOf(actor)].color : '#f7827c', spell.radius)
    const caption = document.querySelector('.battle-caption')
    if (caption) caption.textContent = preview.ok
      ? preview.attacks.map(({ target, preview }) => titleOf(target) + ' ' + percent(preview.accuracy) +
        (areOpponents(actor, target) ? '' : ' 我方')).join('　·　')
      : preview.problem
    return
  }
  if (targetMode !== 'move') return
  hoverRouter ??= router(actor.pos, movementBlocks(b.units.filter(u => !u.dismissed), actor))
  const path = hoverRouter(pos)
  const within = path && path.cost <= actor.movement + .00001
  const reachable = path && travel(path, actor.movement)
  const risk = reachable && movementReactions(b, actor, { points: reachable }).length
  const color = risk ? '#ffc673' : '#fff4da'
  const blocked = '#ff827a'
  let segments = []
  if (within) segments = [{ points: path.points, color }]
  else if (path) segments = [
    { points: reachable, color },
    { points: [reachable.at(-1), ...path.points.slice(reachable.length - 1)], color: blocked },
  ]
  stage.path(pos, segments, within ? color : blocked)
  const label = document.querySelector('#preview')
  const projected = stage.project(pos, .14)
  if (label) {
    label.style.left = projected.x + 'px'
    label.style.top = projected.y + 'px'
    label.textContent = path
      ? meters(path.cost) + (risk ? ' · 借機攻擊' : '') + (within ? '' : ' · 距離不足')
      : '無法抵達'
    label.classList.toggle('invalid', !within)
  }
}

function stageClick(pos, unit) {
  if (busy || modal || scene !== 'battle') return
  if (unit && targetMode !== 'summon') { clickUnit(unit); return }
  if (targetMode === 'move') {
    void playerAct({ type: 'move', at: pos })
    return
  }
  if (targetMode === 'summon') {
    if (!pendingSummon) return
    const next = [...placementPlan, { id: pendingSummon, at: pos }]
    const check = summonPlan(game, active(game.battle), next)
    if (!check.ok) { notify(check.problem); return }
    placementPlan = next
    pendingSummon = null
    render()
  }
  if (targetMode === 'skill' && skills[skillFor(active(game.battle))].radius) {
    void playerAct({ type: 'strike', skill: skillFor(active(game.battle)), at: pos })
  }
}

function clickUnit(id) {
  if (busy || modal || scene !== 'battle') return
  const u = unitById(game.battle, id)
  if (!u) return
  if (targetMode === 'capture') void playerAct({ type: 'capture', target: id })
  else if (targetMode === 'attack' || targetMode === 'skill') void playerAct({
    type: 'strike', target: id, at: u.pos,
    skill: targetMode === 'attack' ? 'attack' : skillFor(active(game.battle)),
  })
  else if (targetMode === 'move' && selectAlly(game.battle, id)) { hoverRouter = null; save(); render() }
  else {
    const basic = { type: 'strike', target: id, skill: 'attack' }
    if (targetMode === 'move' && validate(game, basic).ok) {
      void playerAct(basic)
      return
    }
    notify(titleOf(u) + ' · ' + turnName(u) + ' · 生命 ' + u.hp + ' / ' + stat(u, 'hp') +
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
    const target = e.center ?? pointOf(e.target)
    if (e.type === 'move') {
      sound('move')
      await stage.move(e.actor, e.points, settings.reduced)
    }
    if (e.type === 'cast') {
      stage.face(e.actor, target)
      stage.play(e.actor, e.clip)
      sound('cast', e.element)
      if (!settings.reduced && actor && target) stage.effect(actor, e.element, 'cast', target)
      await wait(350)
      if (!settings.reduced && target && e.radius) stage.effect(target, e.element, 'area', null, e.radius * .68)
    }
    if (e.type === 'impact') {
      stage.play(e.target, e.dead ? 'death' : 'hit')
      const spell = skills[e.skill]
      const at = pointOf(e.target)
      if (!settings.reduced && spell?.element && at && !spell.radius) stage.effect(at, spell.element, 'impact')
      sound('impact')
      floatText(e.target, '−' + e.amount)
      await wait(e.dead ? 580 : 270)
    }
    if (e.type === 'miss') {
      floatText(e.target, '未命中')
      await wait(330)
    }
    if (e.type === 'summon-batch') {
      stage.play(e.actor, 'summon')
      const arrivals = e.targets.map(id => unitById(game.battle, id))
      sound('cast', elementOf(arrivals[0]))
      const ready = Promise.all(arrivals.map(unit =>
        stage.bind(unit.id, assetKey(unit), unit.pos, { scale: unit.practice ? .86 : 1, hidden: true })))
      await Promise.all([ready, wait(250)])
      if (!settings.reduced) {
        const cues = arrivals.map(unit => stage.effect(unit.pos, elementOf(unit), 'summon'))
        if (arrivals.some(unit => elementOf(unit) === 'fire')) sound('fire-rise')
        await Promise.all([wait(285), ...cues])
      }
      for (const unit of arrivals) {
        stage.reveal(unit.id)
        stage.play(unit.id, 'appear')
      }
      sound('reward')
      await wait(820)
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
      if (!settings.reduced && actor) stage.effect(actor, e.element, 'recall')
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
  placementPlan = []
  modal = ''
  hoverRouter = null
  save()
  render()
  await animate(game.battle.events.filter(event => !previous.has(event)))
  syncModels()
  await advanceEnemies()
}

async function walkTo(key) {
  if (busy || !waypoints[key]) return
  if (key === worldPoint) {
    useWaypoint(waypointAction(key))
    return
  }
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
  const action = waypointAction(key)
  if (action) useWaypoint(action)
  else render()
}

function useWaypoint(action) {
  if (action === 'enter') enterBattle()
  else if (action === 'heal') {
    healParty(game)
    save()
    render()
    sound('reward')
    notify('生命與魔力已回復，異常已解除。')
  } else if (action) {
    modal = action
    render()
    dialog.querySelector('button')?.focus()
  }
}

function enterBattle() {
  if (busy || !startBattle(game, worldPoint)) return
  save()
  setScene('battle')
  void advanceEnemies()
}

function cancelTarget() {
  if (targetMode === 'summon' && pendingSummon) {
    pendingSummon = null
  } else {
    placementPlan = []
    targetMode = 'move'
  }
  render()
}

function cancelInteraction() {
  if (busy || modal === 'result') return false
  if (modal) {
    modal = ''
    renderModal()
    return true
  }
  if (scene === 'battle' && targetMode !== 'move') {
    cancelTarget()
    return true
  }
  if (scene === 'inspect') {
    backToCollection()
    return true
  }
  if (scene === 'choose') {
    setScene('menu')
    return true
  }
  return false
}

function startGame() {
  game = newGame()
  save()
  setScene('world')
}

function backToCollection() {
  setScene(inspectReturn)
  modal = 'collection'
  renderModal()
}

app.addEventListener('click', event => {
  const control = event.target.closest('button[data-do]')
  if (!control || control.disabled) return
  const { do: code, value } = control.dataset
  audio.enable()
  sound()
  if (code === 'continue') void openGame(() => resume(latest()))
  if (code === 'hero-preview') void openGame(() => setScene('choose'))
  if (code === 'new' || code === 'start') void openGame(startGame)
  if (code === 'menu') { save(); busy = false; setScene('menu') }
  if (['settings', 'load', 'help', 'pause', 'save', 'collection', 'status', 'world-kit', 'battle-kit', 'inspect-kit', 'shop', 'world-event'].includes(code)) {
    modal = code
    stage?.clearHover()
    renderModal()
    dialog.querySelector('button, input')?.focus()
  }
  if (code === 'close') cancelInteraction()
  if (code === 'sound') {
    settings.volume = settings.volume ? 0 : .45
    writeSettings(settings)
    audio.configure(settings.volume, settings.music)
    render()
  }
  if (code === 'load-slot') void openGame(() => resume(readSlot(value)))
  if (code === 'save-slot') {
    if (writeSlot(value, game)) { modal = ''; renderModal(); notify('已儲存至存檔 ' + value + '。') }
    else notify('瀏覽器無法儲存進度。')
  }
  if (code === 'walk') void walkTo(value)
  if (code === 'heal') useWaypoint('heal')
  if (code === 'enter') enterBattle()
  if (code === 'leave-battle') { game.battle = null; save(); setScene('world') }
  if (code === 'summons') {
    if (targetMode === 'summon') cancelTarget()
    else { targetMode = 'summon'; render() }
  }
  if (code === 'mode') {
    const next = targetMode === value ? 'move' : value
    pendingSummon = null
    placementPlan = []
    targetMode = next
    render()
  }
  if (code === 'cancel-target') cancelTarget()
  if (code === 'pick-summon') { pendingSummon = value; render() }
  if (code === 'drop-summon') { placementPlan = placementPlan.filter(row => row.id !== value); render() }
  if (code === 'confirm-summons') void playerAct({ type: 'summon-batch', placements: placementPlan })
  if (code === 'select' && selectAlly(game.battle, value)) {
    hoverRouter = null; targetMode = 'move'; pendingSummon = null; placementPlan = []; save(); render()
  }
  if (code === 'unit') clickUnit(value)
  if (['recall', 'end', 'disengage', 'rush'].includes(code)) void playerAct({ type: code })
  if (code === 'use-item') {
    if (scene === 'battle') void playerAct({ type: 'item', item: value })
    else {
      const unit = kitUnit()
      const problem = consume(unit, value, stat(unit, 'hp'))
      if (problem) notify(problem); else { save(); render() }
    }
  }
  if (code === 'drop-item') {
    const unit = kitUnit()
    const index = unit.inventory.indexOf(value)
    if (index >= 0) { unit.inventory[index] = null; save(); render() }
  }
  if (code === 'shop-target') { shopTarget = value; renderModal() }
  if (code === 'buy-item') {
    const problem = purchase(game, shopCarrier(), value)
    if (problem) notify(problem); else { save(); render(); notify('已將' + items[value].name + '放入物品欄。') }
  }
  if (code === 'event-choose') {
    const problem = chooseEvent(game, worldPoint, value)
    if (problem) notify(problem); else { modal = ''; save(); render(); sound('reward') }
  }
  if (code === 'inspect') { inspectReturn = scene; focusId = value; setScene('inspect') }
  if (code === 'inspect-shift') {
    const count = game.collection.length
    const index = game.collection.findIndex(unit => unit.id === focusId)
    const unit = game.collection[(index + Number(value) + count) % count]
    focusId = unit.id
    stage.remove('collection-view')
    stage.bind('collection-view', assetKey(unit), { x: .78, z: 0 }, { angle: -.22 })
    render()
  }
  if (code === 'inspect-back') backToCollection()
  if (code === 'evolve') {
    const unit = game.collection.find(u => u.id === focusId)
    if (evolve(unit)) {
      modal = ''
      save()
      stage.remove('collection-view')
      stage.bind('collection-view', assetKey(unit), { x: .78, z: 0 }, { angle: -.22 }).then(() => {
        if (scene !== 'inspect' || unit.id !== focusId || settings.reduced) return
        stage.play('collection-view', 'evolve')
        stage.effect({ x: .78, z: 0 }, elementOf(unit), 'evolve')
      })
      sound('evolve', elementOf(unit))
      render()
    }
  }
})

dialog.addEventListener('input', event => {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  settings[input.id] = input.type === 'checkbox' ? input.checked : Number(input.value)
  writeSettings(settings)
  audio.configure(settings.volume, settings.music)
  if (!['volume', 'music'].includes(input.id)) {
    if (scene === 'battle') renderBattle()
    document.body.classList.toggle('reduced', settings.reduced)
  }
})

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !busy) {
    if (modal === 'result') return
    if (!cancelInteraction() && scene !== 'menu') { modal = 'pause'; renderModal() }
  }
  if (event.key === 'Enter' && !event.repeat && !modal && scene === 'battle' && targetMode === 'summon' &&
      placementPlan.length && !['BUTTON', 'INPUT'].includes(document.activeElement?.tagName)) {
    event.preventDefault()
    void playerAct({ type: 'summon-batch', placements: placementPlan })
  }
  if (event.code === 'Space' && !event.repeat && !modal && scene === 'battle' &&
      !['BUTTON', 'INPUT'].includes(document.activeElement?.tagName)) {
    event.preventDefault()
    if (targetMode === 'move') void playerAct({ type: 'end' })
  }
})

app.addEventListener('contextmenu', event => {
  if (event.defaultPrevented || event.button !== 2 || event.shiftKey) return
  if (cancelInteraction()) event.preventDefault()
})

dialog.addEventListener('click', event => {
  if (event.target.classList.contains('modal-shade')) cancelInteraction()
})

render()
