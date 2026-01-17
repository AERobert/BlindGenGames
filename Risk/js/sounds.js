// sounds.js - Sound effects using Web Audio API

(() => {
  let ctx = null;
  let enabled = true;

  // Initialize
  function init() {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      return true;
    } catch (e) {
      enabled = false;
      return false;
    }
  }

  // Resume if suspended
  function resume() { if (ctx?.state === 'suspended') ctx.resume(); }

  // Create tone
  function tone(freq, type, duration, gain = 0.1, delay = 0) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = type;
    gainNode.gain.value = gain;
    const start = ctx.currentTime + delay;
    osc.start(start);
    osc.stop(start + duration);
    return { osc, gainNode };
  }

  // Play sound effect
  function play(type) {
    if (!enabled || !ctx) return;
    try {
      resume();
      switch (type) {
        case 'move': tone(440, 'sine', 0.05, 0.08); break;
        case 'select': tone(660, 'sine', 0.1, 0.12); break;
        case 'attack':
          const a = tone(220, 'sawtooth', 0.3, 0.08);
          if (a) a.gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
          break;
        case 'victory': [523, 659, 784, 1047].forEach((f, i) => tone(f, 'sine', 0.2, 0.12, i * 0.12)); break;
        case 'defeat': [523, 440, 349, 262].forEach((f, i) => tone(f, 'sine', 0.2, 0.08, i * 0.15)); break;
        case 'continent': [392, 494, 587, 784].forEach((f, i) => tone(f, 'triangle', 0.25, 0.15, i * 0.1)); break;
        case 'elimination': [587, 494, 392, 294, 196].forEach((f, i) => tone(f, 'sawtooth', 0.2, 0.06, i * 0.12)); break;
        case 'card': tone(880, 'sine', 0.15, 0.1); break;
        case 'error': tone(200, 'square', 0.12, 0.08); break;
        case 'turn':
          const t = tone(550, 'sine', 0.15, 0.1);
          if (t) t.osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.1);
          break;
        case 'dice': for (let i = 0; i < 5; i++) tone(300 + Math.random() * 200, 'square', 0.05, 0.05, i * 0.06); break;
        case 'place': tone(500, 'sine', 0.08, 0.1); break;
        case 'fortify': tone(400, 'sine', 0.1, 0.08); setTimeout(() => tone(500, 'sine', 0.1, 0.08), 100); break;
        case 'gameWin': [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 'triangle', 0.4, 0.1, i * 0.15)); break;
        case 'gameLose': [523, 392, 330, 262, 196].forEach((f, i) => tone(f, 'sawtooth', 0.3, 0.08, i * 0.2)); break;
      }
    } catch (e) {}
  }

  function toggle() {
    enabled = !enabled;
    const btn = document.getElementById('toggle-sound-btn');
    if (btn) btn.textContent = enabled ? 'Sound Off' : 'Sound On';
    return enabled;
  }

  function setEnabled(val) {
    enabled = val;
    const btn = document.getElementById('toggle-sound-btn');
    if (btn) btn.textContent = enabled ? 'Sound Off' : 'Sound On';
  }

  function isEnabled() { return enabled; }
  function getSettings() { return { enabled }; }
  function restoreSettings(s) { if (s?.enabled !== undefined) setEnabled(s.enabled); }

  window.RiskSounds = {
    init,
    play,
    toggle,
    setEnabled,
    isEnabled,
    getSettings,
    restoreSettings
  };
})();
