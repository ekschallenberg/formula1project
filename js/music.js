// "Lights Out": an original race-day theme, synthesised live with the Web Audio API (no audio
// files). A small player in the corner of every page plays and pauses it and sets the volume.
// It never starts on its own; if a visitor had it playing, it resumes on their first click or
// key press on the next page (browsers only allow sound after a user gesture).

const BPM = 124;
const STEP = 60 / BPM / 4; // one 16th note, in seconds
const STORE = "f1-music";

// Chords as [bass root, triad] in MIDI note numbers. D minor: Dm Bb F C, and Gm Bb Dm A.
const DRIVE = [[38, [62, 65, 69]], [34, [58, 62, 65]], [41, [60, 65, 69]], [36, [60, 64, 67]]];
const BREAK = [[43, [62, 67, 70]], [34, [58, 62, 65]], [38, [62, 65, 69]], [33, [61, 64, 69]]];

// Lead melody, one entry per bar: [step, note, length in 16ths].
const MELODY = [
  [[0, 74, 6], [6, 77, 2], [8, 76, 4], [12, 74, 4]],
  [[0, 70, 6], [6, 74, 2], [8, 77, 8]],
  [[0, 72, 6], [6, 76, 2], [8, 77, 4], [12, 79, 4]],
  [[0, 81, 8], [8, 79, 4], [12, 76, 4]],
  [[0, 74, 6], [6, 77, 2], [8, 81, 4], [12, 79, 4]],
  [[0, 77, 6], [6, 74, 2], [8, 70, 8]],
  [[0, 72, 6], [6, 76, 2], [8, 79, 4], [12, 77, 4]],
  [[0, 76, 4], [4, 74, 12]],
];
const BASS_OCTAVES = [0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 0, 12, 12, 0];
const ARP = [0, 1, 2, 3, 2, 1, 3, 2]; // index 3 = root an octave up

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Song form in bars: an 8-bar intro (drums + bass), then a 24-bar loop of
// build (adds arpeggio), chorus (adds melody) and breakdown (pads, engine-rev riser).
function section(bar) {
  if (bar < 8) return "intro";
  const b = (bar - 8) % 24;
  return b < 8 ? "build" : b < 16 ? "chorus" : "break";
}

export class Song {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.step = 0;
    this.next = 0;
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;

    this.out = ctx.createGain();
    this.out.gain.value = 0.65; // keeps the peak under full scale at maximum volume
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.out.connect(comp).connect(destination);

