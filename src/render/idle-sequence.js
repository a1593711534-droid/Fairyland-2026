const profiles = {
  hero: {
    quick: .29, neck: .48, pace: 1, rest: ['idle_check_wand', 'idle_watch'], alert: ['idle_watch'],
  },
  dog: {
    quick: .20, neck: .64, pace: 1, rest: ['idle_sit', 'idle_wag', 'idle_listen', 'idle_scent'],
    alert: ['idle_listen'], social: ['idle_wag', 'idle_listen'],
  },
  cat: {
    quick: .17, neck: .59, pace: 1.02, rest: ['idle_groom', 'idle_tail', 'idle_crouch', 'idle_stretch'],
    alert: ['idle_crouch', 'idle_tail'], social: ['idle_tail'],
  },
  turtle: {
    quick: .43, neck: .55, pace: .95, rest: ['idle_browse', 'idle_retreat'],
    alert: ['idle_retreat'], social: ['idle_browse'],
  },
  bird: {
    quick: .11, neck: .93, pace: 1.06, rest: ['idle_preens', 'idle_wings', 'idle_scan'],
    alert: ['idle_scan'], social: ['idle_scan', 'idle_wings'],
  },
  dino: {
    quick: .27, neck: .51, pace: 1, rest: ['idle_sniff', 'idle_alert'], alert: ['idle_alert'],
  },
  mouse: {
    quick: .12, neck: .65, pace: 1.09, rest: ['idle_groom', 'idle_scout'],
    alert: ['idle_scout'], social: ['idle_scout'],
  },
}

export function idleSequence(name, id, portrait, salt = 0) {
  const profile = profiles[name.replace(/-evolved$/, '')]
  if (!profile) return null
  let state = (Array.from(id).reduce((sum, char, i) => sum + char.charCodeAt(0) * (i + 1), 0) + salt + 1) >>> 0
  const sample = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  let last = ''
  return {
    ...profile,
    sample,
    firstDelay: portrait ? .9 + sample() * 1.6 : 2.15 + sample() * 3.4,
    glanceDelay: () => profile.quick + sample() * .18,
    next(mood = 'rest') {
      const choices = profile[mood === 'watch' ? 'alert' : mood] ?? profile.rest
      const available = choices.filter(clip => clip !== last)
      const pool = available.length ? available : choices
      const clip = pool[Math.floor(sample() * pool.length)]
      last = clip
      const pause = (mood === 'rest' ? 2.4 : 1.6) + sample() * (portrait ? 1.8 : 3.3)
      return { clip, pause, speed: profile.pace * (.92 + sample() * .16) }
    },
  }
}
