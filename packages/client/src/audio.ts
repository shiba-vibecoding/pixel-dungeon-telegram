import { MusicPlayer, type SongName, SONGS } from './music';

/*
 * Sound effects, music and the dungeon's own air.
 *
 * Everything goes through one Web Audio graph: sounds, music and ambience have
 * their own levels (the music's and the sounds' are the player's to set), and
 * meet in a compressor so that a fight never clips. A sound can come from a
 * place in the world: it is then panned to the side it came from and quieter
 * the farther it is from the hero. No sound plays twice the same: pitch and
 * level wander a little, and a sound piling up on itself is thinned out.
 * Beside the original's samples there are sounds made here from noise and
 * tones (a door's creak and thud, grass, coins, a pickup's pop...), and each
 * region has its air: running water and drips in the sewers, the prison's hum
 * and chains, wind and falling pebbles in the caves, the dwarven city's distant
 * hammers, the demon halls' rumble and embers.
 *
 * The title and the sewers have the original's two tunes, from files; the regions
 * below and the boss fights have tunes of their own, played by music.ts. Either kind
 * crossfades into the other.
 *
 * Browsers (and Telegram on iOS) only allow audio after a user gesture, so it
 * all starts on the first tap; everything is suspended while the app is hidden.
 */

export type Sample =
  | 'hit' | 'miss' | 'step' | 'water' | 'death' | 'levelup' | 'descend' | 'door_open' | 'secret' | 'alert'
  | 'click' | 'boss' | 'gold' | 'item' | 'drink' | 'bones' | 'read' | 'teleport' | 'trap' | 'lightning' | 'burning'
  | 'zap' | 'unlock' | 'ghost' | 'eat' | 'shatter' | 'dewdrop' | 'puff' | 'rocks' | 'falling' | 'blast' | 'evoke'
  | 'beacon' | 'bee' | 'cursed' | 'badge' | 'degrade';

/** Sounds made here rather than loaded. */
export type Synth =
  | 'creak' | 'thud' | 'rustle' | 'coin' | 'pop' | 'whoosh' | 'tick' | 'sizzle' | 'clank' | 'drip' | 'pebble' | 'sparkle'
  | 'stepWood' | 'stepGrass' | 'knock' | 'crowd';

/**
 * Shattered's sounds (Assets.Sounds) the levels stream plays that have no file of their own here yet:
 * each plays the nearest existing one until the audio stream brings Shattered's files.
 */
export type LevelSound =
  | 'gas' | 'ray' | 'mine' | 'trample' | 'tomb' | 'sheep' | 'grass' | 'chains' | 'chime' | 'scan' | 'mimic' | 'boulder' | 'chargeup' | 'hit_parry';
const LEVEL_SOUNDS: Readonly<Record<LevelSound, Sample | Synth>> = {
  gas: 'puff', ray: 'zap', mine: 'rocks', trample: 'rustle', tomb: 'bones', sheep: 'puff', grass: 'stepGrass', chains: 'clank',
  chime: 'sparkle', scan: 'zap', mimic: 'bones', boulder: 'rocks', chargeup: 'evoke', hit_parry: 'clank',
};

export type Sound = Sample | Synth | LevelSound;

/** The music: the original's tunes from files, or one played here. */
export type Track = 'theme' | 'game' | SongName;

const SONG_NAMES: ReadonlySet<string> = new Set<string>(SONGS);
const isSong = (track: Track): track is SongName => SONG_NAMES.has(track);

/** A tune playing, faded in and out through its own gain: from a file through an element, or played here. */
interface Music {
  track: Track;
  element: HTMLAudioElement | null;
  player: MusicPlayer | null;
  gain: GainNode | null;
}

const SAMPLES: readonly Sample[] = [
  'hit', 'miss', 'step', 'water', 'death', 'levelup', 'descend', 'door_open', 'secret', 'alert',
  'click', 'boss', 'gold', 'item', 'drink', 'bones', 'read', 'teleport', 'trap', 'lightning', 'burning', 'zap', 'unlock', 'ghost',
  'eat', 'shatter', 'dewdrop', 'puff', 'rocks', 'falling', 'blast', 'evoke', 'beacon', 'bee', 'cursed', 'badge', 'degrade',
];