    // echo for the lead and arpeggio: a dotted-8th feedback delay
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    this.echo.connect(fb).connect(this.echo);
    this.echo.connect(wet).connect(this.out);
  }

  // Schedule every 16th note that starts before `until` (seconds on the context clock).
  scheduleUntil(until) {
    while (this.next < until) {
      this.playStep(this.step, this.next);
      this.step++;
      this.next += STEP;
    }
  }

  playStep(step, t) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const part = section(bar);
    const inLoop = bar < 8 ? bar : (bar - 8) % 24;
    const chords = part === "break" ? BREAK : DRIVE;
    const [root, triad] = chords[bar % 4];

    // drums
    if (part === "break") {
      if (s === 0 || (s === 8 && inLoop >= 20)) this.kick(t);
      if (inLoop >= 22 && s % 2 === 0) this.snare(t, 0.12 + 0.25 * ((inLoop - 22) * 16 + s) / 32); // roll
    } else {
      if (s % 4 === 0) this.kick(t);
      if (s === 4 || s === 12) this.snare(t, 0.35);
      if (s % 2 === 0 || part === "chorus") this.hat(t, s % 4 === 2 ? 0.14 : 0.07);
    }
    if (s === 0 && (bar === 8 || (bar > 8 && inLoop === 0) || (bar > 8 && inLoop === 8))) this.crash(t);

    // bass: pulsing 16ths with octave jumps, held notes in the breakdown
    if (part !== "break") this.bass(t, root + BASS_OCTAVES[s], STEP * 0.8);
    else if (s === 0) this.bass(t, root, STEP * 14, 0.16);

    // arpeggio
    if (part === "build" || part === "chorus" || (part === "break" && inLoop < 20)) {
      const n = ARP[s % 8] === 3 ? triad[0] + 12 : triad[ARP[s % 8]];
      const level = part === "break" ? 0.035 : part === "build" ? 0.03 + 0.005 * (inLoop % 8) : 0.06;
      this.arp(t, n + 12, level, part === "build" ? 900 + 300 * (inLoop % 8) : 3200);
    }

    // pads: long chords under the chorus and breakdown
    if (s === 0 && (part === "chorus" || part === "break")) this.pad(t, triad, STEP * 16, part === "break" ? 0.07 : 0.035);

    // melody
    if (part === "chorus") {
      for (const [at, note, len] of MELODY[inLoop - 8]) if (at === s) this.lead(t, note, STEP * len);
    }

    // engine-rev riser across the last two bars of the breakdown: three gear changes
    if (part === "break" && inLoop === 22 && s === 0) this.engine(t, STEP * 32);
  }

  env(t, peak, attack, hold, release) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }

  osc(type, freq, t, stop) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.start(t);
    o.stop(stop);
    return o;
  }

  noiseSource(t, stop) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.start(t);
    n.stop(stop);
    return n;
  }

  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  kick(t) {
    const o = this.osc("sine", 150, t, t + 0.4);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    o.connect(this.env(t, 0.9, 0.002, 0.02, 0.3)).connect(this.out);
  }

  snare(t, level) {
    this.noiseSource(t, t + 0.25).connect(this.filter("bandpass", 1800, 0.8))
      .connect(this.env(t, level, 0.001, 0.01, 0.18)).connect(this.out);
    this.osc("triangle", 190, t, t + 0.12).connect(this.env(t, level * 0.6, 0.001, 0.01, 0.08)).connect(this.out);
  }

  hat(t, level) {
    this.noiseSource(t, t + 0.08).connect(this.filter("highpass", 7500))
      .connect(this.env(t, level, 0.001, 0.005, 0.04)).connect(this.out);
  }

  crash(t) {
    this.noiseSource(t, t + 1).connect(this.filter("highpass", 4000))
      .connect(this.env(t, 0.12, 0.002, 0.05, 0.9)).connect(this.out);
  }

  bass(t, midi, len, level = 0.2) {
    const f = this.filter("lowpass", 700, 4);
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(300, t + Math.min(len, 0.25));
    this.osc("sawtooth", hz(midi), t, t + len + 0.05).connect(f)
      .connect(this.env(t, level, 0.004, len * 0.6, len * 0.4)).connect(this.out);
  }

  arp(t, midi, level, cutoff) {
    const f = this.filter("lowpass", cutoff, 3);
    const g = this.env(t, level, 0.003, 0.02, STEP * 0.9);
    this.osc("square", hz(midi), t, t + STEP * 1.2).connect(f).connect(g);
    g.connect(this.out);
    g.connect(this.echo);
  }

  lead(t, midi, len) {
    const g = this.env(t, 0.1, 0.015, len * 0.75, len * 0.35);
    const f = this.filter("lowpass", 2600, 1.2);
    for (const detune of [-7, 7]) {
      const o = this.osc("sawtooth", hz(midi), t, t + len * 1.15);
      o.detune.value = detune;
      o.connect(f);
    }
    f.connect(g);
    g.connect(this.out);
    g.connect(this.echo);
  }

  pad(t, triad, len, level) {
    const g = this.env(t, level, len * 0.25, len * 0.5, len * 0.3);
    const f = this.filter("lowpass", 1100, 0.5);
    for (const n of triad) {
      for (const detune of [-10, 10]) {
        const o = this.osc("sawtooth", hz(n - 12), t, t + len * 1.1);
        o.detune.value = detune;
        o.connect(f);
      }
    }
    f.connect(g).connect(this.out);
  }

  // An engine revving up through three gears, then lifting off as the music drops back in.
  engine(t, len) {
    const f = this.filter("lowpass", 900, 2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + len * 0.3);
    g.gain.setValueAtTime(0.09, t + len * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const saw = this.osc("sawtooth", 90, t, t + len);
    const sq = this.osc("square", 45, t, t + len);
    const gears = [[90, 260], [150, 330], [190, 440]];
    gears.forEach(([from, to], i) => {
      const a = t + (len / 3) * i;
      const b = a + len / 3 - 0.02;
      for (const [o, k] of [[saw, 1], [sq, 0.5]]) {
        o.frequency.setValueAtTime(from * k, a);
        o.frequency.exponentialRampToValueAtTime(to * k, b);
      }
      f.frequency.setValueAtTime(700 + 300 * i, a);
      f.frequency.linearRampToValueAtTime(1400 + 500 * i, b);
    });
    saw.connect(f);
    sq.connect(f);
    f.connect(g).connect(this.out);
  }
}

