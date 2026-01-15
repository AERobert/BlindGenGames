// speech.js - Text-to-speech with robust voice handling
// FIXES: Voice selected by NAME not index, English prioritized, recovery from failures

let synth = null;
let voices = [];
let voiceName = null;  // Store by name, not index!
let rate = 1.2;
let enabled = true;
let lastText = '';
let initialized = false;
let supported = true;

// Initialize
export function init() {
  supported = !!(window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined');
  if (!supported) {
    enabled = false;
    return false;
  }
  synth = window.speechSynthesis;
  loadVoices();
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;
  setTimeout(loadVoices, 100);
  setTimeout(loadVoices, 500);
  setInterval(checkHealth, 5000);
  if (!initialized) {
    const resume = () => {
      if (synth?.paused) synth.resume();
    };
    document.addEventListener('click', resume);
    document.addEventListener('keydown', resume);
    document.addEventListener('touchstart', resume);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
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
  for (const id of ['voice-select', 'game-voice-select']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    sel.innerHTML = '';
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.name === voiceName) opt.selected = true;
      sel.appendChild(opt);
    }
  }
}

// Get voice by name
function getVoice(name) {
  return voices.find(v => v.name === name) || voices[0] || null;
}

// Check if stuck
function checkHealth() {
  if (synth?.paused) synth.resume();
}

// Speak text
export function speak(text, interrupt = true) {
  if (!enabled || !supported || !text) return;
  lastText = text;
  
  // Update ARIA live region
  const region = document.getElementById('live-region');
  if (region) { region.textContent = ''; setTimeout(() => { region.textContent = text; }, 50); }
  
  if (!synth && window.speechSynthesis) synth = window.speechSynthesis;
  if (!synth) return;
  if (interrupt) try { synth.cancel(); } catch (e) {}
  
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = getVoice(voiceName);
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  utterance.pitch = 1;
  utterance.volume = 1;
  
  utterance.onerror = (e) => {
    if (e.error === 'canceled' || e.error === 'interrupted') return;
    setTimeout(() => { synth.cancel(); loadVoices(); }, 100);
  };
  
  try {
    synth.speak(utterance);
    if (synth.paused) synth.resume();
  } catch (e) {}
}

// Repeat last
export function repeat() { if (lastText) speak(lastText); }

// Set voice
export function setVoice(name) {
  if (name && voices.some(v => v.name === name)) {
    voiceName = name;
    for (const id of ['voice-select', 'game-voice-select']) {
      const sel = document.getElementById(id);
      if (sel) sel.value = name;
    }
  }
}

// Update from UI
export function updateVoiceFromUI(selectId) {
  const sel = document.getElementById(selectId);
  if (sel?.value) setVoice(sel.value);
}

// Set rate
export function setRate(r) {
  rate = Math.max(0.5, Math.min(4, r));
  const display = document.getElementById('game-rate-value');
  if (display) display.textContent = rate.toFixed(1);
}

// Toggle
export function toggle() {
  if (!supported) return false;
  enabled = !enabled;
  const btn = document.getElementById('toggle-speech-btn');
  if (btn) btn.textContent = enabled ? 'Mute' : 'Unmute';
  if (enabled) speak('Speech enabled');
  return enabled;
}

// Getters
export function isEnabled() { return enabled; }
export function isSupported() { return supported; }
export function getRate() { return rate; }
export function getVoiceName() { return voiceName; }
export function getSettings() { return { voiceName, rate, enabled }; }
export function restoreSettings(s) {
  if (!s) return;
  if (s.voiceName) { voiceName = s.voiceName; populateSelectors(); }
  if (s.rate) setRate(s.rate);
  if (s.enabled !== undefined) enabled = s.enabled;
}
