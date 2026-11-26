import { active } from './combat.js'

export function movementCheckpoint(battle) {
  const unit = active(battle)
  return { id: unit.id, round: battle.round, start: { ...unit.pos }, allowance: unit.movement }
}

export function reversibleMove(battle, checkpoint, result) {
  if (!result.ok || result.reactions.length || battle.result || active(battle)?.id !== checkpoint.id) return null
  const unit = active(battle)
  if (unit.movement >= checkpoint.allowance) return null
  const path = result.path.points
  return {
    ...checkpoint,
    remaining: unit.movement,
    end: { ...unit.pos },
    route: [{ ...unit.pos }, ...path.slice(1, -1).reverse(), checkpoint.start],
  }
}

export function restoreMovement(battle, move) {
  const unit = active(battle)
  if (!move || battle.result || !unit?.hp || unit.done || unit.id !== move.id || battle.round !== move.round ||
      unit.movement !== move.remaining || unit.pos.x !== move.end.x || unit.pos.z !== move.end.z) return false
  unit.pos = { ...move.start }
  unit.movement = move.allowance
  return true
}
