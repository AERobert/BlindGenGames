// sounds.js — SC.Sounds: Web Audio cue engine for Accessible Scrabble.
//
// Ported from Risk/js/sounds.js (the hardened tone()/play() pattern) onto a
// shared masterGain, plus a feature-detected StereoPanner spatial layer so
// positional cues can pan by board column and shift pitch by board row.
//
// Contract: ARCHITECTURE.md §3 (SC.Sounds) + §7; recipes from
// INTERFACE_DESIGN.md §8; house style from research/SPEC-housestyle.md §2.
//
// Hard constraints (ARCHITECTURE §0): plain ES5-ish var/IIFE, no ES modules,
// no fetch, runs from file://, everything hangs off window.SC. Other SC.*
// modules are touched only inside functions (this module has no such deps).

window.SC = window.SC || {};
SC.Sounds = (function () {
  'use strict';

  // ---- Module-private state -------------------------------------------------
  var ctx = null;          // the AudioContext (null until init succeeds)
  var enabled = true;      // master on/off for all cues (the Sound: On/Off toggle)
  var volume = 1;          // master volume 0..1, applied via masterGain
  var spatial = false;     // spatial-audio setting: pan by col, pitch by row
  var masterGain = null;   // single gain node every tone routes through
  var panSupported = false; // true iff this AudioContext exposes createStereoPanner
  var initialized = false; // guard so init() is idempotent

  // The exact set of cue types this module must handle (ARCHITECTURE §3). Kept
  // as data so the self-test can prove every one hits a real case (SPEC §2.5).
  var CUE_TYPES = [
    'move', 'edge', 'onTile', 'premiumDL', 'premiumTL', 'premiumDW', 'premiumTW',
    'stage', 'place', 'reject', 'invalid', 'validWord', 'commit', 'bingo',
    'scoreTick', 'draw', 'blank', 'exchange', 'pass', 'yourTurn', 'oppThinking',
    'oppPlayed', 'win', 'lose', 'ui'
  ];

  // ---- Init / lifecycle -----------------------------------------------------

  // Create the AudioContext, the shared masterGain, and detect StereoPanner.
  // Mirrors Risk init() (try/catch around the AudioContext ctor); on failure we
  // disable so every later call is a safe no-op. Idempotent.
  function init() {
    if (initialized) return enabled;
    initialized = true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      // One master gain for the whole module: volume lives in exactly one place
      // and every tone connects through it to the speakers.
      masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
      // Old Safari's webkitAudioContext has no createStereoPanner; detect it so
      // spatial cues degrade silently to mono rather than throwing (SPEC §2.3).
      panSupported = typeof ctx.createStereoPanner === 'function';
      return true;
    } catch (e) {
      // No Web Audio available: keep ctx null; play() becomes a no-op.
      enabled = false;
      ctx = null;
      return false;
    }
  }

  // Resume a context the browser auto-suspended (autoplay policy). Called at the
  // top of play() so the first user-gesture-driven cue actually sounds. KEEP
  // from Risk resume().
  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // ---- Spatial helpers (column -> pan, row -> pitch) ------------------------
  // Board indices are 0..14: row 0..14 = A..O, col 0..14 = 1..15 (ARCHITECTURE
  // §2). The center square H8 is row 7 / col 7, which maps to dead-center pan
  // and unity pitch so the middle of the board is the neutral reference point.

  // Map a 0..14 column to a stereo pan position: -1 far left .. +1 far right.
  // col 0 -> -1.0, col 7 -> 0, col 14 -> +1.0. null/undefined -> centered.
  function panForCol(col) {
    if (col == null) return 0;
    return (col - 7) / 7;
  }

  // Map a 0..14 row to a pitch MULTIPLIER. Higher rows (toward A, the top) sound
  // higher; lower rows (toward O) sound lower, spanning ~half an octave so it
  // stays musical. row 0 -> ~1.22x, row 7 -> 1.0x, row 14 -> ~0.82x.
  function pitchForRow(row) {
    if (row == null) return 1;
    var semitones = (7 - row) * 0.5;     // +3.5 .. -3.5 semitones across the board
    return Math.pow(2, semitones / 12);  // equal-tempered frequency ratio
  }

  // ---- Core tone primitive --------------------------------------------------

  // Synthesize one oscillator note. Ported from Risk tone(freq,type,duration,
  // gain,delay) with two additions: it routes through masterGain (not straight
  // to ctx.destination) so volume is centralized, and it accepts an optional pan
  // that inserts a StereoPanner only when spatial audio is on AND supported AND
  // a non-zero pan is requested. Returns {osc, gainNode} so callers can ramp
  // gain/frequency (commit/bingo/win/lose/exchange rely on this) — preserved.
  function tone(freq, type, duration, gain, delay, pan) {
    if (!ctx) return;
    gain = (gain == null) ? 0.1 : gain;
    delay = delay || 0;
    var osc = ctx.createOscillator();
    var gainNode = ctx.createGain();
    osc.connect(gainNode);
    if (spatial && panSupported && pan) {
      // Spatial path: oscillator -> gain -> panner -> masterGain -> speakers.
      var panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan)); // clamp to valid range
      gainNode.connect(panner);
      panner.connect(masterGain);
    } else {
      // Mono path: oscillator -> gain -> masterGain -> speakers.
      gainNode.connect(masterGain);
    }
    osc.frequency.value = freq;
    osc.type = type;
    gainNode.gain.value = gain;
    var start = ctx.currentTime + delay;
    osc.start(start);
    osc.stop(start + duration);
    return { osc: osc, gainNode: gainNode };
  }

  // ---- Small reusable cue idioms (DRY: shared by several cases below) -------

  // Play an arpeggio: each frequency as one note, staggered by `step` seconds.
  // Used by bingo/win/lose/validWord/draw/blank — Risk's forEach-tone idiom.
  function arpeggio(freqs, type, duration, gain, step) {
    for (var i = 0; i < freqs.length; i++) {
      tone(freqs[i], type, duration, gain, i * step);
    }
  }

  // Play a note that decays to near-silence (exponential gain ramp). Used by the
  // "stamp"-style cues (commit). Mirrors Risk's exponentialRampToValueAtTime
  // decay idiom; guarded because the node is undefined when ctx is null.
  function decayTone(freq, type, duration, gain, pan) {
    var n = tone(freq, type, duration, gain, 0, pan);
    if (n) n.gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    return n;
  }

  // Play a note that glides from `from` Hz to `to` Hz over its duration (pitch
  // sweep). Used by exchange (whoosh) and yourTurn (rising). Mirrors Risk's
  // osc.frequency.exponentialRampToValueAtTime 'turn' idiom.
  function sweepTone(from, to, type, duration, gain) {
    var n = tone(from, type, duration, gain);
    if (n) n.osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
    return n;
  }

  // ---- play(type, opts): the dispatcher ------------------------------------
  //
  // KEEP Risk's skeleton: bail if disabled / no context, resume(), switch in a
  // try/catch so a single bad cue can never break the game. `opts` may carry
  // {col,row} for positional cues; defaults to {}. Non-positional cues ignore
  // opts and pan 0 (SPEC §2.3/§2.4). Recipes are from INTERFACE_DESIGN §8 /
  // SPEC §2.4 — Risk timbres reused so the games feel related.
  function play(type, opts) {
    if (!enabled || !ctx) return;
    opts = opts || {};
    try {
      resume();

      // Precompute the spatial parameters once for the positional cues. When
      // spatial is off these collapse to neutral (pan 0, pitch x1), so the same
      // case body works in both modes.
      var pan = spatial ? panForCol(opts.col) : 0;
      var pitch = spatial ? pitchForRow(opts.row) : 1;

      switch (type) {
        // --- Positional cues: pan by column, pitch by row -------------------
        case 'move':                       // cursor moved onto an empty square
          tone(440 * pitch, 'sine', 0.05, 0.08, 0, pan);
          break;
        case 'onTile':                     // cursor on an occupied square (brighter)
          tone(520 * pitch, 'sine', 0.05, 0.09, 0, pan);
          break;
        case 'premiumDL':                  // double letter score
          tone(660 * pitch, 'sine', 0.08, 0.09, 0, pan);
          break;
        case 'premiumTL':                  // triple letter score (brighter than DL)
          tone(880 * pitch, 'sine', 0.08, 0.09, 0, pan);
          break;
        case 'premiumDW':                  // double word score
          tone(700 * pitch, 'triangle', 0.10, 0.10, 0, pan);
          break;
        case 'premiumTW':                  // triple word score (brightest premium)
          tone(990 * pitch, 'triangle', 0.12, 0.11, 0, pan);
          break;
        case 'stage': {                    // Composer: a VALID letter typed (rising ding)
          // "For fun" rising ding whose pitch climbs with the letter's POSITION in
          // the word being typed: 1st letter lowest, each next a bit higher. We key
          // on opts.index (0-based position; preferred), falling back to the older
          // opts.letterCount (1-based count) so existing callers still rise. Capped
          // so a long word stays musical (~one octave of headroom). A short, soft
          // sine so it is pleasant on every keystroke.
          var step = (opts.index != null) ? opts.index : ((opts.letterCount || 1) - 1);
          if (step < 0) step = 0;
          if (step > 14) step = 14;          // cap the climb (1 board word's worth)
          tone((480 + 45 * step) * pitch, 'sine', 0.05, 0.07, 0, pan);
          break;
        }
        case 'place': {                    // tile-by-tile: a tile dropped on a square
          // A distinct, satisfying little "thunk": a short triangle note that decays
          // quickly, with a brief higher click on top — clearly different from the
          // composer's pure-sine ding and from the heavier 'commit' stamp. Spatial:
          // pan by column, pitch by row (opts {row,col}) like the cursor cues.
          decayTone(300 * pitch, 'triangle', 0.09, 0.10, pan);  // body
          tone(760 * pitch, 'sine', 0.03, 0.05, 0.01, pan);     // click accent
          break;
        }
        case 'reject':                     // Composer: an INVALID letter (rejected)
          // A brief, low square buzz — like 'invalid' but shorter/quieter since it
          // fires per rejected keystroke and must not be harsh. Reverting the typed
          // char is the UI's job; this just signals "that letter can't go there".
          tone(220, 'square', 0.07, 0.06);
          break;

        // --- Edge: a positional-ish bump that does not need spatial pitch ----
        case 'edge':                       // cursor hit a board boundary (dull)
          tone(180, 'sine', 0.08, 0.08);
          break;

        // --- Feedback cues (non-positional) --------------------------------
        case 'invalid':                    // illegal placement / non-word (== Risk 'error')
          tone(200, 'square', 0.12, 0.08);
          break;
        case 'validWord':                  // word parses & is valid (pleasant 2-note)
          tone(660, 'sine', 0.08, 0.1);
          tone(880, 'sine', 0.08, 0.1, 0.09);
          break;
        case 'commit': {                   // play committed: a satisfying "stamp"
          decayTone(300, 'sawtooth', 0.12, 0.1);
          // Richer stamp for a big score: add a higher partial when score >= 30.
          if (opts.score != null && opts.score >= 30) decayTone(450, 'sawtooth', 0.12, 0.08);
          break;
        }
        case 'bingo':                      // all 7 tiles used: celebratory rise
          arpeggio([523, 659, 784, 1047, 1319], 'triangle', 0.2, 0.12, 0.1);
          break;
        case 'scoreTick':                  // one beep per point during count-up (UI loops it)
          tone(880, 'square', 0.03, 0.05);
          break;
        case 'draw':                       // drawing tiles: a light riffle
          for (var i = 0; i < 5; i++) tone(700 + Math.random() * 200, 'sine', 0.03, 0.05, i * 0.05);
          break;
        case 'blank':                      // a blank tile placed: distinct shimmer
          arpeggio([1175, 1568], 'sine', 0.12, 0.07, 0.06);
          break;
        case 'exchange':                   // tiles exchanged: a whoosh sweep
          sweepTone(300, 600, 'sawtooth', 0.2, 0.07);
          break;
        case 'pass':                       // turn passed: neutral low tone
          tone(300, 'sine', 0.15, 0.08);
          break;

        // --- Turn / opponent / menu cues -----------------------------------
        case 'yourTurn':                   // your turn begins: rising attention tone
          sweepTone(550, 700, 'sine', 0.15, 0.1);
          break;
        case 'oppThinking':                // opponent deciding: subtle low tick
          tone(300, 'sine', 0.04, 0.03);
          break;
        case 'oppPlayed':                  // opponent finished: "incoming" two-note fall
          tone(660, 'sine', 0.1, 0.09);
          tone(550, 'sine', 0.1, 0.09, 0.1);
          break;
        case 'win':                        // game won (Risk 'gameWin' verbatim)
          arpeggio([262, 330, 392, 523, 659, 784, 1047], 'triangle', 0.4, 0.1, 0.15);
          break;
        case 'lose':                       // game lost (Risk 'gameLose' verbatim)
          arpeggio([523, 392, 330, 262, 196], 'sawtooth', 0.3, 0.08, 0.2);
          break;
        case 'ui':                         // generic menu/toggle blip
          tone(880, 'sine', 0.04, 0.06);
          break;
      }
    } catch (e) {
      // Swallow any audio error: a broken cue must never interrupt gameplay.
    }
  }

  // ---- Enable / volume / spatial toggles -----------------------------------

  // Toggle all sound on/off, sync the toolbar button, return the new state.
  function toggle() {
    enabled = !enabled;
    updateSoundButton();
    return enabled;
  }

  // Explicitly set the on/off state (used by restoreSettings + the settings UI).
  function setEnabled(val) {
    enabled = !!val;
    updateSoundButton();
  }

  // Set master volume, clamped to 0..1, applied live via masterGain (SPEC §2.2).
  function setVolume(val) {
    volume = Math.max(0, Math.min(1, val));
    if (masterGain) masterGain.gain.value = volume;
  }

  // Turn spatial audio (column pan / row pitch) on or off.
  function setSpatial(val) {
    spatial = !!val;
  }

  // ---- Toolbar button binding (#toggle-sound-btn) --------------------------
  // index.html is the DOM source of truth (ARCHITECTURE §7.0); its button id is
  // exactly "toggle-sound-btn" (line 102). Reflect both label and aria-pressed
  // so the toggle state is programmatically exposed to screen readers.
  function updateSoundButton() {
    // Guard `document`: this module must stay callable under the DOM-free Node
    // test shim (ARCHITECTURE §6), where setEnabled/restoreSettings run without a
    // DOM. In the browser `document` always exists, so this is a no-cost guard.
    if (typeof document === 'undefined') return;
    var btn = document.getElementById('toggle-sound-btn');
    if (btn) {
      btn.textContent = enabled ? 'Sound: On' : 'Sound: Off';
      btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }
  }

  // Click on the button mirrors the Shift+S hotkey, and cue it with a UI blip.
  // Done inside init() (not at load) so the element exists and we respect §0.
  function bindButton() {
    if (typeof document === 'undefined') return; // DOM-free test shim guard
    var btn = document.getElementById('toggle-sound-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        toggle();
        play('ui'); // audible confirmation (no-op when we just turned sound off)
      });
    }
  }

  // ---- Settings serialization ----------------------------------------------

  function isEnabled() { return enabled; }

  // Persisted blob (ARCHITECTURE §3 / SPEC §2.5): enabled, volume, spatial.
  function getSettings() {
    return { enabled: enabled, volume: volume, spatial: spatial };
  }

  // Restore each field defensively (any may be absent in older saves).
  function restoreSettings(s) {
    if (!s) return;
    if (s.enabled !== undefined) setEnabled(s.enabled);
    if (s.volume !== undefined) setVolume(s.volume);
    if (s.spatial !== undefined) setSpatial(s.spatial);
  }

  // ---- Self-test (used by the verifier; no DOM/audio required) -------------
  // Proves every required cue type hits a real case (no silent default) and the
  // spatial helpers behave at the documented anchor points (SPEC §2.5).
  function selfTest() {
    var results = { types: 0, ok: true };
    // Run every cue with audio disabled so it is a guaranteed no-throw no-op
    // even when no AudioContext exists (e.g. under Node).
    var savedEnabled = enabled;
    enabled = false;
    for (var i = 0; i < CUE_TYPES.length; i++) {
      try { play(CUE_TYPES[i], { col: 7, row: 7 }); results.types++; }
      catch (e) { results.ok = false; }
    }
    enabled = savedEnabled;
    // Spatial helper anchors (exact at center; ends within rounding tolerance).
    if (panForCol(0) !== -1 || panForCol(7) !== 0 || panForCol(14) !== 1) results.ok = false;
    if (panForCol(null) !== 0) results.ok = false;
    if (pitchForRow(7) !== 1) results.ok = false;
    if (pitchForRow(null) !== 1) results.ok = false;
    return results;
  }

  // ---- Public API (exactly ARCHITECTURE §3 SC.Sounds, + kept isEnabled) ----
  // Helpers panForCol/pitchForRow/setSpatial/selfTest are exposed too: the spec
  // (SPEC §2.3/§2.5) names them as the spatial contract and test surface, and
  // setSpatial is needed by the settings UI to drive the persisted flag.
  return {
    init: init,
    play: play,
    toggle: toggle,
    setEnabled: setEnabled,
    setVolume: setVolume,
    setSpatial: setSpatial,
    isEnabled: isEnabled,
    getSettings: getSettings,
    restoreSettings: restoreSettings,
    panForCol: panForCol,
    pitchForRow: pitchForRow,
    selfTest: selfTest,
    bindButton: bindButton
  };
})();
