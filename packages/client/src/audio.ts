import { MusicPlayer, type SongName } from './music';
import { type Sample, SAMPLES } from './sfx';
import { type Fallback, fallbackFor, type Ost, sameTune, TrackQueue, type Tune, tracksOf } from './soundtrack';

/*
 * Sound effects, music and the dungeon's own air.
 *
 * Everything goes through one Web Audio graph: sounds, music and ambience have
 * their own levels (the music's and the sounds' are the player's to set), and
 * meet in a compressor so that a fight never clips. A sound can come from a
 * place in the world: it is then panned to the side it came from and quieter
 * the farther it is from the hero. A sound piling up on itself is thinned out.
 * The sounds are Shattered Pixel Dungeon's (sfx.ts says which plays when); beside
 * them a few are made here from noise and tones (a door knocking shut, the zoom's
 * tick, the arena's crowd...), and each region has its air: running water and
 * drips in the sewers, the prison's hum and chains, wind and falling pebbles in the
 * caves, the dwarven city's distant hammers, the demon halls' rumble and embers.
 *
 * The music is Shattered's soundtrack (soundtrack.ts says what plays where): its Ogg
 * tracks are fetched only when wanted (and a few ahead), decoded, kept a while, and
 * crossfaded. The game never waits for them: until a track is ready nothing plays.
 * Where a track cannot be decoded (iOS WebViews may not know Ogg Vorbis) the music
 * from before plays in its place, silently: the original's two tunes from files and
 * the tunes music.ts plays.
 *
 * Browsers (and Telegram on iOS) only allow audio after a user gesture, so it
 * all starts on the first tap; everything is suspended while the app is hidden.
 */

export type { Sample } from './sfx';

/** Sounds made here rather than loaded. */
export type Synth =
  | 'creak' | 'thud' | 'pop' | 'whoosh' | 'tick' | 'sizzle' | 'clank' | 'drip' | 'pebble' | 'sparkle' | 'knock' | 'crowd';

export type Sound = Sample | Synth;

/** A tune in progress (or silence): its fade, the track playing and what comes next, or the music from before in its place. */
interface Music {
  tune: Tune | null;
  queue: TrackQueue | null;
  /** Its own fade, into the music's filter. */
  gain: GainNode | null;
  source: AudioBufferSourceNode | null;
  /** The music from before, when Shattered's could not be decoded: from a file through an element, or played here. */
  element: HTMLAudioElement | null;
  player: MusicPlayer | null;
  /** Started (a track asked for); stopped for good (faded out). */
  started: boolean;
  stopped: boolean;
  /** Not before this time (performance.now): it waits for the last one to fade out. */
  notBefore: number;
  /** The track playing: its decoded sound, when it started on the context's clock, and from how far in. */
  buffer: AudioBuffer | null;
  startedAt: number;
  offset: number;
  /** Set aside (a list left for the tense track): faded out, its place kept, to go on from there. */
  parked: boolean;
  /** The timer that lets it go (or sets it aside) once faded out. */
  timer: number;
}

/** Shattered's tracks are wanted at this rate: lower than the context's, a decoded track takes less memory. */
const DECODE_RATE = 32000;
/** Decoded tracks kept (the one playing, the next, the last), and fetched files kept. */
const DECODED_KEPT = 3;
const FETCHED_KEPT = 14;
/** Our own crossfade, seconds, where Shattered just switches. */
export const CROSSFADE = 1.5;

/** A track that could not be fetched (rather than one that could not be decoded). */
class FetchError extends Error {}

/** How much a sound's pitch wanders from play to play (a fraction), if not the default. */
const VARY: Partial<Record<Sound, number>> = {
  click: 0, tick: 0, levelup: 0, boss: 0, badge: 0, descend: 0, secret: 0, death: 0, health_warn: 0, health_critical: 0,
  hit: 0, hit_slash: 0, hit_stab: 0, hit_crush: 0, hit_strong: 0, hit_parry: 0, hit_arrow: 0, hit_magic: 0,
  step: 0, sturdy: 0, grass: 0, trample: 0, water: 0, gold: 0, sheep: 0, drip: 0.15,
};
const DEFAULT_VARY = 0.03;
/** The fewest milliseconds between two of the same sound, and how many may sound at once. */
const GAP_MS = 28;
const VOICES = 3;
const MAX_VOICES = 28;

/** World pixels per cell, for distances. */
const CELL = 16;

interface Place {
  x: number;
  y: number;
}

/* Sounds made from noise and tones. */

/** A buffer filled sample by sample: `fn` gets the time in seconds and returns -1..1. */
function render(ctx: BaseAudioContext, seconds: number, fn: (t: number) => number): AudioBuffer {
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.max(1, Math.round(seconds * rate)), rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, fn(i / rate)));
  return buffer;
}

