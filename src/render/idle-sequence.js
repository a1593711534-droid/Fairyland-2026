const species = {
  hero: [['idle_watch', 'idle_check_wand'], [8, 12]],
  dog: [['idle_sit', 'idle_listen', 'idle_wag'], [6, 8, 4]],
  cat: [['idle_groom', 'idle_tail', 'idle_crouch'], [8, 5, 8]],
  turtle: [['idle_browse', 'idle_retreat'], [9, 12]],
  bird: [['idle_preens', 'idle_scan', 'idle_wings'], [8, 5, 9]],
  dino: [['idle_sniff', 'idle_alert'], [7, 11]],
  mouse: [['idle_scout', 'idle_groom'], [5, 9]],
}

export function idleSequence(name, id, portrait) {
  const profile = species[name.replace(/-evolved$/, '')]
  if (!profile) return null
  const seed = Array.from(id).reduce((sum, char, i) => sum + char.charCodeAt(0) * (i + 1), 0)
  const [clips, pauses] = profile
  let index = portrait ? 0 : seed % clips.length
  return {
    firstDelay: portrait ? 3.3 : 4.8 + (seed % 37) / 10,
    next() {
      const next = { clip: clips[index], pause: pauses[index] + (seed % 17) / 10 }
      index = (index + 1) % clips.length
      return next
    },
  }
}
