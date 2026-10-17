(function () {
  'use strict';
  if (window.WitnessBGM) return;
  const KEY = 'last-witness-bgm-v1';
  let initialized = false, audio = null, panel = null, fadeJob = null;
  let volume = .25, muted = false, requested = false, loading = false;
  let resumeWhenVisible = false, errorText = '', operation = 0, expanded = false;

  function preferences() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (Number.isFinite(value.volume)) volume = Math.max(0, Math.min(1, value.volume));
      if (typeof value.muted === 'boolean') muted = value.muted;
    } catch (_) {}
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ volume: volume, muted: muted })); } catch (_) {}
  }
  function state() {
    return {
      initialized: initialized, playing: !!audio && !audio.paused && !audio.ended,
      loading: loading, volume: volume, muted: muted, hidden: document.hidden,
      duration: audio && Number.isFinite(audio.duration) ? audio.duration : null,
      currentTime: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      source: audio ? audio.currentSrc : '', error: errorText
    };
  }
  function publish() {
    if (!panel) return;
    const current = state(), play = panel.querySelector('[data-bgm="play"]');
    play.textContent = current.loading ? '준비 중…' : current.playing ? 'Ⅱ 일시정지' : '▶ 재생';
    play.setAttribute('aria-label', current.playing ? '배경음악 일시정지' : '배경음악 재생');
    play.setAttribute('aria-pressed', String(current.playing));
    panel.dataset.playing = String(current.playing);
    const mute = panel.querySelector('[data-bgm="mute"]');
    mute.textContent = muted ? '소리 켜기' : '음소거';
    mute.setAttribute('aria-label', muted ? '배경음악 음소거 해제' : '배경음악 음소거');
    mute.setAttribute('aria-pressed', String(muted));
    const slider = panel.querySelector('input');
    slider.value = String(Math.round(volume * 100));
    slider.setAttribute('aria-valuetext', Math.round(volume * 100) + '퍼센트');
    panel.querySelector('output').textContent = Math.round(volume * 100) + '%';
    panel.querySelector('[data-bgm-status]').textContent = errorText || (current.loading ? '음악을 준비하고 있습니다' : current.playing ? '고요한 증거 · 반복 재생' : '고요한 증거 · 눌러서 재생');
    window.dispatchEvent(new CustomEvent('witness:bgm-change', { detail: current }));
  }
  function stopFade() {
    if (fadeJob) { clearTimeout(fadeJob.timer); fadeJob.resolve(false); fadeJob = null; }
  }
  function fadeTo(target, milliseconds) {
    stopFade();
    const start = audio.volume, began = performance.now();
    return new Promise(function (resolve) {
      const job = { timer: null, resolve: resolve };
      fadeJob = job;
      function tick() {
        if (fadeJob !== job) return;
        const progress = Math.min(1, (performance.now() - began) / milliseconds);
        const smooth = .5 - .5 * Math.cos(progress * Math.PI);
        audio.volume = Math.max(0, Math.min(1, start + (target - start) * smooth));
        if (progress >= 1) { fadeJob = null; resolve(true); }
        else job.timer = setTimeout(tick, 20);
      }
      tick();
    });
  }
  async function play(resuming) {
    init();
    if (!audio || document.hidden) return false;
    requested = true; resumeWhenVisible = false; errorText = '';
    const stamp = ++operation;
    stopFade(); audio.volume = 0; audio.muted = muted;
    loading = true; publish();
    try {
      await audio.play();
      if (stamp !== operation) return false;
      if (!requested || document.hidden) { audio.pause(); return false; }
      loading = false; publish();
      await fadeTo(muted ? 0 : volume, resuming ? 300 : 550);
      return stamp === operation && !audio.paused;
    } catch (_) {
      if (stamp === operation) {
        loading = false; requested = false; resumeWhenVisible = false;
        errorText = '재생 버튼을 다시 눌러 주세요';
        audio.pause(); publish();
      }
      return false;
    }
  }
  async function pause(forVisibility) {
    if (!initialized) return false;
    const stamp = ++operation;
    if (!forVisibility) { requested = false; resumeWhenVisible = false; }
    loading = false;
    if (!audio.paused) await fadeTo(0, 180);
    if (stamp !== operation) return false;
    audio.pause(); publish(); return true;
  }
  function setVolume(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return volume;
    volume = Math.max(0, Math.min(1, next)); save();
    if (audio && !audio.paused) fadeTo(muted ? 0 : volume, 120);
    publish(); return volume;
  }
  function setMuted(value) {
    muted = !!value; save();
    if (audio) { audio.muted = muted; if (!audio.paused) fadeTo(muted ? 0 : volume, 150); }
    publish(); return muted;
  }
  function visibility() {
    if (!audio) return;
    if (document.hidden) {
      resumeWhenVisible = requested && (!audio.paused || loading);
      pause(true);
    } else if (resumeWhenVisible && requested) {
      resumeWhenVisible = false;
      play(true);
    }
  }
  function init() {
    if (initialized) return state();
    if (!document.body) return state();
    initialized = true; preferences();
    const style = document.createElement('style');
    style.id = 'witness-bgm-style';
    style.textContent = `
      body.witness-bgm-ready{padding-bottom:140px}
      .witness-bgm{box-sizing:border-box;position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));z-index:55;width:302px;padding:12px 14px;color:#eee6dc;background:rgba(16,18,23,.96);border:1px solid rgba(207,177,126,.3);border-radius:14px;box-shadow:0 12px 38px rgba(0,0,0,.45);font-family:inherit;font-size:12px;line-height:1.4;backdrop-filter:blur(14px)}
      .witness-bgm *{box-sizing:border-box}.witness-bgm-top{display:flex;align-items:center;gap:9px}.witness-bgm-label{font-size:11px;letter-spacing:.09em;color:#c8ad81;flex:1}.witness-bgm button{font:inherit;cursor:pointer;border:1px solid #56504a;border-radius:7px;background:#22242a;color:#f0e9df;min-height:34px;padding:5px 10px}.witness-bgm button:hover{background:#343138}.witness-bgm button:focus-visible,.witness-bgm input:focus-visible{outline:2px solid #dbc294;outline-offset:3px}.witness-bgm [data-bgm=play]{color:#eee0c8;border-color:#8c7656}.witness-bgm[data-playing=true] [data-bgm=play]{background:#3b3027}.witness-bgm-status{display:block;min-height:15px;margin-top:5px;font-size:10px;color:#a9a6a2}.witness-bgm-details{display:flex;align-items:center;gap:8px;margin-top:9px}.witness-bgm-details label{font-size:10px;color:#b7afa5}.witness-bgm input{width:100%;min-width:40px;accent-color:#c5a46d}.witness-bgm output{font-size:10px;color:#cbc0b1;min-width:28px;text-align:right}.witness-bgm [data-bgm=mute]{font-size:10px;min-width:65px;white-space:nowrap}.witness-bgm [data-bgm=expand]{display:none}.witness-bgm audio{display:none}
      @media(max-width:600px){.witness-bgm{right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));width:222px;padding:9px 11px}.witness-bgm [data-bgm=expand]{display:block;font-size:10px;padding:4px 7px;min-height:32px}.witness-bgm [data-bgm=play]{font-size:11px;padding:4px 9px;min-height:32px}.witness-bgm-label{font-size:10px;letter-spacing:0}.witness-bgm-details{display:none}.witness-bgm[data-expanded=true] .witness-bgm-details{display:flex}.witness-bgm-status{font-size:9px}.witness-bgm[data-expanded=true]{width:min(302px,calc(100vw - 20px))}}
      @media(prefers-reduced-motion:reduce){.witness-bgm{backdrop-filter:none}}
      @media print{.witness-bgm{display:none!important}body.witness-bgm-ready{padding-bottom:0}}
    `;
    document.head.appendChild(style);
    panel = document.createElement('section');
    panel.id = 'witness-bgm'; panel.className = 'witness-bgm'; panel.dataset.expanded = 'false';
    panel.setAttribute('aria-label', '배경음악 조절');
    panel.innerHTML = '<div class="witness-bgm-top"><span class="witness-bgm-label">♫ 배경음악</span><button type="button" data-bgm="play" aria-label="배경음악 재생" aria-pressed="false">▶ 재생</button><button type="button" data-bgm="expand" aria-label="배경음악 음량 조절 펼치기" aria-expanded="false" aria-controls="witness-bgm-details">음량</button></div><span class="witness-bgm-status" data-bgm-status role="status" aria-live="polite">고요한 증거 · 눌러서 재생</span><div class="witness-bgm-details" id="witness-bgm-details"><label for="witness-bgm-volume">음량</label><input id="witness-bgm-volume" type="range" min="0" max="100" step="1" value="25" aria-label="배경음악 음량"><output for="witness-bgm-volume">25%</output><button type="button" data-bgm="mute" aria-label="배경음악 음소거" aria-pressed="false">음소거</button></div>';
    audio = document.createElement('audio'); audio.id = 'witness-bgm-audio';
    audio.preload = 'none'; audio.loop = true; audio.volume = 0; audio.muted = muted;
    audio.setAttribute('aria-hidden', 'true');
    [['/audio/witness-noir-loop.mp3', 'audio/mpeg'], ['/audio/witness-noir-loop.ogg', 'audio/ogg; codecs="opus"']].forEach(function (entry) {
      const source = document.createElement('source'); source.src = entry[0]; source.type = entry[1]; audio.appendChild(source);
    });
    panel.appendChild(audio); document.body.appendChild(panel); document.body.classList.add('witness-bgm-ready');
    panel.querySelector('[data-bgm="play"]').addEventListener('click', function () { audio.paused && !loading ? play(false) : pause(false); });
    panel.querySelector('[data-bgm="mute"]').addEventListener('click', function () { setMuted(!muted); });
    panel.querySelector('input').addEventListener('input', function (event) { setVolume(Number(event.target.value) / 100); });
    panel.querySelector('[data-bgm="expand"]').addEventListener('click', function (event) {
      expanded = !expanded; panel.dataset.expanded = String(expanded);
      event.currentTarget.setAttribute('aria-expanded', String(expanded));
      event.currentTarget.setAttribute('aria-label', expanded ? '배경음악 음량 조절 접기' : '배경음악 음량 조절 펼치기');
    });
    audio.addEventListener('playing', publish); audio.addEventListener('pause', publish); audio.addEventListener('loadedmetadata', publish);
    audio.addEventListener('error', function () { loading = false; requested = false; resumeWhenVisible = false; errorText = '음악 연결을 확인한 뒤 다시 재생해 주세요'; audio.pause(); publish(); });
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', function () { resumeWhenVisible = requested && !audio.paused; operation++; stopFade(); loading = false; audio.pause(); });
    window.addEventListener('pageshow', function (event) { if (event.persisted) visibility(); });
    publish(); return state();
  }
  window.WitnessBGM = Object.freeze({
    init: init, play: function () { return play(false); }, pause: function () { return pause(false); },
    toggle: function () { init(); return audio && (!audio.paused || loading) ? pause(false) : play(false); },
    setVolume: setVolume, setMuted: setMuted, mute: function () { return setMuted(true); },
    unmute: function () { return setMuted(false); }, getState: state
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
