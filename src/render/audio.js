const scores = {
  title: { tempo: 75, bars: [[50,57,62,65],[46,53,58,62],[48,55,60,64],[45,52,57,60]], melody: [74,69,77,72,74,70,76,69] },
  forest: { tempo: 88, bars: [[55,62,67,71],[52,59,64,67],[53,60,65,69],[50,57,62,65]], melody: [79,74,76,71,77,72,74,69] },
  battle: { tempo: 110, bars: [[45,52,57,60],[43,50,55,58],[41,48,53,57],[40,47,52,55]], melody: [69,76,67,74,65,72,64,71] },
}
const tones = {
  tap: { notes: [67, 74], len: .18, power: .18 },
  move: { notes: [44, 47], len: .16, power: .11 },
  impact: { notes: [35, 42], len: .21, power: .29 },
  reward: { notes: [62, 69, 74, 78], len: .64, power: .26 },
  evolve: { notes: [50, 57, 65, 69, 74, 81], len: 1.1, power: .33 },
}
const elements = {
  fire: [51, 63, 75, 79], water: [60, 67, 76, 72], earth: [38, 53, 50, 62],
  thunder: [52, 76, 53, 84], ice: [71, 74, 83, 86], wind: [64, 71, 79, 84],
}
const hz = pitch => 440 * 2 ** ((pitch - 69) / 12)

export class FairylandAudio {
  constructor() {
    this.scene = 'title'
    this.volume = .45
    this.musicVolume = .55
    this.step = 0
  }

  enable() {
    const Audio = window.AudioContext ?? window.webkitAudioContext
    if (!Audio) return
    try {
      if (!this.ctx) {
        const ctx = this.ctx = new Audio()
        this.fx = ctx.createGain()
        this.music = ctx.createGain()
        this.fx.connect(ctx.destination)
        this.music.connect(ctx.destination)
        this.fx.gain.value = this.volume
        this.music.gain.value = this.musicVolume * .34
        this.next = ctx.currentTime + .08
        this.timer = window.setInterval(() => this.schedule(), 100)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
    } catch {
      this.ctx = null
    }
  }

  configure(volume, music) {
    this.volume = volume
    this.musicVolume = music
    if (!this.ctx) return
    this.fx.gain.setTargetAtTime(volume, this.ctx.currentTime, .06)
    this.music.gain.setTargetAtTime(music * .34, this.ctx.currentTime, .10)
  }

  choose(scene) {
    const mood = scene === 'battle' ? 'battle' : scene === 'world' || scene === 'inspect' ? 'forest' : 'title'
    if (mood !== this.scene) this.step = 0
    this.scene = mood
  }

  note(pitch, when, length, power, style, output) {
    const ctx = this.ctx
    const gain = ctx.createGain()
    const primary = ctx.createOscillator()
    const overtone = ctx.createOscillator()
    const overtoneGain = ctx.createGain()
    const attack = style === 'pad' ? Math.min(.57, length * .28) : .013
    primary.type = style === 'drum' ? 'triangle' : 'sine'
    primary.frequency.value = hz(pitch)
    if (style === 'drum') primary.frequency.exponentialRampToValueAtTime(Math.max(30, hz(pitch) * .61), when + length * .55)
    overtone.frequency.value = hz(pitch) * (style === 'pad' ? 1.501 : 2.007)
    overtoneGain.gain.value = style === 'drum' ? .04 : .23
    primary.connect(gain)
    overtone.connect(overtoneGain).connect(gain)
    gain.connect(output)
    gain.gain.setValueAtTime(.0001, when)
    gain.gain.exponentialRampToValueAtTime(Math.max(.001, power), when + attack)
    gain.gain.exponentialRampToValueAtTime(.0001, when + length)
    primary.start(when)
    overtone.start(when)
    primary.stop(when + length + .01)
    overtone.stop(when + length + .01)
    primary.onended = () => { gain.disconnect(); primary.disconnect(); overtone.disconnect(); overtoneGain.disconnect() }
  }

  schedule() {
    if (this.ctx.state !== 'running') return
    const now = this.ctx.currentTime
    if (this.next < now) this.next = now + .025
    while (this.next < now + .25) {
      const { tempo, bars, melody } = scores[this.scene]
      const t = 30 / tempo
      const beat = this.step % 8
      const index = Math.floor(this.step / 8) % bars.length
      const chord = bars[index]
      if (this.musicVolume > 0) {
        if (!beat) {
          for (const [i, pitch] of chord.slice(0,3).entries())
            this.note(pitch, this.next + i * .04, t * 7.7, .055, 'pad', this.music)
        }
        if ([0, 2, 3, 5, 6].includes(beat))
          this.note(chord[[0,1,2,3,1,2,3][beat]] + (beat > 2 ? 12 : 0), this.next, t * 3.8, .091, 'harp', this.music)
        if (beat === 2 || beat === 6)
          this.note(melody[index * 2 + Number(beat === 6)], this.next + .045, t * 2.65, .05, 'harp', this.music)
        if (this.scene === 'battle' && (beat === 0 || beat === 4))
          this.note(chord[0] - 14, this.next, t * .84, .16, 'drum', this.music)
      }
      this.step++
      this.next += t
    }
  }

  fireRise() {
    const ctx = this.ctx
    const now = ctx.currentTime + .01
    const duration = 1.63
    if (!this.fireNoise) {
      this.fireNoise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate)
      const samples = this.fireNoise.getChannelData(0)
      let wind = 0
      for (let i = 0; i < samples.length; i++) {
        const grain = Math.random() * 2 - 1
        wind = wind * .90 + grain * .10
        samples[i] = wind * 1.2 + grain * .12
      }
    }
    const source = ctx.createBufferSource()
    source.buffer = this.fireNoise
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(255, now)
    filter.frequency.exponentialRampToValueAtTime(1570, now + .61)
    filter.frequency.exponentialRampToValueAtTime(240, now + duration)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(.62, now + .49)
    gain.gain.linearRampToValueAtTime(.37, now + .85)
    gain.gain.linearRampToValueAtTime(0, now + duration)
    source.connect(filter).connect(gain).connect(this.fx)
    source.start(now)
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect() }
  }

  play(type = 'tap', element) {
    if (!this.ctx || !this.volume) return
    if (type === 'fire-rise') { this.fireRise(); return }
    const effect = tones[type] ?? { notes: elements[element] ?? elements.fire, len: .42, power: .2 }
    for (const [index, pitch] of effect.notes.entries()) {
      this.note(pitch, this.ctx.currentTime + .013 + index * (type === 'evolve' ? .105 : .046),
        effect.len, effect.power / (1 + index * .32), ['impact','move'].includes(type) ? 'drum' : 'harp', this.fx)
    }
  }
}