/** White noise from a fixed seed: the made sounds are the same on every device. */
function noiseSource(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

/** A one-pole low-pass filter at `hz`, run sample by sample. */
function lowpass(rate: number, hz: number): (x: number) => number {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / rate);
  let y = 0;
  return (x) => (y += a * (x - y));
}

function bandpass(rate: number, low: number, high: number): (x: number) => number {
  const lo = lowpass(rate, high);
  const hi = lowpass(rate, low);
  return (x) => {
    const below = lo(x);
    return below - hi(below);
  };
}

const TAU = Math.PI * 2;

function makeSynth(ctx: BaseAudioContext, name: Synth): AudioBuffer {
  const rate = ctx.sampleRate;
  const noise = noiseSource(name.length * 7919 + name.charCodeAt(0));
  switch (name) {
    case 'thud': {
      // A door falling shut: a low knock and the latch.
      const low = lowpass(rate, 900);
      let phase = 0;
      return render(ctx, 0.3, (t) => {
        phase += (TAU * (40 + 90 * Math.exp(-t * 14))) / rate;
        const click = t > 0.045 && t < 0.06 ? noise() * 0.5 * Math.exp(-(t - 0.045) * 300) : 0;
        return Math.sin(phase) * Math.exp(-t * 15) * 0.9 + low(noise()) * Math.exp(-t * 50) * 0.6 + click;
      });
    }
    case 'knock': {
      let phase = 0;
      return render(ctx, 0.12, (t) => {
        phase += (TAU * (120 + 160 * Math.exp(-t * 40))) / rate;
        return Math.sin(phase) * Math.exp(-t * 38) * 0.8 + noise() * Math.exp(-t * 200) * 0.25;
      });
    }
    case 'creak': {
      // Old hinges: a sawing tone that catches and slips.
      const band = bandpass(rate, 250, 2400);
      let phase = 0;
      return render(ctx, 0.42, (t) => {
        const f = 210 + 70 * Math.sin(t * 9) + 25 * Math.sin(t * 61);
        phase += f / rate;
        const saw = (phase % 1) * 2 - 1;
        const stick = 0.55 + 0.45 * Math.sin(t * 80) * Math.sin(t * 23);
        const env = Math.min(1, t / 0.03) * Math.exp(-t * 4.5);
        return band(saw * stick + noise() * 0.15) * 2.2 * env;
      });
    }
    case 'pop': {
      let phase = 0;
      return render(ctx, 0.1, (t) => {
        phase += (TAU * (320 + 1300 * (t / 0.1))) / rate;
        return Math.sin(phase) * Math.exp(-t * 32) * 0.6;
      });
    }
    case 'whoosh': {
      let cut = 0;
      const lowA = lowpass(rate, 600);
      return render(ctx, 0.32, (t) => {
        // The air's pitch rises as it passes.
        cut = lowA(noise());
        const shape = Math.sin((Math.PI * t) / 0.32);
        return (noise() * 0.35 + cut * 1.5) * shape * shape * 0.5;
      });
    }
    case 'tick':
      return render(ctx, 0.035, (t) => Math.sin(TAU * 1900 * t) * Math.exp(-t * 170) * 0.5);
    case 'crowd': {
      // The arena's stands after a wave: a roar of many voices swelling and falling away, and claps in it.
      const voices = bandpass(rate, 300, 2200);
      const air = bandpass(rate, 1800, 5000);
      const claps = Array.from({ length: 26 }, (_, i) => 0.15 + ((i * 0.6180339) % 1) * 1.6);
      return render(ctx, 2.1, (t) => {
        const swell = Math.min(1, t / 0.35) * Math.exp(-Math.max(0, t - 0.6) * 1.6);
        // Voices: noise through the voice band, wavering as a crowd's shout does.
        const waver = 0.75 + 0.25 * Math.sin(TAU * 5.3 * t) * Math.sin(TAU * 2.1 * t + 1);
        let s = voices(noise()) * 1.5 * waver * swell + air(noise()) * 0.25 * swell;
        for (const at of claps) {
          const u = t - at;
          if (u > 0 && u < 0.03) s += noise() * 0.35 * Math.exp(-u * 160);
        }
        return s * 0.55;
      });
    }
    case 'sizzle': {
      // Embers and torches: a hiss with crackles in it.
      const hiss = bandpass(rate, 2500, 9000);
      return render(ctx, 0.5, (t) => {
        const crackle = Math.random() < 0.0016 ? 1 : 0;
        return hiss(noise()) * 0.5 * Math.exp(-t * 5) + crackle * noise() * 0.8;
      });
    }
    case 'clank': {
      // Iron on iron, somewhere: inharmonic partials ringing down.
      return render(ctx, 0.9, (t) => {
        const env = Math.min(1, t / 0.003);
        return (Math.sin(TAU * 523 * t) * Math.exp(-t * 6) + 0.7 * Math.sin(TAU * 1187 * t) * Math.exp(-t * 8)
          + 0.5 * Math.sin(TAU * 1733 * t) * Math.exp(-t * 11) + 0.35 * Math.sin(TAU * 2417 * t) * Math.exp(-t * 14)) * 0.3 * env;
      });
    }
    case 'drip': {
      let phase = 0;
      return render(ctx, 0.2, (t) => {
        phase += (TAU * (850 + 1000 * (1 - Math.exp(-t * 45)))) / rate;
        return Math.sin(phase) * Math.exp(-t * 28) * 0.5;
      });
    }
    case 'pebble': {
      // A few small stones skittering down.
      const hits = [0, 0.07, 0.13, 0.2, 0.31].map((at, i) => ({ at: at + (i % 2) * 0.01, f: 1400 + i * 260 }));
      const low = lowpass(rate, 3500);
      return render(ctx, 0.5, (t) => {
        let s = 0;
        for (const hit of hits) {
          if (t < hit.at) continue;
          const u = t - hit.at;
          s += (Math.sin(TAU * hit.f * u) * 0.4 + low(noise()) * 0.5) * Math.exp(-u * 55);
        }
        return s * 0.5;
      });
    }
    case 'sparkle': {
      // Three bright notes, one after another: something good inside.
      const notes = [1568, 2093, 2637];
      return render(ctx, 0.55, (t) => {
        let s = 0;
        notes.forEach((f, i) => {
          const u = t - i * 0.06;
          if (u > 0) s += Math.sin(TAU * f * u) * Math.exp(-u * 9) * Math.min(1, u / 0.004);
        });
        return s * 0.22;
      });
    }
  }
}

