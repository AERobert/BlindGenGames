// =============================================================================
// js/speech.js  —  SC.Speech
// -----------------------------------------------------------------------------
// Dual-output accessibility speech for Accessible Scrabble: it drives BOTH the
// browser Web Speech API (text-to-speech) AND the two ARIA live regions so the
// game is fully usable whether the player relies on TTS, a screen reader, or
// both at once.
//
// This is a faithful PORT of Risk/js/speech.js. The Chrome hardening in that
// file (voice selection by NAME, a warm-up primer utterance, the critical
// cancel()->50ms->speak() dance, and the periodic resume() health check) is the
// single most load-bearing bug fix in the repo and is preserved verbatim in
// behaviour — only re-targeted to Scrabble's element IDs and extended for the
// SC.Speech contract (ARCHITECTURE.md §3 / §7.6, research/SPEC-housestyle.md §1).
//
// Key differences from the Risk original (all mandated by the contract):
//   * Namespaced as SC.Speech via the repo's assigning-IIFE form (no ES modules,
//     no import/export, no fetch — runs from file://).
//   * Dual live regions: speak() -> polite #sc-live; alert() -> assertive
//     #sc-live-assertive. Both share ONE private _emit() so the hardened Chrome
//     logic is never forked (SPEC §1.4).
//   * setRate clamp ceiling raised to 6.0 (default 2.5) per ARCHITECTURE §7.6.
//   * Adds spell()/NATO and setNatoMode() for letter-by-letter announcements.
//   * Binds the two header toggle buttons by the exact ids in index.html:
//     #toggle-voice-btn and #toggle-aria-btn.
//   * Drops Risk's legacy toggle()/updateVoiceFromUI() (new game, no back-compat).
//
// NOTE ON IDs: index.html is the DOM source of truth (ARCHITECTURE §7.0). The
// real ids there are voice-select / rate-value / toggle-voice-btn /
// toggle-aria-btn (NOT the sc-prefixed names sketched in SPEC §1.2's rename
// table). We bind to the index.html ids. See the deviation note returned to the
// orchestrator.
// =============================================================================

