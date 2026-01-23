// speech.js - Text-to-speech with robust voice handling
// FIXES: Voice selected by NAME not index, English prioritized, recovery from failures
// CHROME FIX: Warm-up utterance, delay after cancel, periodic health checks

(() => {
  let synth = null;
  let voices = [];
  let voiceName = null;  // Store by name, not index!
  let rate = 1.2;
  let enabled = true;
  let lastText = '';
  let initialized = false;
  let supported = true;
  let warmedUp = false;  // Chrome requires warm-up utterance
  let pendingSpeak = null;  // Queue for speech after cancel delay

  // Initialize
  function init() {
    supported = !!(window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined');
    if (!supported) {
      enabled = false;
      return false;
    }
    synth = window.speechSynthesis;
    loadVoices();
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;
    // Chrome needs multiple attempts to load voices
    setTimeout(loadVoices, 100);
    setTimeout(loadVoices, 500);
    setTimeout(loadVoices, 1000);
    setTimeout(loadVoices, 2000);
    setInterval(checkHealth, 3000);  // More frequent health checks for Chrome
    if (!initialized) {
      // Chrome warm-up: first user interaction unlocks speech
      const warmUp = () => {
        if (!warmedUp && synth) {
          warmedUp = true;
          // Cancel any stuck state
          try { synth.cancel(); } catch (e) {}
          // Chrome sometimes needs resume after cancel
          if (synth.paused) synth.resume();
          // Speak empty utterance to "prime" the engine (Chrome fix)
          const primer = new SpeechSynthesisUtterance('');
          primer.volume = 0;
          try { synth.speak(primer); } catch (e) {}
        }
        if (synth?.paused) synth.resume();
      };
      document.addEventListener('click', warmUp);
      document.addEventListener('keydown', warmUp);
      document.addEventListener('touchstart', warmUp);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) warmUp(); });
      initialized = true;
    }
    return true;
  }

  // Load and sort voices - English first
  function loadVoices() {
    if (!synth) return;
    const raw = synth.getVoices();
    if (raw.length === 0) return;

    // Sort: en-US/en-GB first, then other English, then rest
    voices = [...raw].sort((a, b) => {
      const aLang = a.lang.toLowerCase(), bLang = b.lang.toLowerCase();
      const aUSUK = aLang === 'en-us' || aLang === 'en-gb';
      const bUSUK = bLang === 'en-us' || bLang === 'en-gb';
      if (aUSUK && !bUSUK) return -1;
      if (!aUSUK && bUSUK) return 1;
      const aEn = aLang.startsWith('en'), bEn = bLang.startsWith('en');
      if (aEn && !bEn) return -1;
      if (!aEn && bEn) return 1;
      if (a.localService && !b.localService) return -1;
      if (!a.localService && b.localService) return 1;
      return a.name.localeCompare(b.name);
    });

    populateSelectors();
    if (!voiceName && voices.length > 0) voiceName = voices[0].name;
  }

  // Populate dropdowns
  function populateSelectors() {
    for (const id of ['voice-select', 'game-voice-select', 'lobby-voice-select']) {
      populateVoiceSelect(id);
    }
  }

  // Populate a specific voice select element
  function populateVoiceSelect(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '';
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.name === voiceName) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // Get voice by name
  function getVoice(name) {
    return voices.find(v => v.name === name) || voices[0] || null;
  }

  // Check if stuck - Chrome often gets paused/stuck
  function checkHealth() {
    if (!synth) return;
    // Resume if paused
    if (synth.paused) {
      try { synth.resume(); } catch (e) {}
    }
    // Chrome bug: speaking can be true but nothing actually playing
    // If we have pending speech and synth appears stuck, kick it
    if (synth.speaking && !synth.pending && !synth.paused) {
      // Seems fine
    }
  }

  // Internal speak function - called after any cancel delay
  function doSpeak(text) {
    if (!synth) return;

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getVoice(voiceName);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      // Chrome recovery: reload voices and try to resume
      setTimeout(() => {
        try { synth.cancel(); } catch (e) {}
        loadVoices();
        if (synth.paused) synth.resume();
      }, 100);
    };

    try {
      // Chrome: ensure not paused before speaking
      if (synth.paused) synth.resume();
      synth.speak(utterance);
      // Chrome: double-check resume after speak
      if (synth.paused) synth.resume();
    } catch (e) {}
  }

  // Speak text
  function speak(text, interrupt = true) {
    if (!enabled || !supported || !text) return;
    lastText = text;

    // Update ARIA live region
    const region = document.getElementById('live-region');
    if (region) { region.textContent = ''; setTimeout(() => { region.textContent = text; }, 50); }

    if (!synth && window.speechSynthesis) synth = window.speechSynthesis;
    if (!synth) return;

    // Clear any pending speak
    if (pendingSpeak) {
      clearTimeout(pendingSpeak);
      pendingSpeak = null;
    }

    if (interrupt) {
      try { synth.cancel(); } catch (e) {}
      // CHROME FIX: Must delay after cancel() before speak() or utterance won't play
      // This is the main Chrome bug - cancel + immediate speak = silence
      pendingSpeak = setTimeout(() => {
        pendingSpeak = null;
        doSpeak(text);
      }, 50);
    } else {
      doSpeak(text);
    }
  }

  // Repeat last
  function repeat() { if (lastText) speak(lastText); }

  // Set voice
  function setVoice(name) {
    if (name && voices.some(v => v.name === name)) {
      voiceName = name;
      for (const id of ['voice-select', 'game-voice-select']) {
        const sel = document.getElementById(id);
        if (sel) sel.value = name;
      }
    }
  }

  // Update from UI
  function updateVoiceFromUI(selectId) {
    const sel = document.getElementById(selectId);
    if (sel?.value) setVoice(sel.value);
  }

  // Set rate
  function setRate(r) {
    rate = Math.max(0.5, Math.min(4, r));
    const display = document.getElementById('game-rate-value');
    if (display) display.textContent = rate.toFixed(1);
  }

  // Toggle
  function toggle() {
    if (!supported) return false;
    enabled = !enabled;
    updateSpeechButton();
    if (enabled) speak('Speech enabled');
    return enabled;
  }

  function updateSpeechButton() {
    const btn = document.getElementById('toggle-speech-btn');
    if (btn) {
      btn.textContent = enabled ? 'Speech: On' : 'Speech: Off';
      btn.setAttribute('aria-pressed', enabled.toString());
    }
  }

  // Getters
  function isEnabled() { return enabled; }
  function isSupported() { return supported; }
  function getRate() { return rate; }
  function getVoiceName() { return voiceName; }
  function getSettings() { return { voiceName, rate, enabled }; }
  function restoreSettings(s) {
    if (!s) return;
    if (s.voiceName) { voiceName = s.voiceName; populateSelectors(); }
    if (s.rate) setRate(s.rate);
    if (s.enabled !== undefined) enabled = s.enabled;
  }

  window.RiskSpeech = {
    init,
    speak,
    repeat,
    setVoice,
    updateVoiceFromUI,
    setRate,
    toggle,
    isEnabled,
    isSupported,
    getRate,
    getVoiceName,
    getSettings,
    restoreSettings,
    populateVoiceSelect
  };
})();
