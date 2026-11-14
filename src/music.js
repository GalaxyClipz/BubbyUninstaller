// Chill lo-fi loop made live with Web Audio. No music files, ~0 CPU, pauses when window hidden.
const Music = (() => {
  let ctx, master, timer, bar = 0, next = 0;
  const BAR = 3.6; // seconds per chord
  const CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]]; // Am7 Fmaj7 Cmaj7 G7
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function reverb() {
    const len = ctx.sampleRate * 2.5, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    const cv = ctx.createConvolver(); cv.buffer = buf; return cv;
  }
  function voice(type, freq, t, dur, vol, out, detune = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.8, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  function pluck(freq, t, out) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(out); o.start(t); o.stop(t + 1);
  }
  function crackle(out) {
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() < 0.0006 ? Math.random() * 0.6 : (Math.random() * 2 - 1) * 0.015;
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const g = ctx.createGain(); g.gain.value = 0.25;
    s.connect(hp).connect(g).connect(out); s.start();
  }
  function schedule() {
    while (next < ctx.currentTime + 1.5) {
      const ch = CHORDS[bar % CHORDS.length], t = next;
      for (const n of ch) { voice('sawtooth', hz(n), t, BAR + 0.6, 0.03, padOut, -7); voice('sawtooth', hz(n), t, BAR + 0.6, 0.03, padOut, 7); }
      voice('sine', hz(ch[0] - 12), t, BAR, 0.16, dry);
      for (let i = 0; i < 8; i++) if (Math.random() < 0.6) pluck(hz(ch[(Math.random() * 4) | 0] + 12), t + i * (BAR / 8) + Math.random() * 0.02, wet);
      bar++; next += BAR;
    }
  }
  let padOut, dry, wet;
  function start() {
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 3);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(master);
    const rv = reverb(), rg = ctx.createGain(); rg.gain.value = 0.5; rv.connect(rg).connect(lp);
    padOut = ctx.createGain(); padOut.connect(lp); padOut.connect(rv);
    dry = lp; wet = ctx.createGain(); wet.connect(lp); wet.connect(rv);
    crackle(master);
    next = ctx.currentTime + 0.1; schedule();
    timer = setInterval(schedule, 500);
  }
  function stop() { clearInterval(timer); if (ctx) ctx.close(); ctx = null; }
  document.addEventListener('visibilitychange', () => { if (ctx) document.hidden ? ctx.suspend() : ctx.resume(); });
  return { start, stop, get on() { return !!ctx; } };
})();