const SYNTHS: readonly Synth[] = [
  'creak', 'thud', 'pop', 'whoosh', 'tick', 'sizzle', 'clank', 'drip', 'pebble', 'sparkle', 'knock', 'crowd',
];


/* The regions' air: a bed of filtered noise, a drone, and sounds now and then. */

interface Air {
  /** Noise through a filter: its kind, centre, level; `sway` slowly moves the centre (wind). */
  noise?: { type: BiquadFilterType; hz: number; q?: number; gain: number; sway?: number };
  /** Low tones held under everything. */
  drone?: { hz: readonly number[]; gain: number };
  /** Now-and-then sounds: which, how often (ms between), how loud, at what pitches. */
  events: ReadonlyArray<{ sound: Sound; every: readonly [number, number]; volume: number; rate: readonly [number, number] }>;
}

const AIRS: readonly Air[] = [
  // The sewers: water running somewhere, drips from the pipes.
  {
    noise: { type: 'lowpass', hz: 420, gain: 0.07, sway: 80 },
    events: [
      { sound: 'drip', every: [1400, 4200], volume: 0.18, rate: [0.8, 1.35] },
      { sound: 'water', every: [7000, 15000], volume: 0.06, rate: [0.7, 0.9] },
    ],
  },
  // The prison: a low hum, chains, torches.
  {
    noise: { type: 'lowpass', hz: 220, gain: 0.05 },
    drone: { hz: [58], gain: 0.012 },
    events: [
      { sound: 'clank', every: [8000, 17000], volume: 0.07, rate: [0.55, 0.8] },
      { sound: 'sizzle', every: [2500, 6000], volume: 0.06, rate: [0.8, 1.2] },
    ],
  },
  // The caves: wind through the tunnels, stones falling.
  {
    noise: { type: 'bandpass', hz: 520, q: 0.8, gain: 0.09, sway: 260 },
    events: [
      { sound: 'pebble', every: [4500, 10000], volume: 0.12, rate: [0.7, 1.1] },
      { sound: 'drip', every: [3000, 7000], volume: 0.1, rate: [0.6, 0.9] },
    ],
  },
  // The dwarven city: a deep hum, far-off hammers.
  {
    noise: { type: 'lowpass', hz: 260, gain: 0.04 },
    drone: { hz: [55, 82.5], gain: 0.01 },
    events: [
      { sound: 'clank', every: [5000, 11000], volume: 0.05, rate: [1.1, 1.4] },
      { sound: 'knock', every: [6000, 12000], volume: 0.08, rate: [0.6, 0.8] },
    ],
  },
  // The demon halls: the ground rumbles, embers hiss.
  {
    noise: { type: 'lowpass', hz: 170, gain: 0.08, sway: 40 },
    drone: { hz: [41, 61.5, 82], gain: 0.016 },
    events: [
      { sound: 'sizzle', every: [1800, 4500], volume: 0.09, rate: [0.7, 1.1] },
      { sound: 'burning', every: [7000, 14000], volume: 0.05, rate: [0.7, 0.9] },
    ],
  },
];