window.SC = window.SC || {};
SC.Speech = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Module-private state (ported verbatim from Risk speech.js lines 6–16).
  // ---------------------------------------------------------------------------
  var synth = null;          // window.speechSynthesis handle (lazily re-grabbed)
  var voices = [];           // available SpeechSynthesisVoice list, English-first
  var voiceName = null;      // selected voice BY NAME (never by index — indexes
                             // shuffle as voices load asynchronously in Chrome)
  var rate = 2.5;            // speech rate; clamped 0.5–6.0 (ARCHITECTURE §7.6)
  var voiceEnabled = true;   // Web Speech (TTS) output on/off
  var ariaEnabled = true;    // ARIA live-region output on/off
  var lastText = '';         // last spoken text, for repeat()
  var initialized = false;   // guards one-time warm-up wiring in init()
  var supported = true;      // false if the browser lacks Web Speech
  var warmedUp = false;      // Chrome: engine primed by first user gesture yet?
  var pendingSpeak = null;   // timer handle for the cancel()->delay->speak() dance
  var natoMode = 'off';      // 'off' | 'demand' | 'always' — spell() phonetics

  // ---------------------------------------------------------------------------
  // Interrupt COALESCING buffer (NOTE 1 + NOTE 3 fix).
  // ---------------------------------------------------------------------------
  // The Chrome cancel()->delay->speak() dance defers an interrupting utterance by
  // ~50ms (pendingSpeak). The original bug: the NEXT _emit() began by clearing
  // pendingSpeak, DESTROYING the just-scheduled utterance before doSpeak ever
  // fired. Whenever two interrupting calls landed inside that 50ms window — e.g.
  // an AI's "Computer played FOO…" immediately followed (same JS stack) by the
  // human's "Your turn." alert, or the user mashing M — only the LAST survived and
  // the earlier one was silently dropped. That deterministically broke (a) M after
  // a couple of turns and (b) every AI move announcement.
  //
  // Fix: instead of clobbering, we BUFFER same-window interrupts. While a flush
  // timer is pending, a new interrupting _emit appends its text to pendingBuffer
  // (and does NOT clear the timer); when the timer fires we speak the whole buffer
  // as ONE utterance, so nothing is ever lost. (The polite/assertive ARIA region is
  // written per-call BEFORE this TTS coalescing, so SR routing is unaffected; TTS
  // itself has no separate assertive channel.) Preserves cancel->delay->speak verbatim.
  var pendingBuffer = [];    // texts queued for the next flush (joined, spoken once)

  // ---------------------------------------------------------------------------
  // Health-check progress tracking (NOTE 1 "stays stuck" recovery).
  // ---------------------------------------------------------------------------
  // Chrome can wedge with synth.speaking === true while nothing actually plays
  // (and paused === false, so the old resume()-only check never recovered it).
  // We stamp when we last START an utterance and when one last makes progress
  // (onstart/onend); if speaking is reported but no progress has happened for a
  // few seconds, checkHealth() force-cancels to clear the phantom.
  var lastSpeakStart = 0;    // Date.now() when doSpeak last called synth.speak()
  var lastProgress = 0;      // Date.now() of the last onstart/onend we observed

  // ---------------------------------------------------------------------------
  // DOM ID constants — single source so a future markup rename is one-line.
  // These mirror the authoritative ids in index.html.
  // ---------------------------------------------------------------------------
  var LIVE_POLITE = 'sc-live';                 // routine status (aria-live polite)
  var LIVE_ASSERTIVE = 'sc-live-assertive';    // interruptions (aria-live assertive)
  var RATE_DISPLAY = 'rate-value';             // <span> showing the numeric rate
  var VOICE_BTN = 'toggle-voice-btn';          // header TTS toggle button
  var ARIA_BTN = 'toggle-aria-btn';            // header ARIA toggle button
  // Voice <select> elements to keep in sync (Scrabble has just the setup one).
  var VOICE_SELECT_IDS = ['voice-select'];

  // NATO phonetic alphabet for spell(); lowercase keys, used per natoMode.
  // (research/SPEC-housestyle.md §1.3.)
  var NATO = {
    a: 'Alfa', b: 'Bravo', c: 'Charlie', d: 'Delta', e: 'Echo', f: 'Foxtrot',
    g: 'Golf', h: 'Hotel', i: 'India', j: 'Juliett', k: 'Kilo', l: 'Lima',
    m: 'Mike', n: 'November', o: 'Oscar', p: 'Papa', q: 'Quebec', r: 'Romeo',
    s: 'Sierra', t: 'Tango', u: 'Uniform', v: 'Victor', w: 'Whiskey',
    x: 'X-ray', y: 'Yankee', z: 'Zulu'
  };

  // ===========================================================================
  // init() — feature-detect, start loading voices, and wire Chrome hardening.
  // Ported from Risk speech.js lines 19–57. KEEP ALL OF IT (SPEC §1.1).
  // Idempotent: the warm-up wiring is guarded by `initialized`.
  // ===========================================================================
  function init() {
    // Feature-detect Web Speech. If absent, TTS is off but ARIA still works.
    supported = !!(window.speechSynthesis &&
                   typeof SpeechSynthesisUtterance !== 'undefined');
    if (!supported) {
      voiceEnabled = false;
      return false;
    }

    synth = window.speechSynthesis;
    loadVoices();
    // Chrome fires voiceschanged once the (async) voice list is ready.
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;

    // Chrome populates voices lazily and unreliably; retry on a stagger so the
    // dropdown fills in even when the first getVoices() returns empty.
    setTimeout(loadVoices, 100);
    setTimeout(loadVoices, 500);
    setTimeout(loadVoices, 1000);
    setTimeout(loadVoices, 2000);

    // Periodic health check: Chrome silently pauses the engine; resume it.
    setInterval(checkHealth, 3000);

    if (!initialized) {
      // Chrome refuses to speak until a user gesture has "unlocked" audio, and
      // the very first real utterance is often dropped. The fix: on the first
      // click/keydown/touch, cancel any stuck state and speak a silent primer.
      var warmUp = function () {
        if (!warmedUp && synth) {
          warmedUp = true;
          try { synth.cancel(); } catch (e) {}        // clear stuck queue
          if (synth.paused) synth.resume();           // Chrome can wake paused
          // Empty, volume-0 utterance just to prime the engine.
          var primer = new SpeechSynthesisUtterance('');
          primer.volume = 0;
          try { synth.speak(primer); } catch (e) {}
        }
        if (synth && synth.paused) synth.resume();
      };
      document.addEventListener('click', warmUp);
      document.addEventListener('keydown', warmUp);
      document.addEventListener('touchstart', warmUp);
      // Returning to the tab can leave the engine paused; re-prime on show.
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) warmUp();
      });
      initialized = true;
    }
    return true;
  }

  // ===========================================================================
  // loadVoices() — fetch + sort the voice list, English first.
  // Ported from Risk speech.js lines 60–82. KEEP (SPEC §1.1).
  // ===========================================================================
  function loadVoices() {
    if (!synth) return;
    var raw = synth.getVoices();
    if (raw.length === 0) return;                 // not ready yet; a retry will hit

    // Sort priority: en-US/en-GB, then any other English, then local (offline)
    // voices, finally alphabetical by name — so a sensible default sits at [0].
    voices = raw.slice().sort(function (a, b) {
      var aLang = a.lang.toLowerCase(), bLang = b.lang.toLowerCase();
      var aUSUK = aLang === 'en-us' || aLang === 'en-gb';
      var bUSUK = bLang === 'en-us' || bLang === 'en-gb';
      if (aUSUK && !bUSUK) return -1;
      if (!aUSUK && bUSUK) return 1;
      var aEn = aLang.indexOf('en') === 0, bEn = bLang.indexOf('en') === 0;
      if (aEn && !bEn) return -1;
      if (!aEn && bEn) return 1;
      if (a.localService && !b.localService) return -1;
      if (!a.localService && b.localService) return 1;
      return a.name.localeCompare(b.name);
    });

    populateSelectors();
    // Default to the best (first) voice the first time the list arrives.
    if (!voiceName && voices.length > 0) voiceName = voices[0].name;
  }

  // Refill every known voice <select> (DRY helper used by load/restore/setVoice).
  function populateSelectors() {
    for (var i = 0; i < VOICE_SELECT_IDS.length; i++) {
      populateVoiceSelect(VOICE_SELECT_IDS[i]);
    }
  }

  // ===========================================================================
  // populateVoiceSelect(selectId) — fill one <select> with the sorted voices,
  // selecting the current voiceName. Ported from Risk speech.js lines 92–103.
  // ===========================================================================
  function populateVoiceSelect(selectId) {
    var sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '';
    for (var i = 0; i < voices.length; i++) {
      var v = voices[i];
      var opt = document.createElement('option');
      opt.value = v.name;                          // value is the NAME (our key)
      opt.textContent = v.name + ' (' + v.lang + ')';
      if (v.name === voiceName) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // Resolve a voice NAME to its SpeechSynthesisVoice, falling back gracefully.
  // Ported from Risk speech.js lines 106–108.
  function getVoice(name) {
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].name === name) return voices[i];
    }
    return voices[0] || null;
  }

  // ===========================================================================
  // checkHealth() — periodic Chrome rescue: resume a silently-paused engine.
  // Ported from Risk speech.js lines 111–122. KEEP (SPEC §1.1).
  // ===========================================================================
  function checkHealth() {
    if (!synth) return;
    if (synth.paused) {
      try { synth.resume(); } catch (e) {}
    }
    // Chrome's OTHER wedge: speaking===true while nothing actually plays and
    // paused===false (so the resume above does nothing). Detect it via progress
    // timestamps: if the engine claims to be speaking but neither onstart nor
    // onend has fired for a few seconds after our last speak() call, force-cancel
    // to clear the phantom utterance so the next speak() is heard (NOTE 1's
    // "after a few turns it stays broken" symptom). The 3s interval makes a 3s
    // staleness threshold the soonest practical guard without false positives on
    // long real utterances (which keep firing boundary events).
    if (synth.speaking && !synth.paused && lastSpeakStart) {
      var idleMs = Date.now() - Math.max(lastProgress, lastSpeakStart);
      if (idleMs > 5000) {
        try { synth.cancel(); } catch (e) {}
        lastSpeakStart = 0;
      }
    }
  }

  // ===========================================================================
  // doSpeak(text) — build and fire one utterance; the real TTS call.
  // Ported from Risk speech.js lines 125–152. KEEP (SPEC §1.1), incl. the
  // onerror recovery and the resume()-before-and-after-speak() guards.
  // ===========================================================================
  function doSpeak(text) {
    if (!synth) return;

    var utterance = new SpeechSynthesisUtterance(text);
    var voice = getVoice(voiceName);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    // Progress events let checkHealth() distinguish a genuinely-speaking engine
    // from Chrome's "speaking===true but silent" wedge (NOTE 1 recovery).
    utterance.onstart = function () { lastProgress = Date.now(); };
    utterance.onend   = function () { lastProgress = Date.now(); };

    // On a non-trivial error, reload voices and resume — but ignore the benign
    // 'canceled'/'interrupted' errors that our own interrupt model triggers.
    utterance.onerror = function (e) {
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      setTimeout(function () {
        try { synth.cancel(); } catch (err) {}
        loadVoices();
        if (synth.paused) synth.resume();
      }, 100);
    };

    try {
      if (synth.paused) synth.resume();            // Chrome: never speak paused
      synth.speak(utterance);
      lastSpeakStart = Date.now();                 // stamp for the health check
      if (synth.paused) synth.resume();            // and double-check afterwards
    } catch (e) {}
  }

  // ===========================================================================
  // _emit(text, interrupt, assertive) — THE shared core.
  // One private function feeds either live region and the hardened TTS path, so
  // speak() and alert() never fork the Chrome logic (SPEC §1.4). This is Risk
  // speak() (lines 155–191) with the region id parameterised by `assertive`.
  // ===========================================================================
  function _emit(text, interrupt, assertive) {
    if (!text) return;                              // empty -> no-op (test vector)
    if (!voiceEnabled && !ariaEnabled) return;      // both outputs off -> nothing

    lastText = text;

    // --- ARIA live-region branch (screen readers) ---
    if (ariaEnabled) {
      var id = assertive ? LIVE_ASSERTIVE : LIVE_POLITE;
      var region = document.getElementById(id);
      if (region) {
        // Clear-then-set after 50ms so two IDENTICAL consecutive strings still
        // re-fire for the SR (setting the same textContent would be ignored).
        region.textContent = '';
        setTimeout(function () { region.textContent = text; }, 50);
      }
    }

    // --- Web Speech (TTS) branch ---
    if (!voiceEnabled || !supported) return;
    if (!synth && window.speechSynthesis) synth = window.speechSynthesis;
    if (!synth) return;

    if (interrupt) {
      // COALESCING (NOTE 1 + NOTE 3): if a flush timer is already pending, a SECOND
      // interrupting call landed inside the ~50ms Chrome window. Previously we
      // clearTimeout'd it, silently dropping the FIRST utterance (the AI play
      // summary, an M readout, etc.). Instead we APPEND to the buffer and let the
      // single in-flight timer speak everything joined as one utterance — nothing
      // is lost, and the cancel->delay->speak hardening is untouched.
      if (pendingSpeak) {
        pendingBuffer.push(text);
        return;
      }
      // First interrupting call: seed the buffer, cancel, and schedule the flush.
      // CRITICAL CHROME FIX: cancel() then speak() immediately = silence. We must
      // cancel, wait ~50ms, THEN speak. This is the keystone bug fix.
      pendingBuffer = [text];
      try { synth.cancel(); } catch (e) {}
      pendingSpeak = setTimeout(flushPending, 50);
    } else {
      // Non-interrupting: append to the engine's queue (composite sequences). If a
      // coalesced interrupt flush is still pending, ride along with it so ordering
      // is preserved (a synchronous doSpeak here would jump AHEAD of the buffered
      // interrupt, which the engine queues only ~50ms later).
      if (pendingSpeak) { pendingBuffer.push(text); return; }
      doSpeak(text);
    }
  }

  // flushPending — speak the coalesced interrupt buffer as ONE utterance. Joining
  // with a space (and collapsing any doubled terminal punctuation) keeps the
  // combined line natural, e.g. "Computer played foo for 9 points. Your turn."
  // lastText is set to the ACTUALLY-spoken joined string so repeat() (R) reproduces
  // exactly what was voiced, not whichever fragment happened to be last assigned.
  function flushPending() {
    pendingSpeak = null;
    var joined = pendingBuffer.join(' ').replace(/([.!?])\s+([.!?])/g, '$2');
    pendingBuffer = [];
    if (!joined) return;
    lastText = joined;
    doSpeak(joined);
  }

  // ---------------------------------------------------------------------------
  // Public output entry points (ARCHITECTURE §3 / §7.6).
  // ---------------------------------------------------------------------------

  // cancel() — STOP any in-flight / queued speech and clear the polite live region.
  // This is what the top-level Escape ("Stop speech", INTERFACE_DESIGN §5.7) needs:
  // _emit's empty-string guard (`if (!text) return;`) returns BEFORE synth.cancel(),
  // so speak('') alone could never silence TTS. We provide a real stop primitive and
  // route the empty-string idiom through it (see speak), so Escape works unchanged.
  function cancel() {
    if (pendingSpeak) { clearTimeout(pendingSpeak); pendingSpeak = null; }
    // Discard any coalesced-but-not-yet-spoken interrupt text so a later flush
    // can't resurrect it after the user explicitly stopped speech (Escape).
    pendingBuffer = [];
    if (!synth && typeof window !== 'undefined' && window.speechSynthesis) synth = window.speechSynthesis;
    if (synth) { try { synth.cancel(); } catch (e) {} }
    // Clear the polite region too so the SR doesn't re-announce a stale line.
    if (typeof document !== 'undefined') {
      var pol = document.getElementById(LIVE_POLITE);
      if (pol) pol.textContent = '';
    }
  }

  // speak(text, interrupt=true): routine status -> polite #sc-live + TTS.
  // An empty/blank string means "stop speech" (the Escape idiom): route it to
  // cancel() instead of the no-op _emit path so an in-progress utterance is halted.
  function speak(text, interrupt) {
    if (!text) { cancel(); return; }
    _emit(text, interrupt !== false, false);        // default interrupt = true
  }

  // alert(text): interruptions (illegal move, your turn, game over) ->
  // assertive #sc-live-assertive + TTS. Always interrupts (SPEC §1.4).
  function alert(text) {
    _emit(text, true, true);
  }

  // repeat(): re-announce the last thing said (the R key).
  function repeat() {
    if (lastText) speak(lastText);
  }

  // ===========================================================================
  // spell(text, forceNato) — announce letter-by-letter for unambiguous reading
  // of words/racks. NATO phonetics are used when natoMode==='always', or when
  // natoMode==='demand' and the caller passes forceNato (SPEC §1.3).
  // Joining with ", " yields natural inter-letter pauses in both TTS and ARIA.
  // ===========================================================================
  function spell(text, forceNato) {
    if (!text) return;
    var useNato = (natoMode === 'always') ||
                  (natoMode === 'demand' && !!forceNato);
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var raw = text.charAt(i);
      var ch = raw.toLowerCase();
      if (ch === ' ') { out.push('space'); continue; }   // verbalise spaces
      // NATO word when enabled and the char is a–z; otherwise the bare letter.
      out.push(useNato && NATO[ch] ? NATO[ch] : raw.toUpperCase());
    }
    speak(out.join(', '));
  }

  // setNatoMode(m) — 'off' | 'demand' | 'always'. Persisted by SC.UI settings.
  function setNatoMode(m) {
    if (m === 'off' || m === 'demand' || m === 'always') natoMode = m;
  }

  // ===========================================================================
  // setVoice(name) — choose the TTS voice by name and sync the dropdown(s).
  // Ported from Risk speech.js lines 197–205.
  // ===========================================================================
  function setVoice(name) {
    if (!name) return;
    // Only accept a name actually present in the loaded list.
    var found = false;
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].name === name) { found = true; break; }
    }
    if (!found) return;
    voiceName = name;
    for (var j = 0; j < VOICE_SELECT_IDS.length; j++) {
      var sel = document.getElementById(VOICE_SELECT_IDS[j]);
      if (sel) sel.value = name;
    }
  }

  // ===========================================================================
  // setRate(r) / getRate() — clamp 0.5–6.0 (ARCHITECTURE §7.6; default 2.5) and
  // reflect the value into the on-screen rate display.
  // ===========================================================================
  function setRate(r) {
    rate = Math.max(0.5, Math.min(6.0, r));
    var display = document.getElementById(RATE_DISPLAY);
    if (display) display.textContent = rate.toFixed(1);
  }
  function getRate() { return rate; }

  // ===========================================================================
  // toggleVoice() / toggleAria() — flip each output channel and update its
  // header button. Ported from Risk speech.js lines 221–236.
  // ===========================================================================
  function toggleVoice() {
    if (!supported) return false;                  // can't enable absent TTS
    voiceEnabled = !voiceEnabled;
    updateVoiceButton();
    if (voiceEnabled) speak('Voice enabled');
    return voiceEnabled;
  }

  function toggleAria() {
    ariaEnabled = !ariaEnabled;
    updateAriaButton();
    // Confirmation is only audible when TTS is also on.
    if (ariaEnabled && voiceEnabled) speak('Screen reader announcements enabled');
    return ariaEnabled;
  }

  // Reflect voiceEnabled into #toggle-voice-btn (label + aria-pressed).
  function updateVoiceButton() {
    var btn = document.getElementById(VOICE_BTN);
    if (!btn) return;
    btn.textContent = voiceEnabled ? 'Voice: On' : 'Voice: Off';
    btn.setAttribute('aria-pressed', voiceEnabled.toString());
  }

  // Reflect ariaEnabled into #toggle-aria-btn (label + aria-pressed).
  function updateAriaButton() {
    var btn = document.getElementById(ARIA_BTN);
    if (!btn) return;
    btn.textContent = ariaEnabled ? 'ARIA: On' : 'ARIA: Off';
    btn.setAttribute('aria-pressed', ariaEnabled.toString());
  }

  // ---------------------------------------------------------------------------
  // Simple getters (ARCHITECTURE §3).
  // ---------------------------------------------------------------------------
  function isVoiceEnabled() { return voiceEnabled; }
  function isAriaEnabled() { return ariaEnabled; }
  function isSupported() { return supported; }
  function getVoiceName() { return voiceName; }

  // ===========================================================================
  // getSettings() / restoreSettings(s) — serialise the five persisted fields
  // (SPEC §1.3). SC.UI saves these to localStorage on every change.
  // ===========================================================================
  function getSettings() {
    return {
      voiceName: voiceName,
      rate: rate,
      voiceEnabled: voiceEnabled,
      ariaEnabled: ariaEnabled,
      natoMode: natoMode
    };
  }

  function restoreSettings(s) {
    if (!s) return;
    if (s.voiceName) { voiceName = s.voiceName; populateSelectors(); }
    if (s.rate) setRate(s.rate);                          // re-clamps + displays
    if (s.voiceEnabled !== undefined) voiceEnabled = s.voiceEnabled;
    if (s.ariaEnabled !== undefined) ariaEnabled = s.ariaEnabled;
    if (s.natoMode) setNatoMode(s.natoMode);
    updateVoiceButton();
    updateAriaButton();
  }

  // ---------------------------------------------------------------------------
  // Public API — EXACTLY the SC.Speech surface required by ARCHITECTURE §3/§7.6.
  // ---------------------------------------------------------------------------
  return {
    init: init,
    speak: speak,
    cancel: cancel,
    alert: alert,
    repeat: repeat,
    spell: spell,
    setNatoMode: setNatoMode,
    setVoice: setVoice,
    setRate: setRate,
    getRate: getRate,
    toggleVoice: toggleVoice,
    toggleAria: toggleAria,
    isVoiceEnabled: isVoiceEnabled,
    isAriaEnabled: isAriaEnabled,
    isSupported: isSupported,
    getVoiceName: getVoiceName,
    populateVoiceSelect: populateVoiceSelect,
    getSettings: getSettings,
    restoreSettings: restoreSettings
  };
})();