// ---------- player ----------
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';

function loadPrefs() {
  try {
    return { on: false, volume: 60, ...JSON.parse(localStorage.getItem(STORE) || "{}") };
  } catch {
    return { on: false, volume: 60 };
  }
}
function savePrefs(p) {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* storage blocked: ignore */ }
}

function createPlayer() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const prefs = loadPrefs();

  const el = document.createElement("div");
  el.className = "music";
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Music player");
  el.innerHTML = `
    <button type="button" class="music-play" aria-pressed="false" aria-label="Play music">${ICON_PLAY}</button>
    <div class="music-meta"><div class="music-title">Lights Out</div><div class="music-sub">Original race-day theme</div></div>
    <span class="music-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <input class="music-vol" type="range" min="0" max="100" value="${prefs.volume}" aria-label="Music volume">`;
  document.body.appendChild(el);
  const btn = el.querySelector(".music-play");
  const sub = el.querySelector(".music-sub");
  const vol = el.querySelector(".music-vol");

  let ctx = null;
  let song = null;
  let master = null;
  let timer = null;
  let playing = false;

  const level = () => (vol.value / 100) ** 2; // perceptual volume curve

  function tick() {
    const ahead = document.hidden ? 1.5 : 0.2; // background tabs only run timers once a second
    song.scheduleUntil(ctx.currentTime + ahead);
  }

  async function play() {
    if (!ctx) {
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.connect(ctx.destination);
      song = new Song(ctx, master);
    }
    master.gain.setValueAtTime(level(), ctx.currentTime);
    await ctx.resume();
    song.next = Math.max(song.next, ctx.currentTime + 0.05);
    tick();
    clearInterval(timer);
    timer = setInterval(tick, 50);
    setPlaying(true);
  }

  function pause() {
    clearInterval(timer);
    if (ctx) ctx.suspend();
    setPlaying(false);
  }

  function setPlaying(on) {
    playing = on;
    el.classList.toggle("is-playing", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Pause music" : "Play music");
    btn.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    sub.textContent = "Original race-day theme";
    savePrefs({ on, volume: +vol.value });
  }

  btn.addEventListener("click", () => (playing ? pause() : play()));
  vol.addEventListener("input", () => {
    if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05);
    savePrefs({ on: playing, volume: +vol.value });
  });

  // Carry the music across pages: resume on the first click or key press if it was playing.
  if (prefs.on) {
    sub.textContent = "Paused · click anywhere to resume";
    const resume = (e) => {
      window.removeEventListener("pointerup", resume, true);
      window.removeEventListener("keydown", resume, true);
      if (!playing && !el.contains(e.target)) play();
    };
    window.addEventListener("pointerup", resume, true);
    window.addEventListener("keydown", resume, true);
  }
}

if (typeof document !== "undefined") createPlayer();