/** The camp's air (the home screen): the night's low wind, and the fire crackling now and then. */
const CAMP_AIR: Air = {
  noise: { type: 'lowpass', hz: 320, gain: 0.035, sway: 90 },
  events: [
    { sound: 'sizzle', every: [700, 2200], volume: 0.1, rate: [0.9, 1.4] },
    { sound: 'puff', every: [6000, 14000], volume: 0.03, rate: [1.2, 1.7] },
  ],
};

/** A region's air, playing: its nodes, faded out and stopped when the region changes. */
interface Playing {
  gain: GainNode;
  nodes: AudioScheduledSourceNode[];
  timer: number;
}

function stored(key: string, fallback: number): number {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : Math.max(0, Math.min(1, Number(value)));
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered.
  }
}

class Audio {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<Sound, AudioBuffer>();
  private unlocked = false;
  /** The graph: master → compressor → out; each bus into master. */
  private sfx: GainNode | null = null;
  private air: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicDuck: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private music: Music | null = null;
  /** A list set aside for a while (see park), to go on from where it was. */
  private parked: Music | null = null;
  /** Shattered's tracks, fetched (the files) and decoded (a few): kept as promises, the oldest let go. */
  private readonly fetched = new Map<Ost, Promise<ArrayBuffer>>();
  private readonly decoded = new Map<Ost, Promise<AudioBuffer>>();
  /** A track would not decode: this device plays the music from before instead. */
  private oggUnsupported = false;
  private prefetching: Ost[] = [];
  private prefetchTimer = 0;
  private region: number | 'camp' | null = null;
  private playing: Playing | null = null;
  private noise: AudioBuffer | null = null;
  /** Where the hero is, world pixels: sounds with a place are heard from there. */
  private listener: Place | null = null;
  private readonly last = new Map<Sound, number>();
  private readonly voices = new Map<Sound, number>();
  private total = 0;
  enabled: boolean;
  /** The player's levels, 0 to 1. */
  musicVolume: number;
  soundVolume: number;