/** How much a sound's pitch wanders from play to play (a fraction), if not the default. */
const VARY: Partial<Record<Sound, number>> = {
  click: 0, tick: 0, levelup: 0, boss: 0, badge: 0, descend: 0, secret: 0.02, death: 0.02,
  step: 0.07, stepGrass: 0.1, stepWood: 0.08, hit: 0.08, miss: 0.08, coin: 0.06, rustle: 0.12, drip: 0.15,
};
const DEFAULT_VARY = 0.04;
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
    case 'rustle': case 'stepGrass': {
      // Leaves brushed aside: a burst of airy noise.
      const band = bandpass(rate, 1400, 6500);
      const d = name === 'rustle' ? 0.22 : 0.12;
      return render(ctx, d, (t) => band(noise()) * 1.8 * (1 - Math.exp(-t * 150)) * Math.exp(-t * (name === 'rustle' ? 16 : 30)) * (0.7 + 0.3 * Math.sin(t * 190)));
    }
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
    case 'stepWood': {
      let phase = 0;
      const low = lowpass(rate, 1800);
      return render(ctx, 0.11, (t) => {
        phase += (TAU * (150 + 90 * Math.exp(-t * 60))) / rate;
        return Math.sin(phase) * Math.exp(-t * 45) * 0.55 + low(noise()) * Math.exp(-t * 90) * 0.5;
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
    case 'coin': {
      // A coin's ring: bright partials dying fast.
      return render(ctx, 0.3, (t) => {
        const env = Math.min(1, t / 0.002) * Math.exp(-t * 17);
        return (Math.sin(TAU * 3150 * t) + 0.6 * Math.sin(TAU * 4730 * t) + 0.35 * Math.sin(TAU * 6310 * t + 1)) * 0.38 * env;
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
  'creak', 'thud', 'rustle', 'coin', 'pop', 'whoosh', 'tick', 'sizzle', 'clank', 'drip', 'pebble', 'sparkle', 'stepWood', 'stepGrass', 'knock',
  'crowd',
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
  private track: Track | null = null;
  private region: number | null = null;
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
        // A tune played here needs nothing: its clock stops with the context's.
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
      const response = await fetch(`${this.base}${name}.mp3`);
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
    const buffer = this.buffers.get(name) ?? this.buffers.get(LEVEL_SOUNDS[name as LevelSound]);
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

  /** Coins: one clink for a few, a little cascade for a pile. */
  coins(amount: number, at?: Place): void {
    const clinks = Math.min(6, 1 + Math.floor(Math.log2(Math.max(1, amount))));
    for (let i = 0; i < clinks; i++) this.later(i * 55 + Math.random() * 25, 'coin', 0.92 + i * 0.05, 0.5 - i * 0.05, at);
  }

  playMusic(track: Track | null): void {
    if (track === this.track) return;
    this.track = track;
    const old = this.music;
    this.music = null;
    if (old) this.fadeOut(old);
    this.startMusic();
  }

  /**
   * Fades a track out over a second and a half (while the next comes in), then lets it go:
   * the element paused, or the player's notes stopped and its nodes disconnected.
   */
  private fadeOut(old: Music): void {
    const ctx = this.context;
    const stop = (): void => {
      old.element?.pause();
      old.player?.dispose();
      old.gain?.disconnect();
    };
    if (ctx && old.gain) {
      // Its own fade-in may not have begun yet: that is dropped, and the fade-out starts from where it is.
      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      window.setTimeout(stop, 1800);
    } else {
      stop();
    }
  }

  /** A gain into the music's filter that brings a new track in rather than starting it at full. */
  private fadeIn(ctx: AudioContext, filter: AudioNode): GainNode {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(filter);
    gain.gain.setTargetAtTime(1, ctx.currentTime + 0.05, 0.6);
    return gain;
  }

  private startMusic(): void {
    if (!this.unlocked || !this.enabled || !this.track || document.hidden) return;
    const ctx = this.context;
    if (!this.music) {
      const track = this.track;
      if (isSong(track)) {
        // A tune played here needs the audio graph; without one there is no such music.
        if (!ctx || !this.musicFilter) return;
        const gain = this.fadeIn(ctx, this.musicFilter);
        this.music = { track, element: null, player: new MusicPlayer(ctx, track, gain), gain };
      } else {
        const element = new window.Audio(`${this.base}${track}.mp3`);
        element.loop = true;
        element.preload = 'auto';
        let gain: GainNode | null = null;
        if (ctx && this.musicFilter) {
          try {
            const source = ctx.createMediaElementSource(element);
            gain = this.fadeIn(ctx, this.musicFilter);
            source.connect(gain);
          } catch {
            gain = null;
          }
        }
        this.music = { track, element, player: null, gain };
      }
      this.levels();
    }
    if (this.music.element) void this.music.element.play().catch(() => undefined);
    this.music.player?.play();
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
  ambience(region: number | null): void {
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
    const air = this.region === null ? undefined : AIRS[this.region];
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
    if (enabled) this.startMusic();
    else {
      this.music?.element?.pause();
      this.music?.player?.pause();
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
