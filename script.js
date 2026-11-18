(function () {
  'use strict';

  const CHANNEL_COUNT = 10;
  const UNITY = 80; // fader position that equals 0 dB
  const COLORS = ['#d4a94f', '#ef6a4c', '#7fe0bd', '#6ab7e6', '#b9a3e8'];
  const MIX_KEY = 'mixdesk.mix.v1';
  const SCENE_KEY = 'mixdesk.scenes.v1';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const ICON = {
    play: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z"/></svg>',
    pause: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.8 1.5h2.2v9H2.8zM7 1.5h2.2v9H7z"/></svg>',
    stop: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5h7v7h-7z"/></svg>',
    loop: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6a3 3 0 0 1 3-3h3V1.5L11 4 8 6.5V5H5a1 1 0 0 0-1 1zm8 0a3 3 0 0 1-3 3H4v1.5L1 8l3-2.5V7h3a1 1 0 0 0 1-1z"/></svg>'
  };

  /* ---------- Safe storage ---------- */

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }

  /* ---------- Audio graph ---------- */

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const masterGain = audioCtx.createGain();
  const splitter = audioCtx.createChannelSplitter(2);
  const analyserL = audioCtx.createAnalyser();
  const analyserR = audioCtx.createAnalyser();
  const analyserMix = audioCtx.createAnalyser();
  analyserL.fftSize = analyserR.fftSize = 1024;
  analyserMix.fftSize = 1024;
  analyserMix.smoothingTimeConstant = 0.8;
  masterGain.connect(audioCtx.destination);
  masterGain.connect(splitter);
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);
  masterGain.connect(analyserMix);

  function resumeContext() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  // Fader law: 0..80 is -60 dB..0 dB, 80..100 is 0 dB..+6 dB
  function faderToGain(v) {
    if (v < 1) return 0;
    const db = v <= UNITY ? -60 + 60 * (v / UNITY) : ((v - UNITY) / 20) * 6;
    return Math.pow(10, db / 20);
  }
  function gainToDb(g) {
    return g <= 0.0001 ? -Infinity : 20 * Math.log10(g);
  }
  function formatDb(db) {
    if (db === -Infinity) return '-∞ dB';
    return (db > 0.05 ? '+' : '') + db.toFixed(1) + ' dB';
  }
  function dbToPct(db) {
    return clamp(((db + 60) / 66) * 100, 0, 100);
  }
  function formatTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }
  function panLabel(p) {
    const r = Math.round(p);
    return r === 0 ? 'C' : (r < 0 ? 'L' : 'R') + Math.abs(r);
  }

  /* ---------- Controls ---------- */

  function createFader(track, thumb, fill, initial, onChange) {
    let value = initial;

    function render() {
      thumb.style.top = (100 - value) + '%';
      fill.style.height = value + '%';
      thumb.setAttribute('aria-valuenow', String(Math.round(value)));
    }
    function set(v) {
      value = clamp(v, 0, 100);
      render();
      onChange(value);
    }
    function fromClientY(y) {
      const r = track.getBoundingClientRect();
      return clamp(((r.bottom - y) / r.height) * 100, 0, 100);
    }

    let dragging = false;
    thumb.addEventListener('pointerdown', (e) => {
      dragging = true;
      thumb.setPointerCapture(e.pointerId);
      e.preventDefault();
      thumb.focus({ preventScroll: true });
    });
    thumb.addEventListener('pointermove', (e) => { if (dragging) set(fromClientY(e.clientY)); });
    const end = (e) => {
      dragging = false;
      if (thumb.hasPointerCapture && thumb.hasPointerCapture(e.pointerId)) thumb.releasePointerCapture(e.pointerId);
    };
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
    track.addEventListener('pointerdown', (e) => { if (e.target !== thumb) set(fromClientY(e.clientY)); });
    track.addEventListener('dblclick', () => set(UNITY));

    thumb.tabIndex = 0;
    thumb.setAttribute('role', 'slider');
    thumb.setAttribute('aria-orientation', 'vertical');
    thumb.setAttribute('aria-valuemin', '0');
    thumb.setAttribute('aria-valuemax', '100');
    thumb.addEventListener('keydown', (e) => {
      const steps = { ArrowUp: 2, ArrowRight: 2, ArrowDown: -2, ArrowLeft: -2, PageUp: 10, PageDown: -10 };
      if (e.key in steps) { set(value + steps[e.key]); e.preventDefault(); }
      else if (e.key === 'Home') { set(0); e.preventDefault(); }
      else if (e.key === 'End') { set(100); e.preventDefault(); }
    });

    render();
    onChange(value);
    return { get value() { return value; }, set };
  }

  function createKnob(el, initial, onChange) {
    let value = initial;
    let startY = 0;
    let startValue = 0;
    let dragging = false;

    function set(v, snap) {
      v = clamp(v, -100, 100);
      if (snap && Math.abs(v) < 5) v = 0;
      value = v;
      el.style.setProperty('--rot', (v * 1.35) + 'deg');
      el.setAttribute('aria-valuenow', String(Math.round(v)));
      el.setAttribute('aria-valuetext', panLabel(v));
      onChange(v);
    }

    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      startValue = value;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
      el.focus({ preventScroll: true });
    });
    el.addEventListener('pointermove', (e) => {
      if (dragging) set(startValue + (startY - e.clientY) * (e.shiftKey ? 0.5 : 1.6), true);
    });
    const end = (e) => {
      dragging = false;
      if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => set(0));

    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-valuemin', '-100');
    el.setAttribute('aria-valuemax', '100');
    el.addEventListener('keydown', (e) => {
      const steps = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 };
      if (e.key in steps) { set(value + steps[e.key]); e.preventDefault(); }
      else if (e.key === 'Home') { set(0); e.preventDefault(); }
    });

    set(initial);
    return { get value() { return value; }, set };
  }

  function createMeter(el) {
    const mask = $('.m-mask', el);
    const peakEl = $('.m-peak', el);
    let level = 0;
    let peak = 0;
    let peakAt = 0;
    return {
      update(lin, now, dt) {
        const db = lin > 0 ? 20 * Math.log10(lin) : -90;
        const pct = dbToPct(db);
        level = pct > level ? pct : Math.max(pct, level - 110 * dt);
        if (pct >= peak) { peak = pct; peakAt = now; }
        else if (now - peakAt > 1200) peak = Math.max(0, peak - 50 * dt);
        mask.style.height = (100 - level) + '%';
        peakEl.style.bottom = peak + '%';
        peakEl.style.opacity = peak > 1 ? '1' : '0';
      }
    };
  }

  const TICKS = [[100, '+6'], [UNITY, '0'], [66.7, '-10'], [53.3, '-20'], [26.7, '-40'], [0, '-∞']];
  const ticksHtml = TICKS.map(([v, t]) => '<span class="tick" style="bottom:' + v + '%"><b>' + t + '</b></span>').join('');

  function faderMarkup(prefix, meters) {
    const meterHtml = '<div class="meter"><i class="m-mask"></i><i class="m-peak"></i></div>';
    return '<div class="fader-area">' +
      '<div class="fader-row">' +
        '<div class="fader-track" data-role="track">' + ticksHtml +
          '<div class="fader-fill" data-role="fill"></div>' +
          '<div class="fader-thumb" data-role="thumb" aria-label="' + prefix + ' level"></div>' +
        '</div>' +
        '<div class="meters">' + meterHtml.repeat(meters) + '</div>' +
      '</div>' +
      '<div class="db-readout" data-role="db">0.0 dB</div>' +
    '</div>';
  }

  /* ---------- Channels ---------- */

  const stripsEl = $('#strips');
  const channels = [];
  let anySolo = false;
  let selected = -1;
  let loopOn = false;
  let saveTimer = 0;

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeJSON(MIX_KEY, collectMix()), 250);
  }

  function refreshGains() {
    channels.forEach((c) => c.applyGain());
  }

  function buildChannel(index) {
    const strip = document.createElement('section');
    strip.className = 'strip';
    strip.setAttribute('aria-label', 'Channel ' + index);
    strip.innerHTML =
      '<button type="button" class="cap" data-role="cap" title="Change colour" aria-label="Change channel ' + index + ' colour"></button>' +
      '<input class="ch-name" data-role="name" value="Channel ' + index + '" maxlength="12" spellcheck="false" aria-label="Channel ' + index + ' name">' +
      '<div class="track-label" data-role="label">channel-' + index + '.mp3</div>' +
      '<div class="row row-transport">' +
        '<button type="button" class="btn play" data-role="play" disabled aria-label="Play channel ' + index + '">' + ICON.play + '</button>' +
        '<button type="button" class="btn" data-role="stop" disabled aria-label="Stop channel ' + index + '">' + ICON.stop + '</button>' +
      '</div>' +
      '<div class="row row-pan">' +
        '<div class="knob" data-role="knob" title="Pan. Drag up or down, double-click to centre" aria-label="Channel ' + index + ' pan"><i></i></div>' +
        '<div class="pan-readout" data-role="pan">C</div>' +
      '</div>' +
      '<div class="row row-btns">' +
        '<button type="button" class="btn solo" data-role="solo" aria-pressed="false" aria-label="Solo channel ' + index + '">Solo</button>' +
        '<button type="button" class="btn mute" data-role="mute" aria-pressed="false" aria-label="Mute channel ' + index + '">Mute</button>' +
      '</div>' +
      faderMarkup('Channel ' + index, 1);
    stripsEl.appendChild(strip);

    const q = (r) => strip.querySelector('[data-role="' + r + '"]');
    const audio = new Audio('audio/channel-' + index + '.mp3');
    audio.preload = 'auto';

    const source = audioCtx.createMediaElementSource(audio);
    const gain = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(gain);
    gain.connect(panner);
    panner.connect(analyser);
    analyser.connect(masterGain);

    const ch = {
      index, strip, audio, analyser,
      buf: new Float32Array(analyser.fftSize),
      meter: createMeter(strip.querySelector('.meter')),
      colorIndex: Math.floor((index - 1) / 2) % COLORS.length,
      level: UNITY, muted: false, solo: false,
      ready: false, playing: false, loopPending: false, lastP: -1
    };

    const label = q('label');
    const playBtn = q('play');
    const stopBtn = q('stop');
    const muteBtn = q('mute');
    const soloBtn = q('solo');
    const nameInput = q('name');

    ch.applyGain = function () {
      const audible = !ch.muted && (!anySolo || ch.solo);
      gain.gain.setTargetAtTime(audible ? faderToGain(ch.level) : 0, audioCtx.currentTime, 0.015);
      strip.classList.toggle('dimmed', anySolo && !ch.solo);
    };

    ch.setPlaying = function (on) {
      ch.playing = on;
      playBtn.classList.toggle('active', on);
      playBtn.innerHTML = on ? ICON.pause : ICON.play;
      playBtn.setAttribute('aria-label', (on ? 'Pause channel ' : 'Play channel ') + index);
      if (on) ch.loopPending = false;
      updateTransportUi();
    };
    ch.play = function () {
      if (!ch.ready) return;
      resumeContext();
      audio.play().catch(() => {});
    };
    ch.stop = function () {
      if (!ch.ready) return;
      ch.loopPending = false;
      audio.pause();
      audio.currentTime = 0;
    };

    ch.setColor = function (ci) {
      ch.colorIndex = ((ci % COLORS.length) + COLORS.length) % COLORS.length;
      strip.style.setProperty('--cap', COLORS[ch.colorIndex]);
    };
    ch.setMuted = function (m) {
      ch.muted = !!m;
      muteBtn.classList.toggle('active', ch.muted);
      muteBtn.setAttribute('aria-pressed', String(ch.muted));
      ch.applyGain();
    };
    ch.setSolo = function (s) {
      ch.solo = !!s;
      soloBtn.classList.toggle('active', ch.solo);
      soloBtn.setAttribute('aria-pressed', String(ch.solo));
      anySolo = channels.some((c) => c.solo);
      refreshGains();
    };
    ch.setName = function (n) {
      nameInput.value = n;
    };

    audio.addEventListener('canplay', () => {
      ch.ready = true;
      label.classList.add('loaded');
      playBtn.disabled = false;
      stopBtn.disabled = false;
    }, { once: true });
    audio.addEventListener('error', () => {
      ch.ready = false;
      label.classList.add('missing');
      label.textContent = 'No audio file';
      playBtn.disabled = true;
      stopBtn.disabled = true;
    });
    audio.addEventListener('play', () => ch.setPlaying(true));
    audio.addEventListener('pause', () => { if (!audio.ended) ch.setPlaying(false); });
    audio.addEventListener('ended', () => {
      ch.setPlaying(false);
      ch.loopPending = true;
      checkLoop();
    });

    playBtn.addEventListener('click', () => {
      if (!ch.ready) return;
      if (ch.playing) audio.pause(); else ch.play();
    });
    stopBtn.addEventListener('click', () => ch.stop());
    muteBtn.addEventListener('click', () => { ch.setMuted(!ch.muted); queueSave(); });
    soloBtn.addEventListener('click', () => { ch.setSolo(!ch.solo); queueSave(); });
    q('cap').addEventListener('click', () => { ch.setColor(ch.colorIndex + 1); queueSave(); });

    nameInput.addEventListener('focus', () => nameInput.select());
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') nameInput.blur();
      e.stopPropagation();
    });
    nameInput.addEventListener('change', () => {
      if (!nameInput.value.trim()) nameInput.value = 'Channel ' + index;
      queueSave();
    });

    strip.addEventListener('pointerdown', () => select(index - 1));

    const dbEl = q('db');
    ch.fader = createFader(q('track'), q('thumb'), q('fill'), UNITY, (v) => {
      ch.level = v;
      const db = gainToDb(faderToGain(v));
      dbEl.textContent = formatDb(db);
      q('thumb').setAttribute('aria-valuetext', formatDb(db));
      ch.applyGain();
      queueSave();
    });

    const panEl = q('pan');
    ch.knob = createKnob(q('knob'), 0, (p) => {
      panner.pan.setTargetAtTime(p / 100, audioCtx.currentTime, 0.015);
      panEl.textContent = panLabel(p);
      queueSave();
    });

    ch.setColor(ch.colorIndex);
    ch.updateProgress = function () {
      const d = audio.duration;
      const p = d && isFinite(d) ? (audio.currentTime / d) * 100 : 0;
      const rounded = Math.round(p * 10) / 10;
      if (rounded !== ch.lastP) {
        ch.lastP = rounded;
        label.style.setProperty('--p', rounded + '%');
      }
    };

    channels.push(ch);
    return ch;
  }

  for (let i = 1; i <= CHANNEL_COUNT; i++) buildChannel(i);

  /* ---------- Master ---------- */

  const master = { level: UNITY, muted: false, clipped: false };
  const masterStrip = document.createElement('section');
  masterStrip.className = 'strip master';
  masterStrip.setAttribute('aria-label', 'Master');
  masterStrip.innerHTML =
    '<div class="cap" aria-hidden="true"></div>' +
    '<input class="ch-name" value="Master" tabindex="-1" aria-label="Master" readonly>' +
    '<div class="track-label loaded">Stereo out</div>' +
    '<div class="row row-transport"><button type="button" class="btn clip" data-role="clip" title="Clip light. Click to clear">Clip</button></div>' +
    '<div class="row row-pan"></div>' +
    '<div class="row row-btns"><button type="button" class="btn mute" data-role="mute" aria-pressed="false">Mute</button></div>' +
    faderMarkup('Master', 2);
  $('#master-slot').appendChild(masterStrip);

  const mq = (r) => masterStrip.querySelector('[data-role="' + r + '"]');
  const masterMuteBtn = mq('mute');
  const clipBtn = mq('clip');
  const masterMeters = Array.from(masterStrip.querySelectorAll('.meter')).map(createMeter);
  const masterBufL = new Float32Array(analyserL.fftSize);
  const masterBufR = new Float32Array(analyserR.fftSize);

  function applyMaster() {
    masterGain.gain.setTargetAtTime(master.muted ? 0 : faderToGain(master.level), audioCtx.currentTime, 0.015);
  }
  function setMasterMuted(m) {
    master.muted = !!m;
    masterMuteBtn.classList.toggle('active', master.muted);
    masterMuteBtn.setAttribute('aria-pressed', String(master.muted));
    applyMaster();
  }
  function setClip(on) {
    master.clipped = on;
    clipBtn.classList.toggle('active', on);
  }
  clipBtn.addEventListener('click', () => setClip(false));
  masterMuteBtn.addEventListener('click', () => { setMasterMuted(!master.muted); queueSave(); });

  const masterFader = createFader(mq('track'), mq('thumb'), mq('fill'), UNITY, (v) => {
    master.level = v;
    const db = gainToDb(faderToGain(v));
    mq('db').textContent = formatDb(db);
    mq('thumb').setAttribute('aria-valuetext', formatDb(db));
    applyMaster();
    queueSave();
  });

  /* ---------- Selection ---------- */

  function select(i) {
    selected = i;
    channels.forEach((c, n) => c.strip.classList.toggle('selected', n === i));
  }

  /* ---------- Transport ---------- */

  const playAllBtn = $('#play-all');
  const playAllLabel = $('#play-all-label');
  const timeEl = $('#time');
  const seekEl = $('#seek');
  const loopBtn = $('#loop');
  let seeking = false;

  $('#play-all-ico').innerHTML = ICON.play;
  $('#stop-all-ico').innerHTML = ICON.stop;
  $('#loop-ico').innerHTML = ICON.loop;

  const readyChannels = () => channels.filter((c) => c.ready);
  const anyPlaying = () => channels.some((c) => c.playing);

  function updateTransportUi() {
    const playing = anyPlaying();
    playAllLabel.textContent = playing ? 'Pause all' : 'Play all';
    $('#play-all-ico').innerHTML = playing ? ICON.pause : ICON.play;
  }

  function playAll() {
    resumeContext();
    const list = readyChannels();
    const longest = Math.max(0, ...list.map((c) => c.audio.duration || 0));
    const atEnd = list.length && list.every((c) => c.audio.ended || c.audio.currentTime >= (c.audio.duration || Infinity) - 0.05);
    list.forEach((c) => {
      if (atEnd) c.audio.currentTime = 0;
      if (!c.playing) c.play();
    });
    return longest;
  }
  function pauseAll() {
    channels.forEach((c) => { if (c.playing) c.audio.pause(); });
  }
  function stopAll() {
    channels.forEach((c) => c.stop());
  }
  function togglePlayAll() {
    if (anyPlaying()) pauseAll(); else playAll();
  }

  function checkLoop() {
    if (!loopOn || anyPlaying()) return;
    const pending = channels.filter((c) => c.loopPending && c.ready);
    if (!pending.length) return;
    pending.forEach((c) => {
      c.loopPending = false;
      c.audio.currentTime = 0;
      c.play();
    });
  }

  function setLoop(on) {
    loopOn = !!on;
    loopBtn.setAttribute('aria-pressed', String(loopOn));
    if (!loopOn) channels.forEach((c) => { c.loopPending = false; });
  }

  playAllBtn.addEventListener('click', togglePlayAll);
  $('#stop-all').addEventListener('click', stopAll);
  loopBtn.addEventListener('click', () => { setLoop(!loopOn); queueSave(); toast(loopOn ? 'Loop on' : 'Loop off'); });

  function seekTo(fraction) {
    const longest = Math.max(0, ...readyChannels().map((c) => c.audio.duration || 0));
    const t = fraction * longest;
    readyChannels().forEach((c) => {
      const d = c.audio.duration || t;
      c.audio.currentTime = Math.min(t, Math.max(0, d - 0.01));
    });
  }
  seekEl.addEventListener('pointerdown', () => { seeking = true; });
  seekEl.addEventListener('input', () => {
    seeking = true;
    seekEl.style.setProperty('--p', (seekEl.value / 10) + '%');
    seekTo(seekEl.value / 1000);
  });
  seekEl.addEventListener('change', () => { seeking = false; });
  window.addEventListener('pointerup', () => { seeking = false; });

  /* ---------- Mix state, scenes, sharing ---------- */

  function collectMix() {
    return {
      v: 1,
      l: loopOn ? 1 : 0,
      m: { f: Math.round(master.level * 10) / 10, x: master.muted ? 1 : 0 },
      c: channels.map((c) => ({
        n: $('[data-role="name"]', c.strip).value,
        f: Math.round(c.level * 10) / 10,
        p: Math.round(c.knob.value),
        x: c.muted ? 1 : 0,
        s: c.solo ? 1 : 0,
        k: c.colorIndex
      }))
    };
  }

  function applyMix(data) {
    if (!data || data.v !== 1 || !Array.isArray(data.c)) return false;
    setLoop(data.l);
    if (data.m) { masterFader.set(Number(data.m.f) || 0); setMasterMuted(data.m.x); }
    channels.forEach((c, i) => {
      const d = data.c[i];
      if (!d) return;
      c.setName(String(d.n || 'Channel ' + c.index).slice(0, 12));
      c.fader.set(Number(d.f));
      c.knob.set(Number(d.p) || 0);
      c.setMuted(d.x);
      c.setColor(Number(d.k) || 0);
    });
    // Solo is applied after every channel is set so the solo state is consistent
    channels.forEach((c, i) => { c.solo = !!(data.c[i] && data.c[i].s); });
    channels.forEach((c) => c.setSolo(c.solo));
    queueSave();
    return true;
  }

  function defaultMix() {
    return {
      v: 1, l: 0, m: { f: UNITY, x: 0 },
      c: channels.map((c) => ({ n: 'Channel ' + c.index, f: UNITY, p: 0, x: 0, s: 0, k: Math.floor((c.index - 1) / 2) % COLORS.length }))
    };
  }

  // Scenes
  let scenes = readJSON(SCENE_KEY);
  if (!Array.isArray(scenes) || scenes.length !== 3) scenes = [null, null, null];
  const sceneBtns = Array.from(document.querySelectorAll('.scene'));
  const storeBtn = $('#store');
  let storing = false;
  const SCENE_NAMES = ['A', 'B', 'C'];

  function renderScenes() {
    sceneBtns.forEach((b, i) => b.classList.toggle('filled', !!scenes[i]));
    storeBtn.setAttribute('aria-pressed', String(storing));
    document.body.classList.toggle('storing', storing);
  }
  storeBtn.addEventListener('click', () => {
    storing = !storing;
    renderScenes();
    if (storing) toast('Choose a scene to store this mix in');
  });
  sceneBtns.forEach((b, i) => {
    b.addEventListener('click', () => {
      if (storing) {
        scenes[i] = collectMix();
        writeJSON(SCENE_KEY, scenes);
        storing = false;
        renderScenes();
        toast('Mix stored in scene ' + SCENE_NAMES[i]);
      } else if (scenes[i]) {
        applyMix(scenes[i]);
        toast('Scene ' + SCENE_NAMES[i] + ' recalled');
      } else {
        toast('Scene ' + SCENE_NAMES[i] + ' is empty. Press Store, then ' + SCENE_NAMES[i]);
      }
    });
  });
  renderScenes();

  // Reset with undo
  $('#reset').addEventListener('click', () => {
    const before = collectMix();
    applyMix(defaultMix());
    toast('Mix reset', 'Undo', () => { applyMix(before); toast('Mix restored'); });
  });

  // Share link
  function encodeMix(data) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  }
  function decodeMix(str) {
    try { return JSON.parse(decodeURIComponent(escape(atob(str)))); } catch (e) { return null; }
  }
  $('#share').addEventListener('click', () => {
    const url = location.origin + location.pathname + '#mix=' + encodeURIComponent(encodeMix(collectMix()));
    const done = () => toast('Mix link copied');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link', url));
    } else {
      window.prompt('Copy this link', url);
    }
  });

  /* ---------- Toast ---------- */

  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(message, actionLabel, action) {
    toastEl.textContent = '';
    const span = document.createElement('span');
    span.textContent = message;
    toastEl.appendChild(span);
    if (actionLabel) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = actionLabel;
      b.addEventListener('click', () => { toastEl.classList.remove('show'); action(); });
      toastEl.appendChild(b);
    }
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), actionLabel ? 5000 : 2200);
  }

  /* ---------- Help dialog ---------- */

  const helpDialog = $('#help');
  const openHelp = () => { if (!helpDialog.open) helpDialog.showModal(); };
  $('#help-btn').addEventListener('click', openHelp);

  /* ---------- Keyboard ---------- */

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (helpDialog.open) return;
    const t = e.target;
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = e.key;

    if (key === ' ' || key === 'Spacebar') {
      if (tag === 'BUTTON') return;
      e.preventDefault();
      togglePlayAll();
      return;
    }
    if (key === 'Home' && t.getAttribute('role') !== 'slider') { e.preventDefault(); stopAll(); return; }
    if (key === '?') { e.preventDefault(); openHelp(); return; }
    if (key === 'l' || key === 'L') { setLoop(!loopOn); queueSave(); toast(loopOn ? 'Loop on' : 'Loop off'); return; }

    if (/^[0-9]$/.test(key)) { select(key === '0' ? 9 : Number(key) - 1); return; }

    if (t.getAttribute('role') === 'slider') return; // sliders handle their own arrows

    if (key === 'ArrowRight') { e.preventDefault(); select(Math.min(CHANNEL_COUNT - 1, selected + 1)); return; }
    if (key === 'ArrowLeft') { e.preventDefault(); select(Math.max(0, selected < 0 ? 0 : selected - 1)); return; }

    if (key === 'S') { channels.forEach((c) => c.setSolo(false)); queueSave(); toast('Solos cleared'); return; }

    const ch = channels[selected];
    if (!ch) return;
    if (key === 'ArrowUp') { e.preventDefault(); ch.fader.set(ch.fader.value + (e.shiftKey ? 10 : 2)); return; }
    if (key === 'ArrowDown') { e.preventDefault(); ch.fader.set(ch.fader.value - (e.shiftKey ? 10 : 2)); return; }
    if (key === 'm' || key === 'M') { ch.setMuted(!ch.muted); queueSave(); return; }
    if (key === 's') { ch.setSolo(!ch.solo); queueSave(); }
  });

  /* ---------- Waterline visualiser ---------- */

  const canvas = $('#wave');
  const g = canvas.getContext('2d');
  const freq = new Uint8Array(analyserMix.frequencyBinCount);
  let W = 0;
  let H = 0;
  let waveFlat = false;

  function resizeCanvas() {
    const r = canvas.getBoundingClientRect();
    const d = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.max(1, Math.round(W * d));
    canvas.height = Math.max(1, Math.round(H * d));
    g.setTransform(d, 0, 0, d, 0, 0);
    waveFlat = false;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function drawWave(active) {
    if (!active && waveFlat) return;
    g.clearRect(0, 0, W, H);
    const points = 64;
    const ys = [];
    if (active) analyserMix.getByteFrequencyData(freq);
    const usable = freq.length * 0.55;
    let any = 0;
    for (let i = 0; i < points; i++) {
      let v = 0;
      if (active) {
        const a = Math.floor(Math.pow(i / points, 1.7) * usable);
        const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / points, 1.7) * usable));
        let sum = 0;
        for (let k = a; k < b; k++) sum += freq[k];
        v = sum / (b - a) / 255;
      }
      any += v;
      ys.push(H - 3 - Math.pow(v, 1.3) * (H - 14) * 0.5);
    }
    const step = W / (points - 1);
    g.beginPath();
    g.moveTo(0, ys[0]);
    for (let i = 1; i < points; i++) {
      const x0 = (i - 1) * step;
      const x1 = i * step;
      g.quadraticCurveTo(x0, ys[i - 1], (x0 + x1) / 2, (ys[i - 1] + ys[i]) / 2);
    }
    g.lineTo(W, ys[points - 1]);
    g.strokeStyle = 'rgba(127, 224, 189, 0.85)';
    g.lineWidth = 1.6;
    g.stroke();
    g.lineTo(W, H);
    g.lineTo(0, H);
    g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(127, 224, 189, 0.34)');
    grad.addColorStop(1, 'rgba(127, 224, 189, 0)');
    g.fillStyle = grad;
    g.fill();
    waveFlat = any === 0;
  }

  /* ---------- Frame loop ---------- */

  const tmpMeterBuf = (analyser, buf) => {
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > peak) peak = a;
    }
    return peak;
  };

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;

    channels.forEach((c) => {
      c.meter.update(c.playing ? tmpMeterBuf(c.analyser, c.buf) : 0, now, dt);
      c.updateProgress();
    });

    const playing = anyPlaying();
    const pl = playing || audioCtx.state === 'running' ? tmpMeterBuf(analyserL, masterBufL) : 0;
    const pr = playing || audioCtx.state === 'running' ? tmpMeterBuf(analyserR, masterBufR) : 0;
    masterMeters[0].update(pl, now, dt);
    masterMeters[1].update(pr, now, dt);
    if (pl >= 0.999 || pr >= 0.999) setClip(true);

    drawWave(playing);

    let longest = 0;
    let pos = 0;
    channels.forEach((c) => {
      if (!c.ready) return;
      const d = c.audio.duration;
      if (d && isFinite(d) && d > longest) longest = d;
      if (c.audio.currentTime > pos) pos = c.audio.currentTime;
    });
    timeEl.textContent = formatTime(pos) + ' / ' + formatTime(longest);
    if (!seeking && longest > 0) {
      const v = Math.round((pos / longest) * 1000);
      if (Number(seekEl.value) !== v) {
        seekEl.value = String(v);
        seekEl.style.setProperty('--p', (v / 10) + '%');
      }
    }

    requestAnimationFrame(frame);
  }

  /* ---------- Start up ---------- */

  (function restore() {
    let data = null;
    let fromLink = false;
    const m = /[#&]mix=([^&]+)/.exec(location.hash);
    if (m) {
      data = decodeMix(decodeURIComponent(m[1]));
      fromLink = !!data;
    }
    if (!data) data = readJSON(MIX_KEY);
    if (data && applyMix(data) && fromLink) toast('Loaded the shared mix');
  })();

  requestAnimationFrame(frame);
})();
