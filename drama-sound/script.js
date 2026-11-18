
(function () {
  const CHANNEL_COUNT = 10;
  const stripsEl = document.getElementById('strips');

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const masterGain = audioCtx.createGain();
  masterGain.connect(audioCtx.destination);

  function resumeContext() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }


  function faderToGain(v) {
    v = Number(v);
    if (v <= 80) return (v / 80);
    return 1 + ((v - 80) / 20) * 0.5;
  }

  function gainToDb(g) {
    if (g <= 0.0001) return -Infinity;
    return 20 * Math.log10(g);
  }

  function formatDb(db) {
    if (db === -Infinity) return '-∞ dB';
    const sign = db > 0 ? '+' : '';
    return sign + db.toFixed(1) + ' dB';
  }

  function createFader(trackEl, thumbEl, fillEl, initialValue, onChange) {
    let value = initialValue;

    function render() {
      const ratio = value / 100;
      thumbEl.style.top = ((1 - ratio) * 100) + '%';
      fillEl.style.height = (ratio * 100) + '%';
      thumbEl.setAttribute('aria-valuenow', String(Math.round(value)));
    }

    function setValue(v) {
      value = Math.min(100, Math.max(0, v));
      render();
      onChange(value);
    }

    function valueFromClientY(clientY) {
      const rect = trackEl.getBoundingClientRect();
      const ratio = (rect.bottom - clientY) / rect.height;
      return Math.min(100, Math.max(0, ratio * 100));
    }

    let dragging = false;

    thumbEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      thumbEl.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    thumbEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      setValue(valueFromClientY(e.clientY));
    });

    function endDrag(e) {
      dragging = false;
      if (thumbEl.hasPointerCapture && thumbEl.hasPointerCapture(e.pointerId)) {
        thumbEl.releasePointerCapture(e.pointerId);
      }
    }
    thumbEl.addEventListener('pointerup', endDrag);
    thumbEl.addEventListener('pointercancel', endDrag);

    trackEl.addEventListener('pointerdown', (e) => {
      if (e.target === thumbEl) return;
      setValue(valueFromClientY(e.clientY));
    });

    thumbEl.tabIndex = 0;
    thumbEl.setAttribute('role', 'slider');
    thumbEl.setAttribute('aria-valuemin', '0');
    thumbEl.setAttribute('aria-valuemax', '100');

    thumbEl.addEventListener('keydown', (e) => {
      const steps = { ArrowUp: 2, ArrowRight: 2, ArrowDown: -2, ArrowLeft: -2, PageUp: 10, PageDown: -10 };
      if (e.key in steps) {
        setValue(value + steps[e.key]);
        e.preventDefault();
      } else if (e.key === 'Home') {
        setValue(0);
        e.preventDefault();
      } else if (e.key === 'End') {
        setValue(100);
        e.preventDefault();
      }
    });

    render();
    onChange(value);

    return {
      get value() { return value; },
      set: setValue,
    };
  }

  const channels = [];

  function buildChannelStrip(index) {
    const strip = document.createElement('div');
    strip.className = 'strip';
    strip.innerHTML = `
      <div class="ch-name">CH ${index}</div>
      <div class="track-label" id="track-label-${index}">channel-${index}.mp3</div>
      <div class="transport">
        <button class="btn play" id="play-${index}" disabled>&#9654;</button>
        <button class="btn" id="stop-${index}" disabled>&#9632;</button>
      </div>
      <button class="btn mute" id="mute-${index}">MUTE</button>
      <div class="fader-area">
        <div class="fader-row">
          <div class="fader-track" id="fader-track-${index}">
            <div class="scale">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
            <div class="fader-fill" id="fader-fill-${index}"></div>
            <div class="fader-thumb" id="fader-thumb-${index}"></div>
          </div>
          <div class="meter"><div class="meter-fill" id="meter-${index}"></div></div>
        </div>
        <div class="db-readout" id="db-${index}">0.0 dB</div>
      </div>
    `;
    stripsEl.appendChild(strip);

    const trackLabel = document.getElementById(`track-label-${index}`);
    const playBtn = document.getElementById(`play-${index}`);
    const stopBtn = document.getElementById(`stop-${index}`);
    const muteBtn = document.getElementById(`mute-${index}`);
    const dbReadout = document.getElementById(`db-${index}`);
    const meterFill = document.getElementById(`meter-${index}`);
    const audioEl = new Audio(`audio/channel-${index}.mp3`);
    audioEl.preload = 'auto';

    const source = audioCtx.createMediaElementSource(audioEl);
    const gainNode = audioCtx.createGain();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(masterGain);

    const state = {
      index,
      audioEl,
      gainNode,
      analyser,
      meterData: new Uint8Array(analyser.frequencyBinCount),
      muted: false,
      playing: false,
      ready: false,
    };

    audioEl.addEventListener('canplay', () => {
      state.ready = true;
      trackLabel.classList.add('loaded');
      playBtn.disabled = false;
      stopBtn.disabled = false;
    }, { once: true });

    audioEl.addEventListener('error', () => {
      state.ready = false;
      trackLabel.classList.add('missing');
      trackLabel.textContent = 'no audio';
      playBtn.disabled = true;
      stopBtn.disabled = true;
    });

    audioEl.addEventListener('ended', () => {
      state.playing = false;
      playBtn.classList.remove('active');
      playBtn.innerHTML = '&#9654;';
    });

    function applyGain(v) {
      const db = gainToDb(faderToGain(v));
      dbReadout.textContent = formatDb(db);
      const g = state.muted ? 0 : faderToGain(v);
      gainNode.gain.setTargetAtTime(g, audioCtx.currentTime, 0.01);
    }

    const fader = createFader(
      document.getElementById(`fader-track-${index}`),
      document.getElementById(`fader-thumb-${index}`),
      document.getElementById(`fader-fill-${index}`),
      80,
      applyGain
    );

    playBtn.addEventListener('click', () => {
      if (!state.ready) return;
      resumeContext();
      if (state.playing) {
        audioEl.pause();
        state.playing = false;
        playBtn.classList.remove('active');
        playBtn.innerHTML = '&#9654;';
      } else {
        audioEl.play().catch(() => {});
        state.playing = true;
        playBtn.classList.add('active');
        playBtn.innerHTML = '&#10074;&#10074;';
      }
    });

    stopBtn.addEventListener('click', () => {
      if (!state.ready) return;
      audioEl.pause();
      audioEl.currentTime = 0;
      state.playing = false;
      playBtn.classList.remove('active');
      playBtn.innerHTML = '&#9654;';
    });

    muteBtn.addEventListener('click', () => {
      state.muted = !state.muted;
      muteBtn.classList.toggle('active', state.muted);
      applyGain(fader.value);
    });

    function updateMeter() {
      if (state.playing) {
        analyser.getByteFrequencyData(state.meterData);
        let sum = 0;
        for (let i = 0; i < state.meterData.length; i++) sum += state.meterData[i];
        const avg = sum / state.meterData.length;
        meterFill.style.height = Math.min(100, (avg / 180) * 100) + '%';
      } else {
        meterFill.style.height = '0%';
      }
      requestAnimationFrame(updateMeter);
    }
    updateMeter();

    channels.push(state);
    return state;
  }

  for (let i = 1; i <= CHANNEL_COUNT; i++) {
    buildChannelStrip(i);
  }

  const masterDb = document.getElementById('master-db');
  const masterMuteBtn = document.getElementById('master-mute');
  const masterMeterFill = document.getElementById('master-meter');
  let masterMuted = false;

  function applyMasterGain(v) {
    const g = masterMuted ? 0 : faderToGain(v);
    masterGain.gain.setTargetAtTime(g, audioCtx.currentTime, 0.01);
    masterDb.textContent = formatDb(gainToDb(faderToGain(v)));
  }

  const masterFader = createFader(
    document.getElementById('master-fader-track'),
    document.getElementById('master-fader-thumb'),
    document.getElementById('master-fader-fill'),
    80,
    applyMasterGain
  );

  masterMuteBtn.addEventListener('click', () => {
    masterMuted = !masterMuted;
    masterMuteBtn.classList.toggle('active', masterMuted);
    applyMasterGain(masterFader.value);
  });

  document.getElementById('play-all').addEventListener('click', () => {
    resumeContext();
    channels.forEach(ch => {
      if (ch.ready && !ch.playing) {
        ch.audioEl.play().catch(() => {});
        ch.playing = true;
        const playBtn = document.getElementById(`play-${ch.index}`);
        playBtn.classList.add('active');
        playBtn.innerHTML = '&#10074;&#10074;';
      }
    });
  });

  document.getElementById('stop-all').addEventListener('click', () => {
    channels.forEach(ch => {
      if (ch.ready) {
        ch.audioEl.pause();
        ch.audioEl.currentTime = 0;
        ch.playing = false;
        const playBtn = document.getElementById(`play-${ch.index}`);
        playBtn.classList.remove('active');
        playBtn.innerHTML = '&#9654;';
      }
    });
  });

  function updateMasterMeter() {
    let maxLevel = 0;
    channels.forEach(ch => {
      const h = parseFloat(document.getElementById(`meter-${ch.index}`).style.height) || 0;
      if (h > maxLevel) maxLevel = h;
    });
    masterMeterFill.style.height = maxLevel + '%';
    requestAnimationFrame(updateMasterMeter);
  }
  updateMasterMeter();
})();