  constructor(private readonly base: string) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('pd-sound');
    } catch {
      // Defaults to on.
    }
    this.enabled = saved !== 'off';
    this.musicVolume = stored('pd-music-volume', 0.6);
    this.soundVolume = stored('pd-sound-volume', 0.8);
    const unlock = (): void => this.unlock();
    // Safari on iOS lets sound start only from touchend or click, not pointerdown: every one of them
    // tries, until the context runs.
    for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) addEventListener(type, unlock, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Tracks and tunes played here need nothing: their clock stops with the context's.
        this.music?.element?.pause();
        void this.context?.suspend();
      } else {
        void this.context?.resume();
        this.startMusic();
      }
    });
  }

  /** A moment of silence played inside the gesture: what finally wakes a context on iOS. */
  private silence(ctx: AudioContext): void {
    try {
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, 22050);
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // Nothing to wake.
    }
  }

  private unlock(): void {
    if (this.unlocked) {
      if (this.context && this.context.state !== 'running' && !document.hidden) {
        void this.context.resume();
        this.silence(this.context);
      }
      return;
    }
    this.unlocked = true;
    try {
      const ctx = new AudioContext();
      this.context = ctx;
      void ctx.resume();
      this.silence(ctx);
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 10;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;
      const master = ctx.createGain();
      master.gain.value = 0.95;
      master.connect(compressor).connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.air = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.musicDuck = ctx.createGain();
      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 20000;
      this.sfx.connect(master);
      this.air.connect(master);
      this.musicFilter.connect(this.musicDuck).connect(this.musicBus).connect(master);
      this.levels();
      for (const name of SAMPLES) void this.load(name);
      for (const name of SYNTHS) this.buffers.set(name, makeSynth(ctx, name));
      const white = noiseSource(12345);
      this.noise = render(ctx, 3, () => white());
    } catch {
      this.context = null;
    }
    this.startMusic();
    this.startAir();
  }

  private async load(name: Sample): Promise<void> {
    try {
      const response = await fetch(`${this.base}spd/${name}.mp3`);
      const data = await response.arrayBuffer();
      this.buffers.set(name, await this.context!.decodeAudioData(data));
    } catch {
      // Without that sound.
    }
  }

  /** Applies the player's levels to the buses. */
  private levels(): void {
    const ctx = this.context;
    if (!ctx || !this.sfx || !this.air || !this.musicBus) return;
    const on = this.enabled ? 1 : 0;
    const at = ctx.currentTime;
    this.sfx.gain.setTargetAtTime(on * this.soundVolume, at, 0.05);
    this.air.gain.setTargetAtTime(on * this.soundVolume, at, 0.3);
    // The music's level is a gentle curve: half way sounds like half.
    this.musicBus.gain.setTargetAtTime(on * this.musicVolume * this.musicVolume * 0.75, at, 0.1);
    if (this.music?.element && !this.music.gain) this.music.element.volume = on * this.musicVolume * 0.6;
  }

  /** The music playing now (or the silence asked for). */
  get tune(): Tune | null {
    return this.music?.tune ?? null;
  }

  /** The hero's place, world pixels: what sounds from somewhere is heard from here. */
  listen(x: number, y: number): void {
    this.listener = { x, y };
  }

  /**
   * Plays a sound: `rate` (pitch), `volume`, and where in the world it comes from, if anywhere.
   * Its pitch wanders a little unless `rate` is given exactly... it wanders around `rate`.
   */
  play(name: Sound, rate = 1, volume = 1, at?: Place, pan?: number): void {
    const ctx = this.context;
    if (!this.enabled || !ctx || !this.sfx || document.hidden || ctx.state !== 'running') return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const now = performance.now();
    // Not the same sound on top of itself, nor too many at once.
    if (now - (this.last.get(name) ?? -1e9) < GAP_MS) return;
    if ((this.voices.get(name) ?? 0) >= VOICES || this.total >= MAX_VOICES) return;
    this.last.set(name, now);

    let gainValue = volume * (0.92 + Math.random() * 0.16);
    let panValue = pan ?? 0;
    if (at && this.listener) {
      const dx = (at.x - this.listener.x) / CELL;
      const dy = (at.y - this.listener.y) / CELL;
      const distance = Math.hypot(dx, dy);
      panValue = Math.max(-0.75, Math.min(0.75, dx / 7));
      gainValue *= 1 / (1 + Math.max(0, distance - 1.5) * 0.14);
    }
    if (gainValue < 0.01) return;
    const vary = VARY[name] ?? DEFAULT_VARY;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    let tail: AudioNode = source.connect(gain);
    if (panValue !== 0 && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = panValue;
      tail = tail.connect(panner);
    }
    tail.connect(this.sfx);
    this.voices.set(name, (this.voices.get(name) ?? 0) + 1);
    this.total++;
    source.onended = () => {
      this.voices.set(name, Math.max(0, (this.voices.get(name) ?? 1) - 1));
      this.total = Math.max(0, this.total - 1);
      gain.disconnect();
    };
    source.start();
  }

  /** Plays a sound a little later (a sequence: a chest's creak, then what is inside). */
  later(ms: number, name: Sound, rate = 1, volume = 1, at?: Place): void {
    window.setTimeout(() => this.play(name, rate, volume, at), ms);
  }

  /**
   * Plays a tune (or none: Music.end), unless it is the one playing (Music.playTracks: the same list, even
   * shifted, goes on). The last one fades out over `fade` seconds; with `after`, the new one waits for that
   * (Music.fadeOut and then play), else the two cross.
   */
  playMusic(tune: Tune | null, fade = CROSSFADE, after = false): void {
    if (this.music && sameTune(this.music.tune, tune)) return;
    const old = this.music;
    const back = this.parked && sameTune(this.parked.tune, tune) ? this.parked : null;
    if (back) {
      // The list set aside comes back where it was, rather than starting over.
      this.parked = null;
      this.music = back;
    } else {
      this.music = {
        tune, queue: tune ? new TrackQueue(tune) : null, gain: null, source: null, element: null, player: null,
        started: false, stopped: false, notBefore: after && old?.started ? performance.now() + fade * 1000 : 0,
        buffer: null, startedAt: 0, offset: 0, parked: false, timer: 0,
      };
    }
    if (old) {
      // A list left for a while (the tense track in a fight) is set aside to go on later; anything else is let go.
      if (old.tune && 'tracks' in old.tune && old.started && !after) this.park(old, fade);
      else this.fadeOut(old, fade);
    }
    if (back) this.resume(back);
    if (this.music.notBefore > 0) window.setTimeout(() => this.startMusic(), fade * 1000 + 20);
    this.startMusic();
  }

  /** Fades a list out and keeps its place: the track and how far into it, its queue. */
  private park(old: Music, seconds: number): void {
    if (this.parked && this.parked !== old) this.fadeOut(this.parked, 0);
    this.parked = old;
    old.stopped = true;
    const ctx = this.context;
    if (!ctx || !old.gain) return;
    old.gain.gain.cancelScheduledValues(ctx.currentTime);
    old.gain.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.05, seconds / 3));
    window.clearTimeout(old.timer);
    old.timer = window.setTimeout(() => {
      if (this.parked !== old) return;
      old.parked = true;
      const source = old.source;
      if (source && old.buffer) {
        const played = ctx.currentTime - old.startedAt + old.offset;
        old.offset = source.loop ? played % old.buffer.duration : Math.min(played, old.buffer.duration);
        source.onended = null;
        try {
          source.stop();
        } catch {
          // Not started.
        }
        source.disconnect();
        old.source = null;
      }
      old.element?.pause();
      old.player?.pause();
    }, seconds * 1000 + 300);
  }

  /** A list set aside comes back: faded in, from where it was. */
  private resume(music: Music): void {
    const ctx = this.context;
    window.clearTimeout(music.timer);
    music.stopped = false;
    music.notBefore = 0;
    if (ctx && music.gain) {
      music.gain.gain.cancelScheduledValues(ctx.currentTime);
      music.gain.gain.setTargetAtTime(1, ctx.currentTime + 0.05, CROSSFADE / 3);
    }
    const wasParked = music.parked;
    music.parked = false;
    // Still sounding (back before it had faded), or the music from before (startMusic plays it again).
    if (music.source || music.element || music.player || !music.started) return;
    if (wasParked && music.buffer && ctx && music.gain && this.enabled) {
      this.startSource(music, music.buffer, music.offset);
    } else if (music.queue) {
      // Its track ended, or had not come yet, while it was set aside: the next one.
      const next = music.queue.next();
      if (next) this.playTrack(music, next);
    }
  }

  /** Fades a tune out over `seconds` (while the next comes in), then lets it go. */
  private fadeOut(old: Music, seconds: number): void {
    const ctx = this.context;
    old.stopped = true;
    const stop = (): void => {
      try {
        old.source?.stop();
      } catch {
        // Not started.
      }
      old.element?.pause();
      old.player?.dispose();
      old.gain?.disconnect();
    };
    window.clearTimeout(old.timer);
    if (ctx && old.gain && old.started && seconds > 0) {
      // Its own fade-in may not have begun yet: that is dropped, and the fade-out starts from where it is.
      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.05, seconds / 3));
      window.setTimeout(stop, seconds * 1000 + 300);
    } else {
      stop();
    }
  }

  /** A gain into the music's filter that brings a new tune in rather than starting it at full. */
  private fadeIn(ctx: AudioContext, filter: AudioNode): GainNode {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(filter);
    gain.gain.setTargetAtTime(1, ctx.currentTime + 0.05, CROSSFADE / 3);
    return gain;
  }

  private startMusic(): void {
    const music = this.music;
    if (!this.unlocked || !this.enabled || !music?.tune || document.hidden || music.stopped) return;
    if (performance.now() < music.notBefore) return;
    if (music.element) void music.element.play().catch(() => undefined);
    music.player?.play();
    if (music.started) return;
    const ctx = this.context;
    if (!ctx || !this.musicFilter) {
      // No audio graph: only the original's tunes from files can play.
      this.startFallback(music, fallbackFor(tracksOf(music.tune)[0]!));
      return;
    }
    music.started = true;
    music.gain = this.fadeIn(ctx, this.musicFilter);
    const first = music.queue!.next();
    if (first) this.playTrack(music, first);
  }

  /** One of the tune's tracks, when it is ready; a list goes on to its next track as each ends (Music.trackLooper). */
  private playTrack(music: Music, track: Ost): void {
    if (this.oggUnsupported) {
      this.startFallback(music, fallbackFor(track));
      return;
    }
    this.decode(track).then(
      (buffer) => {
        if (music !== this.music || music.stopped || !this.context || !music.gain || !this.enabled) return;
        this.startSource(music, buffer, 0);
        // The next is fetched and decoded while this one plays, to follow it without a gap.
        const next = music.queue!.peek();
        if (next && next !== track) void this.decode(next).catch(() => undefined);
      },
      (error: unknown) => {
        // A file that will not decode: this device cannot play Shattered's tracks. One that would not come: this once.
        if (!(error instanceof FetchError)) this.oggUnsupported = true;
        if (music === this.music && !music.stopped) this.startFallback(music, fallbackFor(track));
      },
    );
  }

  /** A decoded track playing into the tune's fade, from `offset` seconds in; a list goes on to its next as it ends. */
  private startSource(music: Music, buffer: AudioBuffer, offset: number): void {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = 'loop' in music.tune!;
    source.connect(music.gain!);
    source.onended = () => {
      source.disconnect();
      if (music.source !== source || music.stopped || music !== this.music) return;
      music.source = null;
      const next = music.queue!.next();
      if (next) this.playTrack(music, next);
    };
    music.source = source;
    music.buffer = buffer;
    music.startedAt = ctx.currentTime;
    music.offset = offset;
    source.start(0, offset);
  }

  /** The music from before in the place of a track: the original's tunes from files, or one played here. */
  private startFallback(music: Music, fallback: Fallback): void {
    if (music.element || music.player || music.stopped) return;
    music.started = true;
    const ctx = this.context;
    if (fallback !== 'theme' && fallback !== 'game') {
      // A tune played here needs the audio graph; without one there is no such music.
      if (!ctx || !this.musicFilter) return;
      music.gain ??= this.fadeIn(ctx, this.musicFilter);
      music.player = new MusicPlayer(ctx, fallback as SongName, music.gain);
      if (this.enabled && !document.hidden) music.player.play();
      return;
    }
    const element = new window.Audio(`${this.base}${fallback}.mp3`);
    element.loop = true;
    element.preload = 'auto';
    if (ctx && this.musicFilter) {
      try {
        const source = ctx.createMediaElementSource(element);
        music.gain ??= this.fadeIn(ctx, this.musicFilter);
        source.connect(music.gain);
      } catch {
        music.gain = null;
      }
    }
    music.element = element;
    this.levels();
    if (this.enabled && !document.hidden) void element.play().catch(() => undefined);
  }

  /** A track's file, fetched once and kept a while. */
  private fetchTrack(track: Ost): Promise<ArrayBuffer> {
    let data = this.fetched.get(track);
    if (data) {
      this.fetched.delete(track);
    } else {
      const fetching = fetch(`${this.base}spd/music/${track}.ogg`).then(
        (response) => {
          if (!response.ok) throw new FetchError(String(response.status));
          return response.arrayBuffer();
        },
        (error: unknown) => {
          throw new FetchError(String(error));
        },
      );
      // A failed fetch is tried again the next time.
      fetching.catch(() => {
        if (this.fetched.get(track) === fetching) this.fetched.delete(track);
      });
      data = fetching;
    }
    this.fetched.set(track, data);
    while (this.fetched.size > FETCHED_KEPT) this.fetched.delete(this.fetched.keys().next().value!);
    return data;
  }

  /** A track decoded (at a lower rate where the browser allows: less memory), kept while it is among the last few. */
  private decode(track: Ost): Promise<AudioBuffer> {
    let buffer = this.decoded.get(track);
    if (buffer) {
      this.decoded.delete(track);
    } else {
      const decoding = this.fetchTrack(track).then((data) => this.decodeOgg(data));
      decoding.catch(() => {
        if (this.decoded.get(track) === decoding) this.decoded.delete(track);
      });
      buffer = decoding;
    }
    this.decoded.set(track, buffer);
    while (this.decoded.size > DECODED_KEPT) this.decoded.delete(this.decoded.keys().next().value!);
    return buffer;
  }

  private async decodeOgg(data: ArrayBuffer): Promise<AudioBuffer> {
    // decodeAudioData takes the bytes for itself: each try gets a copy, and the kept file stays whole.
    const attempt = (ctx: BaseAudioContext): Promise<AudioBuffer> =>
      new Promise<AudioBuffer>((resolve, reject) => {
        // Older Safari answers only by callbacks; the others by both.
        const done = ctx.decodeAudioData(data.slice(0), resolve, reject) as Promise<AudioBuffer> | undefined;
        done?.then(resolve, reject);
      });
    let offline: OfflineAudioContext | null = null;
    try {
      offline = new OfflineAudioContext(2, 1, DECODE_RATE);
    } catch {
      // No offline context at that rate here: decoded at the context's own.
    }
    if (offline) {
      try {
        return await attempt(offline);
      } catch {
        // Tried once more by the context itself, which may know more.
      }
    }
    if (!this.context) throw new Error('no audio');
    return attempt(this.context);
  }

  /**
   * Shattered's tracks likely wanted soon (the rest of the region's, the boss's, the next region's), fetched
   * one at a time in the background, nothing decoded.
   */
  prefetch(tracks: readonly Ost[]): void {
    if (this.oggUnsupported || !this.unlocked || !this.enabled) return;
    const wanted = tracks.filter((track, i) => tracks.indexOf(track) === i && !this.fetched.has(track));
    if (wanted.join() === this.prefetching.join()) return;
    this.prefetching = wanted;
    window.clearTimeout(this.prefetchTimer);
    const next = (): void => {
      const track = this.prefetching.shift();
      if (!track || this.oggUnsupported) return;
      // While the music has not got its own track yet, it goes first.
      const music = this.music;
      if (music?.started && !music.source && !music.element && !music.player) {
        this.prefetching.unshift(track);
        this.prefetchTimer = window.setTimeout(next, 1000);
        return;
      }
      this.fetchTrack(track).then(
        () => {
          this.prefetchTimer = window.setTimeout(next, 400);
        },
        () => undefined,
      );
    };
    this.prefetchTimer = window.setTimeout(next, 2500);
  }

  /** The music dips for a moment under something that matters (a boss, a level gained, death). */
  duck(depth = 0.35, ms = 1200): void {
    const ctx = this.context;
    if (!ctx || !this.musicDuck) return;
    const at = ctx.currentTime;
    const gain = this.musicDuck.gain;
    gain.cancelScheduledValues(at);
    gain.setTargetAtTime(depth, at, 0.06);
    gain.setTargetAtTime(1, at + ms / 1000, 0.5);
  }

  /** Muffled, as if through a door: while a window is open over the game, or the hero has fallen. */
  muffle(on: boolean): void {
    const ctx = this.context;
    if (!ctx || !this.musicFilter) return;
    this.musicFilter.frequency.setTargetAtTime(on ? 700 : 20000, ctx.currentTime, on ? 0.12 : 0.25);
  }

  /** The air of a region (0 sewers ... 4 demon halls), or none (the title). */
  ambience(region: number | 'camp' | null): void {
    if (region === this.region) return;
    this.region = region;
    this.stopAir();
    this.startAir();
  }

  private stopAir(): void {
    const playing = this.playing;
    const ctx = this.context;
    this.playing = null;
    if (!playing || !ctx) return;
    window.clearTimeout(playing.timer);
    playing.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    window.setTimeout(() => {
      for (const node of playing.nodes) {
        try {
          node.stop();
        } catch {
          // Already stopped.
        }
      }
      playing.gain.disconnect();
    }, 2500);
  }

  private startAir(): void {
    const ctx = this.context;
    const air = this.region === null ? undefined : this.region === 'camp' ? CAMP_AIR : AIRS[this.region];
    if (!ctx || !this.air || !this.noise || !air || this.playing) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.air);
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    const nodes: AudioScheduledSourceNode[] = [];
    if (air.noise) {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = air.noise.type;
      filter.frequency.value = air.noise.hz;
      filter.Q.value = air.noise.q ?? 0.7;
      const level = ctx.createGain();
      level.gain.value = air.noise.gain;
      source.connect(filter).connect(level).connect(gain);
      if (air.noise.sway) {
        // The wind rises and falls.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07;
        const depth = ctx.createGain();
        depth.gain.value = air.noise.sway;
        lfo.connect(depth).connect(filter.frequency);
        lfo.start();
        nodes.push(lfo);
      }
      source.start();
      nodes.push(source);
    }
    for (const hz of air.drone?.hz ?? []) {
      const tone = ctx.createOscillator();
      tone.type = 'sine';
      tone.frequency.value = hz;
      tone.detune.value = (Math.random() - 0.5) * 8;
      const level = ctx.createGain();
      level.gain.value = air.drone!.gain;
      tone.connect(level).connect(gain);
      tone.start();
      nodes.push(tone);
    }
    const playing: Playing = { gain, nodes, timer: 0 };
    this.playing = playing;
    // Now and then, somewhere to one side or the other.
    const next = (): void => {
      if (this.playing !== playing) return;
      const event = air.events[Math.floor(Math.random() * air.events.length)];
      if (event && !document.hidden) {
        const rate = event.rate[0] + Math.random() * (event.rate[1] - event.rate[0]);
        this.playAir(event.sound, rate, event.volume, (Math.random() * 2 - 1) * 0.8, gain);
      }
      const gap = event ? event.every[0] + Math.random() * (event.every[1] - event.every[0]) : 4000;
      playing.timer = window.setTimeout(next, gap / Math.max(1, air.events.length * 0.75));
    };
    playing.timer = window.setTimeout(next, 1500);
  }

  /** An ambient one-off through the region's own fade. */
  private playAir(name: Sound, rate: number, volume: number, pan: number, into: GainNode): void {
    const ctx = this.context;
    const buffer = this.buffers.get(name);
    if (!ctx || !buffer || ctx.state !== 'running') return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(gain).connect(panner).connect(into);
    source.onended = () => panner.disconnect();
    source.start();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    store('pd-sound', enabled ? 'on' : 'off');
    this.levels();
    const music = this.music;
    if (enabled) {
      this.startMusic();
    } else if (music) {
      // Music.enable(false) stops it; on again, the tune starts over.
      this.music = null;
      this.fadeOut(music, 0.2);
      this.playMusic(music.tune);
    }
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    store('pd-music-volume', String(this.musicVolume));
    this.levels();
  }

  setSoundVolume(volume: number): void {
    this.soundVolume = Math.max(0, Math.min(1, volume));
    store('pd-sound-volume', String(this.soundVolume));
    this.levels();
  }
}

export const audio = new Audio(`${import.meta.env.BASE_URL}audio/`);
