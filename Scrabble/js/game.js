// =============================================================================
// js/game.js  —  SC.Game
// -----------------------------------------------------------------------------
// The CONTROLLER for Accessible Scrabble. It glues every other module together:
//   * boots Speech + Sounds, loads the dictionary, restores settings, wires the
//     setup screen, and attaches the single global keydown handler (init);
//   * owns turn flow — commit a play, pass, exchange, run the AI, advance the
//     turn, detect the end of game, and do final scoring (rack penalties + the
//     "went out" bonus per SCRABBLE_RULES §12);
//   * is the keyboard DISPATCHER (handleKey): it decides, by MODE, whether a key
//     belongs to an overlay/composer/exchange or to the board/UI navigation
//     keymap, and routes it through the documented §3 APIs of SC.Board / SC.UI.
//
// Contract sources (authoritative):
//   ARCHITECTURE.md §2 (data shapes), §3 (every module's public API), §7
//     (refinements: §7.2 single-tile dir, §7.5 AI exchange/pass + the controller
//      owning the six-scoreless-turn rule and the AI override).
//   INTERFACE_DESIGN.md §5 (the full reconciled keymap incl. tile-by-tile §5.3a).
//   research/SPEC-housestyle.md §3 (mode-gated dispatch, Ctrl/Cmd/Alt pass-through,
//     per-branch preventDefault discipline, e.key.toLowerCase() for letters +
//     e.code Digit1-7 for Shift+digit) and §5 (init order).
//   SCRABBLE_RULES.md §5/§8/§9/§11/§12 (turn actions, exchange, pass, end, scoring).
//
// Hard constraints (ARCHITECTURE §0): plain ES5-ish var/IIFE, no ES modules, no
// import/export, no fetch, no top-level async — the game runs from file:// with no
// server. Everything hangs off window.SC, and OTHER SC.* modules are referenced
// only INSIDE functions (never at load time) so script load order is not fragile.
// =============================================================================

window.SC = window.SC || {};
SC.Game = (function () {
  'use strict';

  // ===========================================================================
  // Module-private state
  // ===========================================================================

  // localStorage key for the autosaved game. Settings persistence is delegated to
  // SC.UI (integration fix #10): SC.UI owns the SINGLE settings store under
  // 'scrabble-settings' (one key + one shape). SC.Game never writes its own
  // settings blob anymore; it round-trips settings through SC.UI.saveSettings /
  // SC.UI.restoreSettings so there is no split/stale state across reloads.
  var SAVE_KEY = 'scrabbleSave';

  // Controller-level flags/config, seeded from the setup form and persisted as
  // part of G.config (so a resumed game keeps them). Defaults match
  // INTERFACE_DESIGN §7.3/§7.4 (confirms on; auto-read opponent on; hints off).
  var aiMoveDelayMs = 2000;     // default delay before the AI "thinks" then plays
                                // (§7.4; NOTE 3 raised 1200->2000 so each computer's
                                // spoken announcement is fully audible before the next
                                // player acts). User-adjustable via the Settings slider.
  var autosaveTimer = null;     // setInterval handle for autosave (gated by setting)
  var gameClockTimer = null;    // setInterval handle for the mm:ss game clock (#timer)
  var aiTimer = null;           // setTimeout handle for the pending AI "think" delay,
                                // so a new game / game end can cancel an in-flight AI
                                // decision (the phase guard in runAiDecision is kept as
                                // defence in depth — reviewer-flagged cleanup gap).

  // Pass confirmation latch: P asks once, a second P within the window confirms
  // (INTERFACE_DESIGN §6.5). Cleared by any other key or by acting.
  var passArmed = false;

  // Guards re-entrancy of the AI loop (so a stray key can't double-trigger it).
  var aiRunning = false;

  // One-shot flag (NOTE 3): set by announcePlay when a COMPUTER's play summary
  // already had the human's turn hand-off (" Your turn.") folded onto it, so the
  // immediately-following beginTurn(human) must NOT fire its OWN assertive "your
  // turn" alert (which would interrupt/clobber the AI line). beginTurn still plays
  // the yourTurn sound, focuses the board, and updates the indicator; it just
  // skips the redundant speech for that one transition, then clears the flag.
  var skipNextBeginTurnAlert = false;

  // ---------------------------------------------------------------------------
  // Tiny lazy accessors for the modules we orchestrate. Grabbing them through a
  // function (never at load time) keeps script order irrelevant (ARCHITECTURE §0)
  // and lets the Node syntax-check pass without the sibling files present.
  // ---------------------------------------------------------------------------
  function State()  { return SC.State; }
  function Data()   { return SC.Data; }
  function Rules()  { return SC.Rules; }
  function Dict()   { return SC.Dict; }
  function AI()     { return SC.AI; }
  function Speech() { return SC.Speech; }
  function Sounds() { return SC.Sounds; }
  function Board()  { return SC.Board; }
  function UI()     { return SC.UI; }

  // Convenience: the live game-state object (ARCHITECTURE §2 SC.State.G).
  function G() { return SC.State.G; }

  // Small DOM helper (kept local; we only touch a handful of setup-screen ids).
  function $(id) { return document.getElementById(id); }

  // ===========================================================================
  // Settings persistence (single store, owned by SC.UI; integration fix #10)
  // ---------------------------------------------------------------------------
  // SC.UI is the sole owner of the 'scrabble-settings' blob (speech + sounds + UI
  // flags on G.config, AI delay stored in ms). SC.Game just delegates: whenever a
  // setting changes here (rate +/-, toggles, game start) we ask SC.UI to persist
  // the whole blob; on boot we ask SC.UI to restore it. This guarantees ONE key +
  // ONE shape and no stale/competing state across reloads.
  // ===========================================================================

  function saveSettings() {
    if (UI() && UI().saveSettings) UI().saveSettings();
  }

  // ---------------------------------------------------------------------------
  // Autosave / resume (gated by config.autosave; SPEC-housestyle §4.5).
  // ---------------------------------------------------------------------------

  function hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }

  function saveGame() {
    if (!G().config || !G().config.autosave) return;     // setting must be on
    if (G().phase !== 'playing') return;                 // only mid-game
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(State().serialize())); }
    catch (e) {}
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  // Start/stop the periodic autosave loop (Risk uses a 10s interval; mirror it).
  function startAutosave() {
    stopAutosave();
    if (G().config && G().config.autosave) autosaveTimer = setInterval(saveGame, 10000);
  }
  function stopAutosave() {
    if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; }
  }

  // ---------------------------------------------------------------------------
  // Game clock (integration fix #9). #timer is aria-live="off" (visual only — the
  // value is not spoken on every tick), so we just paint mm:ss elapsed once a
  // second from G.startTime. Started in startGame/resumeGame, stopped in endGame.
  // ---------------------------------------------------------------------------

  // Format a millisecond duration as m:ss (e.g. 65000 -> "1:05"). Hours roll into
  // minutes (a Scrabble game won't run that long, but it stays correct if it does).
  function formatClock(ms) {
    var totalSec = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  // Paint the current elapsed time into #timer (no-op if the element is absent).
  function renderClock() {
    var el = $('timer');
    if (!el) return;
    var start = G().startTime || Date.now();
    el.textContent = formatClock(Date.now() - start);
  }

  // Start the 1-second clock loop. Idempotent (clears any prior interval first).
  function startClock() {
    stopClock();
    if (!G().startTime) G().startTime = Date.now();   // belt-and-suspenders
    renderClock();                                    // paint immediately, not after 1s
    gameClockTimer = setInterval(renderClock, 1000);
  }

  // Stop the clock loop and leave the final elapsed time on screen.
  function stopClock() {
    if (gameClockTimer) { clearInterval(gameClockTimer); gameClockTimer = null; }
  }

  // ===========================================================================
  // init() — boot sequence (SPEC-housestyle §5; ARCHITECTURE §3 SC.Game.init)
  // ===========================================================================
  function init() {
    // 1) Audio + voice engines first (idempotent, feature-detected). They must be
    //    ready before any speak()/play() and before we populate the voice select.
    if (Speech()) Speech().init();
    if (Sounds()) Sounds().init();

    // 2) Restore persisted settings via SC.UI's single store (integration fix
    //    #10): this restores Speech, Sounds, AND the UI flags on G.config from the
    //    one 'scrabble-settings' blob. Then reflect them onto the setup form so the
    //    UI shows the user's saved preferences. (applySettingsToSetupForm reads
    //    live Speech/Sounds for rate/sound/spatial and G.config for the rest.)
    if (UI() && UI().restoreSettings) UI().restoreSettings();
    applySettingsToSetupForm(G().config);

    // If Web Speech is unavailable, surface the standing notice in the markup.
    if (Speech() && !Speech().isSupported()) {
      var warn = $('speech-warning');
      if (warn) warn.classList.remove('hidden');
    }

    // 3) Show "Loading dictionary…" THEN build it inside setTimeout(…,0) so the
    //    message paints before the (heavy) synchronous build blocks the thread
    //    (ARCHITECTURE §3 SC.Dict). We also disable Start until it is ready.
    var loading = $('loading-status');
    if (loading) loading.textContent = 'Loading dictionary…';
    var startBtn = $('start-btn');
    var resumeBtn = $('resume-btn');
    if (startBtn) startBtn.disabled = true;
    if (resumeBtn) resumeBtn.disabled = true;
    setTimeout(function () {
      Dict().init();                                   // synchronous DAWG + Set build
      if (loading) {
        var meta = Dict().meta;
        var n = Dict().size();
        loading.textContent = 'Dictionary loaded: ' + n.toLocaleString() +
          ' words' + (meta && meta.name ? ' (' + meta.name + ')' : '') + '.';
      }
      if (startBtn) startBtn.disabled = false;
      // Only offer Resume once the dictionary (needed to validate/replay) is ready.
      if (resumeBtn && hasSave()) { resumeBtn.disabled = false; resumeBtn.classList.remove('hidden'); }
    }, 0);

    // 4) Wire the setup-screen controls (Start / Resume / Help + live widgets).
    wireSetupScreen();

    // 5) Attach the SINGLE global keydown handler ONCE (not per-screen), exactly
    //    like Risk/2048. handleKey itself mode-gates and no-ops off the game screen.
    document.addEventListener('keydown', handleKey);

    // 6) Voice <select> is filled by SC.Speech as voices arrive; nudge it now too.
    if (Speech()) Speech().populateVoiceSelect('voice-select');
  }

  // ---------------------------------------------------------------------------
  // applySettingsToSetupForm — reflect persisted game-config + speech values onto
  // the setup form inputs so reloads remember the user's choices. Defensive: every
  // element is optional (index.html is the source of truth, but we never assume).
  // ---------------------------------------------------------------------------
  function applySettingsToSetupForm(gameCfg) {
    // Speech rate slider mirrors the (already-restored) Speech rate.
    if (Speech()) {
      var rateInput = $('speech-rate');
      if (rateInput) rateInput.value = String(Speech().getRate());
      var rateVal = $('rate-value');
      if (rateVal) rateVal.textContent = Speech().getRate().toFixed(1);
    }
    if (Sounds()) {
      var sx = $('sound-effects');
      if (sx) sx.checked = Sounds().isEnabled();
      var sp = $('spatial-audio');
      // getSettings() exposes spatial; default checked stays if unknown.
      if (sp && Sounds().getSettings) sp.checked = !!Sounds().getSettings().spatial;
    }
    if (!gameCfg) return;
    var setSel = function (id, val) { var el = $(id); if (el != null && val != null) el.value = String(val); };
    var setChk = function (id, val) { var el = $(id); if (el != null && val != null) el.checked = !!val; };
    var nameEl = $('player-name'); if (nameEl && gameCfg.playerName) nameEl.value = gameCfg.playerName;
    setSel('num-opponents', gameCfg.opponents);
    setSel('ai-difficulty', gameCfg.difficulty);
    setSel('game-mode', gameCfg.gameMode);
    setChk('hint-enabled', gameCfg.hintEnabled);   // canonical flag (fix #5)
  }

  // ---------------------------------------------------------------------------
  // wireSetupScreen — bind the three setup buttons plus the live speech/sound
  // widgets. The widgets persist to localStorage on EVERY change (INTERFACE_DESIGN
  // §7 / SPEC-housestyle §4.5) by routing through the owning module + saveSettings.
  // ---------------------------------------------------------------------------
  function wireSetupScreen() {
    var startBtn = $('start-btn');
    if (startBtn) startBtn.addEventListener('click', function () {
      startGame(readSetupConfig());
    });

    var resumeBtn = $('resume-btn');
    if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);

    // Both Help buttons (setup + in-game) open the help overlay.
    var helpBtn = $('help-btn');
    if (helpBtn) helpBtn.addEventListener('click', function () { if (UI()) UI().showHelp(); });
    var helpBtnGame = $('help-btn-game');
    if (helpBtnGame) helpBtnGame.addEventListener('click', function () { if (UI()) UI().showHelp(); });

    // In-game header toggle buttons mirror the Shift+V/A/S hotkeys. Speech/Sounds
    // also self-bind their own buttons, but binding the SETTINGS persistence here
    // keeps localStorage current on click as well as on hotkey.
    bindToggle('toggle-voice-btn', function () { if (Speech()) Speech().toggleVoice(); });
    bindToggle('toggle-aria-btn',  function () { if (Speech()) Speech().toggleAria(); });
    bindToggle('toggle-sound-btn', function () { if (Sounds()) Sounds().toggle(); });
    var settingsBtn = $('settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', function () { if (UI()) UI().openSettings(); });

    // Speech rate slider: clamp via Speech, reflect the number, persist.
    var rateInput = $('speech-rate');
    if (rateInput) rateInput.addEventListener('input', function () {
      if (Speech()) Speech().setRate(parseFloat(rateInput.value));
      saveSettings();
    });

    // Voice select: choose by name (Speech keeps dropdowns in sync), persist.
    var voiceSel = $('voice-select');
    if (voiceSel) voiceSel.addEventListener('change', function () {
      if (Speech()) Speech().setVoice(voiceSel.value);
      saveSettings();
    });

    // Sound effects + spatial checkboxes: drive Sounds, persist.
    var sx = $('sound-effects');
    if (sx) sx.addEventListener('change', function () {
      if (Sounds()) Sounds().setEnabled(sx.checked);
      saveSettings();
    });
    var sp = $('spatial-audio');
    if (sp) sp.addEventListener('change', function () {
      if (Sounds()) Sounds().setSpatial(sp.checked);
      saveSettings();
    });
    // Player name: persist to the shared settings blob on every change so it is
    // restored on the next visit (like the speech settings).
    var nameInput = $('player-name');
    if (nameInput) nameInput.addEventListener('input', function () {
      G().config.playerName = nameInput.value;
      saveSettings();
    });

    // Hint checkbox is read at game start (it gates the F key); nothing live to do.
  }

  // bindToggle — attach a click handler that runs `fn` then persists settings
  // (the toggle's owning module updates its own button label/aria-pressed).
  function bindToggle(id, fn) {
    var el = $(id);
    if (el) el.addEventListener('click', function () { fn(); saveSettings(); });
  }

  // readSetupConfig — snapshot the setup form into a config object for newGame.
  // Builds the explicit player roster so SC.State.newGame is fully deterministic.
  function readSetupConfig() {
    var name = (($('player-name') && $('player-name').value) || 'You').trim() || 'You';
    var opponents = parseInt(($('num-opponents') && $('num-opponents').value) || '1', 10);
    var difficulty = ($('ai-difficulty') && $('ai-difficulty').value) || 'medium';
    var gameMode = ($('game-mode') && $('game-mode').value) || 'vsComputer';
    // Map the setup "hint" checkbox to the canonical config.hintEnabled flag
    // (integration fix #5) so it agrees with Settings + the F-gate + findHint.
    var hintEnabled = !!($('hint-enabled') && $('hint-enabled').checked);

    // Pass-and-Play (hotseat) means multiple HUMAN players; everything else means
    // one human plus `opponents` computers (SCRABBLE_RULES / INTERFACE_DESIGN §3.1).
    var players;
    if (gameMode === 'passAndPlay') {
      var humans = Math.max(2, opponents + 1);   // opponents here = extra humans
      players = [];
      for (var h = 0; h < humans; h++) {
        players.push({ name: h === 0 ? name : ('Player ' + (h + 1)), isComputer: false });
      }
    } else if (gameMode === 'solo') {
      players = [{ name: name, isComputer: false }];   // solo high-score: just you
    } else {
      players = [{ name: name, isComputer: false }];
      for (var c = 0; c < opponents; c++) {
        players.push({
          name: opponents > 1 ? ('Computer ' + (c + 1)) : 'Computer',
          isComputer: true,
          difficulty: difficulty
        });
      }
    }

    return {
      players: players,
      // Echoed scalars (also used to repopulate the setup form on next load).
      playerName: name, opponents: opponents, difficulty: difficulty,
      gameMode: gameMode, hintEnabled: hintEnabled,
      // Defaults for the persisted gameplay/announcement settings the SETTINGS
      // overlay (SC.UI) later edits in place (INTERFACE_DESIGN §7.3/§7.4).
      verbosity: 'normal',
      autoReadOpponent: true,
      autoReadBoard: false,
      // Audio score counter must be seeded here too, or G.config.audioScoreCounter
      // is undefined after newGame and postCommitEffects never plays the count-up —
      // even though the Settings checkbox renders CHECKED from DEFAULT_UI (true).
      audioScoreCounter: true,
      // Canonical keys (integration fix #4): announcePremium (singular) +
      // announceCoords — these are exactly what board.js reads and SC.UI Settings
      // writes, so there is ONE spelling per setting across all three files.
      announcePremium: true,
      announceCoords: true,
      // Canonical confirm flag (integration fix): ONE key — confirmActions —
      // shared by pass()/newGame() and the Settings checkbox (which writes/persists
      // it). We seed it from the value SC.UI.restoreSettings already put on
      // G.config (the user's saved preference) so the choice survives starting a
      // new game; absent any save it defaults true. (Previously this hardcoded the
      // unused confirmPass/confirmExchange/confirmNewGame keys, so the Settings
      // toggle had no effect and never round-tripped.)
      confirmActions: (G().config && G().config.confirmActions !== undefined)
        ? G().config.confirmActions : true,
      // NOTE 5: seed advanceCursorOnPlace from the user's saved preference (like
      // confirmActions) so the Settings checkbox round-trips across a new game;
      // absent any save it defaults true (the original auto-advance behaviour).
      advanceCursorOnPlace: (G().config && G().config.advanceCursorOnPlace !== undefined)
        ? G().config.advanceCursorOnPlace : true,
      autosave: true,
      aiMoveDelayMs: aiMoveDelayMs
    };
  }

  // ===========================================================================
  // startGame / newGame / resumeGame
  // ===========================================================================

  // startGame(config) — build a fresh game from a config (ARCHITECTURE §3).
  function startGame(config) {
    // Guard: the dictionary must be ready (validation/AI need it).
    if (!Dict() || !Dict().ready) {
      var loading = $('loading-status');
      if (loading) loading.textContent = 'Still loading the dictionary — one moment…';
      return;
    }
    State().newGame(config);                    // build players/bag/racks, phase='playing'
    if (config) aiMoveDelayMs = (config.aiMoveDelayMs != null) ? config.aiMoveDelayMs : aiMoveDelayMs;
    saveSettings();                             // persist the chosen gameplay settings
    enterGameScreen();
    beginTurn();                                // announce + (if AI is first) run AI
  }

  // newGame() — the N hotkey / Game-Over "New Game". Confirms first when set,
  // then returns to the setup screen so the player can re-choose options.
  function newGame() {
    // Canonical confirm flag is config.confirmActions (the single key the Settings
    // dialog writes/persists; integration fix). Default-on: a missing flag still
    // confirms, matching the prior behaviour. Previously read config.confirmNewGame,
    // which the Settings UI never set, so the toggle had no effect here.
    // The latch is action-specific: pass() checks `passArmed !== 'pass'`, so this
    // must check its OWN value `!== 'newgame'`. Using `!passArmed` here let a stale
    // 'pass' latch (P pressed, then N) count as a new-game confirmation, silently
    // wiping the in-progress game with no prompt. Only a prior N confirms now.
    if (G().phase === 'playing' && G().config && G().config.confirmActions !== false && passArmed !== 'newgame') {
      // Reuse the simple "press again" idiom for the destructive confirm.
      Speech().alert('Start a new game? Press N again to confirm, Escape to cancel.');
      passArmed = 'newgame';                    // distinct latch value (see handleKey)
      return;
    }
    passArmed = false;
    stopAutosave();
    stopClock();                                // halt the clock on return to setup
    stopAITimer();                              // cancel any pending AI decision (cleanup)
    clearSave();
    State().reset();
    showSetupScreen();
    if (Speech()) Speech().speak('New game. Choose your options and press Start.');
  }

  // resumeGame() — restore the autosaved game and jump straight into play.
  function resumeGame() {
    if (!hasSave()) return;
    var blob;
    try { blob = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { blob = null; }
    if (!blob) return;
    State().restore(blob);
    if (G().config && G().config.aiMoveDelayMs != null) aiMoveDelayMs = G().config.aiMoveDelayMs;
    enterGameScreen();
    if (Speech()) Speech().speak('Resumed your saved game.');
    beginTurn();
  }

  // ---------------------------------------------------------------------------
  // Screen transitions (toggle the .hidden class per index.html's convention).
  // ---------------------------------------------------------------------------
  function enterGameScreen() {
    skipNextBeginTurnAlert = false;             // never inherit a stale hand-off latch
    stopAITimer();                              // cancel any AI timer from a prior game
    var setup = $('setup-screen'); if (setup) setup.classList.add('hidden');
    var game = $('game-screen'); if (game) game.classList.remove('hidden');
    // Build the board + rack + status, then focus the board so keys reach handleKey.
    if (Board()) Board().render();
    if (UI()) { UI().init(); UI().renderRack(); UI().updateInfoPanel(); }
    if (Board()) Board().jumpToCenter();        // sensible starting cursor (H8)
    var board = $('board'); if (board) board.focus();
    startAutosave();
    startClock();                               // begin the mm:ss game clock (#timer)
  }

  function showSetupScreen() {
    var game = $('game-screen'); if (game) game.classList.add('hidden');
    var setup = $('setup-screen'); if (setup) setup.classList.remove('hidden');
    var resumeBtn = $('resume-btn');
    if (resumeBtn) { if (hasSave()) resumeBtn.classList.remove('hidden'); else resumeBtn.classList.add('hidden'); }
    var name = $('player-name'); if (name) name.focus();
  }

  // ===========================================================================
  // Turn lifecycle: beginTurn -> (human input | aiTurn) -> commit/pass/exchange
  //                 -> endTurn -> nextPlayer -> beginTurn (or endGame)
  // ===========================================================================

  // isFirstMove — true while the board has no committed tiles (ARCHITECTURE §7,
  // SPEC-movegen §7). Computed from the board so it is correct after a resume too.
  function isFirstMove() {
    var b = G().board, size = Data().BOARD_SIZE;
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) if (b[r][c]) return false;
    }
    return true;
  }

  // beginTurn — announce whose turn it is, refresh the info panel/turn indicator,
  // then either wait for a human or kick off the AI after the move delay.
  function beginTurn() {
    passArmed = false;                          // any new turn clears the pass latch
    var p = State().currentPlayer();
    updateTurnIndicator(p);
    if (UI()) UI().updateInfoPanel();

    if (p.isComputer) {
      if (Sounds()) Sounds().play('oppThinking');
      aiTurn();                                 // schedules its own delay internally
    } else {
      if (Sounds()) Sounds().play('yourTurn');
      // NOTE 3: if a computer's just-spoken play summary already carried the hand-off
      // ("Now your turn."), DON'T fire a second assertive alert here — it would
      // interrupt/clobber that summary. We still play the sound (above), focus the
      // board (below), and updated the indicator (above); we just skip the redundant
      // speech for this one transition and consume the one-shot flag. Every other
      // human turn (game start, after a human's own play, pass-and-play handoffs)
      // still gets the assertive "your turn" briefing.
      if (skipNextBeginTurnAlert) {
        skipNextBeginTurnAlert = false;
      } else {
        // "Your turn" must barge in (assertive) per INTERFACE_DESIGN §9.
        if (Speech()) Speech().alert(turnPhrase(p) + '. ' + rackBriefing());
      }
      if (Board()) { var board = $('board'); if (board) board.focus(); }
    }
  }

  // turnPhrase / turnIndicator helpers (kept DRY).
  function turnPhrase(p) {
    return p.isHuman ? (isSinglePlayerHuman() ? 'Your turn' : (p.name + "'s turn")) : (p.name + ' is thinking');
  }
  function isSinglePlayerHuman() {
    // Exactly one human in the roster -> address them as "you".
    var n = 0; for (var i = 0; i < G().players.length; i++) if (G().players[i].isHuman) n++;
    return n === 1;
  }
  // peekNextPlayer — the player who WILL be current after nextPlayer() advances the
  // pointer (same wrap arithmetic), WITHOUT mutating turn state. Used by NOTE 3 so
  // announcePlay can decide whether to fold the human turn hand-off onto an AI's
  // committed-play summary (only when the next player is the human).
  function peekNextPlayer() {
    var players = G().players;
    var next = (G().currentPlayer + 1) % players.length;
    return players[next];
  }
  // handoffPhraseFor(p) — the short "now your turn" hand-off appended to a computer's
  // play summary when the NEXT player is human (NOTE 3). Person-aware to match
  // turnPhrase(): "Now your turn." for a lone human, "Now <name>'s turn." otherwise.
  function handoffPhraseFor(p) {
    return isSinglePlayerHuman() ? 'Now your turn.' : ('Now ' + p.name + "'s turn.");
  }
  function updateTurnIndicator(p) {
    var ind = $('turn-indicator');
    if (ind) ind.textContent = p.isComputer ? (p.name + ' thinking…') : (turnPhrase(p));
    var tn = $('turn-number');
    if (tn) tn.textContent = 'Turn ' + G().turnNumber;
  }
  // A terse rack reminder spoken at the start of a human turn (the I key gives full).
  // Person-aware so it matches turnPhrase(): "You hold…" only when there is exactly
  // one human (solo); with multiple humans (pass-and-play) it reads in the third
  // person ("Pat holds…") so it doesn't clash with "Pat's turn".
  function rackBriefing() {
    var p = State().currentPlayer();
    var rack = p.rack;
    if (isSinglePlayerHuman()) {
      if (!rack.length) return 'Your rack is empty.';
      return 'You hold ' + rack.length + ' tile' + (rack.length === 1 ? '' : 's') + '.';
    }
    if (!rack.length) return p.name + "'s rack is empty.";
    return p.name + ' holds ' + rack.length + ' tile' + (rack.length === 1 ? '' : 's') + '.';
  }

  // ===========================================================================
  // commitPlay(move) — apply a validated Move to the board and finish the turn.
  // ---------------------------------------------------------------------------
  // Used by BOTH the human path (after Score Preview confirms) and the AI path.
  // Pre-condition: `move` is valid (the Composer/Preview blocks invalid commits,
  // and AI moves come pre-validated by SC.Rules.evaluatePlay). We re-check defensively.
  // ===========================================================================
  function commitPlay(move) {
    if (!move || !move.valid) {                 // defensive guard (should not happen)
      if (Speech()) Speech().alert('That play is not legal and cannot be committed.');
      if (Sounds()) Sounds().play('invalid');
      return false;
    }
    var player = State().currentPlayer();
    var placements = move.placements || [];

    // 1) Lay the new tiles onto the committed board and remove them from the rack.
    for (var i = 0; i < placements.length; i++) {
      var pl = placements[i];
      G().board[pl.row][pl.col] = pl.tile;      // tile already has its (blank) letter
      removeTileFromRack(player, pl.tile);
    }
    // The pending overlay has now become real; clear it without recalling tiles.
    State().getPending().length = 0;

    // 2) Score: credit the player, update bookkeeping.
    player.score += move.score;
    G().consecutiveScorelessTurns = 0;          // a scoring play resets the stalemate count
    G().lastMove = move;
    G().moveLog.unshift({ playerName: player.name, move: move, turn: G().turnNumber });

    // 3) Audio: commit stamp (richer for big scores), bingo fanfare, count-up.
    if (Sounds()) {
      Sounds().play('commit', { score: move.score });
      if (move.isBingo) Sounds().play('bingo');
    }

    // 4) Refresh visible board + rack + status; speak the play summary.
    if (Board()) Board().render();
    if (UI()) { UI().renderRack(); UI().updateInfoPanel(); }
    announcePlay(player, move);

    // 5) Draw back up to 7 (if the bag has tiles) AFTER playing (SCRABBLE_RULES §5).
    var drawn = State().drawTiles(player, placements.length);
    if (drawn.length && Sounds()) Sounds().play('draw');
    if (UI()) UI().renderRack();

    // 6) Act on the two flag-gated post-play settings (integration fix #11):
    //    audio score counter + auto-read-board.
    postCommitEffects(move);

    endTurn();
    return true;
  }

  // ---------------------------------------------------------------------------
  // postCommitEffects — the two previously-inert settings, applied after a play
  // is committed (integration fix #11):
  //   * audioScoreCounter: a SHORT, capped run of 'scoreTick' beeps (staggered via
  //     setTimeout) that "counts up" the play's score for an audible total. Capped
  //     so a big bingo doesn't beep forever; the spoken summary already gave the
  //     exact number, this is just a satisfying flourish.
  //   * autoReadBoard: read the whole (occupied) board via SC.Board.readBoard().
  // Both are no-ops unless their config flag is on.
  // ---------------------------------------------------------------------------
  function postCommitEffects(move) {
    var cfg = G().config || {};

    // Audio score counter: beep once per point, capped to keep it brief.
    if (cfg.audioScoreCounter && Sounds() && move && move.score > 0) {
      var TICK_MS = 60;          // gap between beeps
      var MAX_TICKS = 20;        // hard cap so a 100+ point play stays short
      var ticks = Math.min(move.score, MAX_TICKS);
      for (var i = 0; i < ticks; i++) {
        // Each beep is a separate delayed call; play() guards if sound is off.
        (function (delay) {
          setTimeout(function () { if (Sounds()) Sounds().play('scoreTick'); }, delay);
        })(i * TICK_MS);
      }
    }

    // Auto-read the board after the turn, if requested. We read after the count-up
    // would have started; readBoard speaks once via SC.Speech.
    if (cfg.autoReadBoard && Board() && Board().readBoard) {
      Board().readBoard();
    }
  }

  // removeTileFromRack — pull a specific Tile object (by id) out of a rack.
  function removeTileFromRack(player, tile) {
    for (var i = 0; i < player.rack.length; i++) {
      if (player.rack[i].id === tile.id) { player.rack.splice(i, 1); return true; }
    }
    return false;
  }

  // spokenWord — lowercase a whole word for SPEECH only (accessibility). Tiles and
  // Move.word/crossWords[].word are UPPERCASE, which Web Speech / screen readers
  // spell out letter-by-letter ("B-A-R-N") instead of pronouncing ("barn"). Route
  // every PRONOUNCED whole word through this; leave spelled-out letter sequences
  // and on-screen text uppercase.
  function spokenWord(w) { return (w || '').toLowerCase(); }

  // announcePlay — speak a one-line summary of a committed play (INTERFACE_DESIGN
  // §6.1/§6.4). For an opponent play we honour the auto-read setting; the player's
  // own play is always confirmed.
  function announcePlay(player, move) {
    if (!Speech()) return;
    var who = (player.isHuman && isSinglePlayerHuman()) ? 'You' : player.name;
    var span = '';
    if (move.mainWord && move.mainWord.cells && move.mainWord.cells.length) {
      var cells = move.mainWord.cells;
      var a = cells[0], b = cells[cells.length - 1];
      span = ' ' + move.dir + ' ' + Data().coordToString(a.row, a.col) +
             ' to ' + Data().coordToString(b.row, b.col);
    }
    var cross = '';
    if (move.crossWords && move.crossWords.length) {
      var names = [];
      // Pronounce each cross-word lowercase so it isn't spelled out by the SR.
      for (var i = 0; i < move.crossWords.length; i++) names.push(spokenWord(move.crossWords[i].word));
      cross = ' Also forms ' + names.join(', ') + '.';
    }
    var bingo = move.isBingo ? ' Bingo!' : '';
    // Pronounce the main word lowercase ("barn"), not "B-A-R-N".
    var msg = who + ' played ' + spokenWord(move.word) + span + ' for ' + move.score +
              (move.score === 1 ? ' point.' : ' points.') + bingo + cross + ' ' + scoreLine();

    // NOTE 3: when a COMPUTER just played and the NEXT player is the human, FOLD the
    // turn hand-off ("Now your turn.") onto this SAME utterance and set a one-shot
    // flag so the immediately-following beginTurn(human) skips its own assertive
    // "your turn" alert. Previously beginTurn fired that alert synchronously right
    // after this speak(), and (speech.js) its interrupt cancelled this not-yet-
    // spoken summary — so the user only ever heard "Your turn", never the AI's word.
    // Matches INTERFACE_DESIGN §6.4 ("Computer played QUARTZ … Now your turn.").
    var handoff = '';
    if (player.isComputer) {
      var nxt = peekNextPlayer();
      if (nxt && nxt.isHuman) {
        handoff = ' ' + handoffPhraseFor(nxt);
        skipNextBeginTurnAlert = true;          // beginTurn(human) will honour + clear this
      }
    }

    // NOTE 3c: a COMPUTER's announcement is spoken NON-INTERRUPTING so it QUEUES
    // after any utterance still playing instead of cancelling it. This makes
    // back-to-back computer turns (AI1 then AI2) BOTH fully audible even if AI2's
    // turn fires before AI1's line finishes — the announcements play sequentially
    // rather than the later one cutting off the earlier. A HUMAN's own play stays
    // interrupting (interrupt=true) for immediate confirmation of their action.
    if (player.isComputer && G().config && G().config.autoReadOpponent === false) {
      // Auto-read off: still drop a short cue (score + hand-off), also queued.
      Speech().speak(scoreLine() + handoff, /*interrupt*/ false);
    } else if (player.isComputer) {
      Speech().speak(msg + handoff, /*interrupt*/ false);
    } else {
      Speech().speak(msg + handoff);            // human's own play: interrupt (default)
    }
  }

  // scoreLine — "You 142, Computer 130." (INTERFACE_DESIGN §2).
  function scoreLine() {
    var parts = [];
    for (var i = 0; i < G().players.length; i++) {
      var p = G().players[i];
      var label = (p.isHuman && isSinglePlayerHuman()) ? 'You' : p.name;
      parts.push(label + ' ' + p.score);
    }
    return parts.join(', ') + '.';
  }

  // ===========================================================================
  // Tile-by-tile placement (INTERFACE_DESIGN §5.3a): Shift+1-7 / U / Shift+U / Y.
  // These stage tiles into SC.State.pending; the Board renders them as an overlay.
  // ===========================================================================

  // pendingHasTileId — is a specific tile (by id) already staged this turn? Used to
  // resolve slot numbers against the VISIBLE rack and to refuse double-staging the
  // same physical tile (bug fix: staging never removes the tile from player.rack —
  // commitPlay removes it by id — so a tile staged this turn must be excluded from
  // both slot lookup and re-staging).
  function pendingHasTileId(id) {
    var pend = State().getPending();
    for (var i = 0; i < pend.length; i++) if (pend[i].tile.id === id) return true;
    return false;
  }

  // slotTile(n) — the tile currently AVAILABLE in positional rack slot n (1-based),
  // or null if that slot is empty (NOTE 4). A slot is empty when it has no tile at
  // all (n beyond the rack length) OR its tile is already staged on the board this
  // turn. Staged tiles stay in player.rack at their index until commit, so positions
  // are STABLE: slot N is always player.rack[N-1] and never renumbers as tiles are
  // staged. This is the single source of truth for "slot N" shared by SC.UI's rack
  // render/announce (which keys off the SAME positional model).
  function slotTile(n) {
    var rack = State().currentPlayer().rack;
    var t = rack[n - 1];
    if (!t || pendingHasTileId(t.id)) return null;    // absent or staged -> empty slot
    return t;
  }

  // placeTileFromSlot(n) — stage POSITIONAL rack slot n (1-based) on the current
  // cursor square (NOTE 4), then (NOTE 5) optionally auto-advance the cursor to the
  // next empty square in the current direction. A blank prompts for its letter.
  function placeTileFromSlot(n) {
    if (!isHumanTurn()) return;
    // NOTE 4: resolve the slot POSITIONALLY against player.rack[n-1]. If that slot is
    // empty (no tile, or its tile is already staged) do NOTHING but give a GENTLE
    // "slot N is empty" cue — not the harsh error buzz — and crucially DON'T advance
    // the cursor (NOTE 5a: only a successful stage advances). Later tiles never shift
    // into a vacated slot, so the same Shift+N always means the same physical tile.
    var tile = slotTile(n);
    if (!tile) {
      if (Sounds()) Sounds().play('ui');             // soft cue, not 'invalid'
      if (Speech()) Speech().speak('Slot ' + n + ' is empty.');
      return;
    }

    var cur = Board().getCursor();
    if (!cur) return;
    // The target square must be empty on the committed board AND not already staged.
    if (G().board[cur.row][cur.col] !== null || pendingAt(cur.row, cur.col)) {
      announceInvalid(Data().coordToString(cur.row, cur.col) + ' is already filled.');
      return;
    }

    // A blank tile needs a declared letter before it can be staged (SCRABBLE_RULES §7).
    var placeTile = tile;
    if (tile.isBlank) {
      var letter = promptBlankLetter();
      if (!letter) return;                      // cancelled (no advance)
      // Assign the blank IN PLACE (points stay 0). returnTiles resets it on recall.
      tile.letter = letter;
    }

    State().addPending(cur.row, cur.col, placeTile);
    if (Sounds()) {
      // Distinct, satisfying single-tile DROP on the staged square (pan by column,
      // pitch by row when spatial is on). A blank ALSO gets its shimmer so it stays
      // audibly distinct from a lettered tile.
      Sounds().play('place', { col: cur.col, row: cur.row });
      if (tile.isBlank) Sounds().play('blank', { col: cur.col, row: cur.row });
    }

    if (Board()) Board().render();              // re-render so the overlay shows
    if (UI()) UI().renderRack();                // (UI shows the staged slot as empty)

    // NOTE 5: auto-advance only on a SUCCESSFUL stage, and only when the
    // advanceCursorOnPlace setting is on (default true). Fold the placement summary
    // and the new cursor position into ONE utterance so the user always knows where
    // the cursor landed (previously the cursor moved silently — the user had to press
    // C to find it). speakPlacement builds the combined line.
    var placedLabel = tile.isBlank ? ('blank as ' + placeTile.letter)
      : (placeTile.letter + ', ' + placeTile.points + (placeTile.points === 1 ? ' point' : ' points'));
    var stagedCoord = Data().coordToString(cur.row, cur.col);
    var advance = !(G().config && G().config.advanceCursorOnPlace === false);
    var moved = advance ? advanceCursorToNextEmpty() : null;
    speakPlacement(placedLabel, stagedCoord, advance, moved);
  }

  // speakPlacement — one combined utterance for a staged tile (NOTE 5): what was
  // placed and where, plus where the cursor is now. Keeping it ONE speak() call
  // preserves the speak-once discipline (no second utterance to clobber the first).
  //   advance=false                -> "Placed R, 1 point on H8."
  //   advanced & moved to H9       -> "Placed R, 1 point on H8. Cursor on H9."
  //   advanced but no empty ahead  -> "Placed R, 1 point on H8. No empty square ahead;
  //                                    cursor stays on H8."
  function speakPlacement(placedLabel, stagedCoord, advance, moved) {
    if (!Speech()) return;
    var msg = 'Placed ' + placedLabel + ' on ' + stagedCoord + '.';
    if (advance) {
      if (moved) { msg += ' Cursor on ' + Data().coordToString(moved.row, moved.col) + '.'; }
      else { msg += ' No empty square ahead; cursor stays on ' + stagedCoord + '.'; }
    }
    Speech().speak(msg);
  }

  // advanceCursorToNextEmpty — move the cursor along the current direction to the
  // next square that is empty (committed null AND not pending), so the next
  // Shift+digit lands sensibly. Returns the new cursor {row,col} if it moved, or
  // null if no empty square remained ahead (so the caller can announce the landing
  // square or note the end of the line — NOTE 5). Stays put when none remain.
  function advanceCursorToNextEmpty() {
    var dir = G().direction;
    var dr = (dir === 'down') ? 1 : 0, dc = (dir === 'down') ? 0 : 1;
    var cur = Board().getCursor();
    var r = cur.row + dr, c = cur.col + dc;
    while (Data().inBounds(r, c)) {
      if (G().board[r][c] === null && !pendingAt(r, c)) { return Board().setCursor(r, c); }
      r += dr; c += dc;
    }
    // No empty square ahead: leave the cursor where it is (edge cue is fine).
    return null;
  }

  // pendingAt — is there a staged tile at (r,c)? (small helper over G.pending)
  function pendingAt(r, c) {
    var pend = State().getPending();
    for (var i = 0; i < pend.length; i++) if (pend[i].row === r && pend[i].col === c) return true;
    return false;
  }

  // undoLastPending (U) — pick the most recently staged tile back up to the rack.
  function undoLastPending() {
    if (!isHumanTurn()) return;
    var placement = State().removePendingLast();
    if (!placement) { announceInvalid('No staged tiles to undo.'); return; }
    returnPlacementToRack(placement);
    if (Sounds()) Sounds().play('ui');
    if (Speech()) Speech().speak('Picked up ' + placementLetter(placement) + ' from ' +
      Data().coordToString(placement.row, placement.col) + '.');
    if (Board()) Board().render();
    if (UI()) UI().renderRack();
    if (Board()) Board().setCursor(placement.row, placement.col);   // cursor returns to the freed square
  }

  // recallAllPending (Shift+U) — pick up every tile staged this turn.
  function recallAllPending() {
    if (!isHumanTurn()) return;
    var pend = State().getPending();
    if (!pend.length) { announceInvalid('No staged tiles to recall.'); return; }
    var count = pend.length;
    // Just un-stage: clearPending empties G.pending. Staging never REMOVED these
    // tiles from player.rack (commitPlay removes them by id at commit, and the UI
    // merely hides staged tiles), so we must NOT push them back — doing so would
    // DUPLICATE every recalled tile in the rack. We only reset any blank to
    // unassigned so its rack label/value is correct again.
    var tiles = State().clearPending();
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i].isBlank) { tiles[i].letter = null; tiles[i].points = 0; }
    }
    if (Sounds()) Sounds().play('ui');
    if (Speech()) Speech().speak('Recalled ' + count + ' tile' + (count === 1 ? '' : 's') + ' to your rack.');
    if (Board()) Board().render();
    if (UI()) UI().renderRack();
  }

  // returnPlacementToRack — undo helper: un-stage a single placement. The tile is
  // still in player.rack (staging only hides it; see recallAllPending), so we just
  // reset a blank to unassigned — we must NOT push, which would duplicate the tile.
  function returnPlacementToRack(placement) {
    var t = placement.tile;
    if (t.isBlank) { t.letter = null; t.points = 0; }
  }
  function placementLetter(placement) {
    var t = placement.tile;
    return t.isBlank ? ('blank as ' + (t.letter || '?')) : t.letter;
  }

  // verifyPending (Y) — read the staged play's word(s), validity, and score so far
  // WITHOUT committing (INTERFACE_DESIGN §5.3a). Uses SC.Rules.evaluatePlay with
  // the current direction (so a single staged tile is scored along the chosen axis,
  // ARCHITECTURE §7.2).
  function verifyPending() {
    var pend = State().getPending();
    if (!pend.length) { announceInvalid('No tiles staged yet.'); return; }
    var move = Rules().evaluatePlay(G().board, pend.slice(), isFirstMove(), G().direction);
    speakMoveVerdict(move, /*forVerify*/ true);
  }

  // previewPending — Space/Enter when tiles are staged tile-by-tile: build the Move
  // from G.pending and open the Score Preview so the player can commit it
  // (INTERFACE_DESIGN §5.3a "Commit the staged play (via Score Preview)"). This is
  // the staged-play counterpart of SC.UI.composerToPreview (which previews a TYPED
  // word). showPreview's Enter -> commitFromPreview -> commitPlay lays the tiles and
  // clears G.pending. Previously the dispatcher called composerToPreview here, which
  // re-parsed the (empty) composer field and could never preview the staged tiles.
  function previewPending() {
    var pend = State().getPending();
    if (!pend.length) { announceInvalid('No tiles staged yet.'); return; }
    var move = Rules().evaluatePlay(G().board, pend.slice(), isFirstMove(), G().direction);
    // evaluatePlay already sets move.placements from the array we pass; keep the
    // staged set canonical so commit narration reflects blank assignments.
    move.placements = pend.slice();
    if (UI()) UI().showPreview(move);
  }

  // speakMoveVerdict — shared phrasing for verify (Y) and for the Composer/Preview
  // path: spell the main word, validity, cross-words, bingo, and the total. Invalid
  // plays still report the would-be score (ARCHITECTURE §7.3) and play the error cue.
  function speakMoveVerdict(move, forVerify) {
    if (!Speech()) return;
    // Pronounce the main word lowercase ("barn: valid"), not spelled out.
    var head = move.word ? (spokenWord(move.word) + ': ') : '';
    var parts = [];
    if (move.valid) {
      parts.push(head + 'valid');
      if (move.crossWords && move.crossWords.length) {
        var names = [];
        // Pronounce each cross-word lowercase too.
        for (var i = 0; i < move.crossWords.length; i++) names.push(spokenWord(move.crossWords[i].word));
        parts.push('also forms ' + names.join(', '));
      }
      if (move.isBingo) parts.push('bingo, plus 50');
      parts.push((forVerify ? 'so far ' : '') + move.score + (move.score === 1 ? ' point' : ' points'));
      if (Sounds()) Sounds().play('validWord');
    } else {
      // Friendly a11y message: name the offending word but still give the value.
      parts.push(move.reason || 'Not a legal play');
      if (move.score) parts.push('would have scored ' + move.score);
      if (Sounds()) Sounds().play('invalid');
    }
    Speech().speak(parts.join('. ') + '.');
  }

  // promptBlankLetter — minimal accessible prompt for a blank's letter. The
  // Composer (SC.UI) has the rich "C(A)T" syntax; tile-by-tile uses a simple
  // prompt() so a blank can be staged without leaving Navigation mode.
  function promptBlankLetter() {
    var ans = window.prompt('This tile is a blank. Which letter should it represent? (A–Z)');
    if (ans == null) return null;
    ans = String(ans).trim().toUpperCase();
    if (!/^[A-Z]$/.test(ans)) { announceInvalid('Please choose a single letter A to Z.'); return null; }
    return ans;
  }

  // ===========================================================================
  // pass / exchange (SCRABBLE_RULES §8/§9). The controller owns these actions and
  // the six-scoreless-turn rule (ARCHITECTURE §7.5).
  // ===========================================================================

  // pass() — forfeit the turn. Confirms first when the setting is on (press P
  // again). A pass is a scoreless turn (feeds the six-scoreless stalemate count).
  function pass() {
    if (!isHumanTurn()) return;
    // Recall any staged tiles first so the rack is intact when we pass.
    if (State().getPending().length) recallAllPending();

    // Canonical confirm flag is config.confirmActions (see newGame); default-on.
    // Previously read config.confirmPass, which the Settings UI never wrote.
    if (G().config && G().config.confirmActions !== false && passArmed !== 'pass') {
      passArmed = 'pass';
      if (Speech()) Speech().alert('Pass your turn? Press P again to confirm, Escape to cancel.');
      return;
    }
    passArmed = false;
    doPass(State().currentPlayer());
  }

  // doPass — the un-confirmed pass action, shared by human and (potentially) AI.
  function doPass(player) {
    G().consecutiveScorelessTurns++;
    G().lastMove = null;
    G().moveLog.unshift({ playerName: player.name, move: { word: '(pass)', score: 0, valid: true }, turn: G().turnNumber });
    if (Sounds()) Sounds().play('pass');
    if (Speech()) {
      var who = (player.isHuman && isSinglePlayerHuman()) ? 'You' : player.name;
      Speech().speak(who + ' passed.');
    }
    endTurn();
  }

  // exchange(tiles) — swap the given rack Tile[] for new ones (SCRABBLE_RULES §8).
  // Requires ≥7 tiles in the bag; the swapped tiles go back to the bag AFTER the
  // draw so they cannot be redrawn this turn. An exchange is a scoreless turn.
  //
  // This is the HUMAN entry point: it keeps the guards (human turn, non-empty,
  // bag≥7) and, mirroring pass(), recalls any staged tiles first so G.pending does
  // NOT leak into the next player's turn (a stale placement would otherwise be
  // drawn as a phantom overlay and corrupt the next player's preview/verify). The
  // unguarded core lives in doExchange so the AI path (a computer, for whom
  // isHumanTurn() is false) can call it without being blocked.
  function exchange(tiles) {
    if (!isHumanTurn()) return;
    if (!tiles || !tiles.length) { announceInvalid('Select at least one tile to exchange.'); return; }
    if (State().bagCount() < 7) {
      announceInvalid('You can only exchange when at least seven tiles remain in the bag.');
      return;
    }
    // Recall any staged tiles first so the rack is intact when we exchange (pass()
    // does the same). The Exchange dialog hides staged tiles via visibleRackTiles,
    // so without this G.pending would survive into the next turn as a phantom.
    if (State().getPending().length) recallAllPending();
    doExchange(State().currentPlayer(), tiles);
  }

  // doExchange(player, tiles) — the un-guarded exchange core, shared by the human
  // path (exchange()) and the AI path (runAiDecision). It performs the bag swap,
  // bookkeeping, audio/speech, and ends the turn. The AI calls this directly
  // because the public exchange() begins with an isHumanTurn() guard that returns
  // for a computer player — calling exchange() from the AI would stall the game
  // (no swap, no endTurn, no next turn scheduled).
  function doExchange(player, tiles) {
    // Pull the chosen tiles out of the rack, draw replacements, THEN return them.
    for (var i = 0; i < tiles.length; i++) removeTileFromRack(player, tiles[i]);
    State().drawTiles(player, tiles.length);
    State().returnTiles(tiles);                 // back to bag + reshuffle (resets blanks)

    G().consecutiveScorelessTurns++;            // exchange scores nothing -> scoreless
    G().lastMove = null;
    G().moveLog.unshift({ playerName: player.name, move: { word: '(exchange ' + tiles.length + ')', score: 0, valid: true }, turn: G().turnNumber });

    if (Sounds()) Sounds().play('exchange');
    if (UI()) UI().renderRack();
    if (Speech()) {
      var who = (player.isHuman && isSinglePlayerHuman()) ? 'You' : player.name;
      Speech().speak(who + ' exchanged ' + tiles.length + ' tile' + (tiles.length === 1 ? '' : 's') + '.');
    }
    endTurn();
  }

  // ===========================================================================
  // aiTurn() — the computer's whole turn (ARCHITECTURE §3 / §7.5).
  // ---------------------------------------------------------------------------
  // After the move delay: choose the best move; if a play exists, commit it (and
  // announce via Speech); otherwise consult recommendExchange and exchange, else
  // pass. The CONTROLLER owns the six-scoreless-turn rule and may OVERRIDE the AI
  // to avoid ending the game when a scoring play exists (ARCHITECTURE §7.5).
  // ===========================================================================
  function aiTurn() {
    if (aiRunning) return;                       // guard against double scheduling during the delay
    aiRunning = true;
    var delay = (G().config && G().config.aiMoveDelayMs != null) ? G().config.aiMoveDelayMs : aiMoveDelayMs;
    // Capture the handle so newGame()/endGame()/enterGameScreen() can CANCEL a pending
    // AI decision (reviewer cleanup gap). Clear any prior one first (idempotent).
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    aiTimer = setTimeout(function () {
      aiTimer = null;
      // Clear the guard BEFORE deciding. runAiDecision -> commitPlay chains
      // endTurn -> nextPlayer -> beginTurn -> aiTurn() SYNCHRONOUSLY, so a SECOND
      // consecutive computer must be able to schedule its own turn. Clearing this in
      // a `finally` left aiRunning=true during that chain, silently blocking the next
      // computer's turn (the human then inherited it). See multi_ai_repro test.
      aiRunning = false;
      runAiDecision();
    }, delay);
  }

  // stopAITimer — cancel a pending AI "think" timer and clear the re-entrancy guard,
  // so a game reset/end can't have a stale AI decision fire into the next game. The
  // phase guard in runAiDecision stays as defence in depth.
  function stopAITimer() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    aiRunning = false;
  }

  function runAiDecision() {
    if (G().phase !== 'playing') return;
    var player = State().currentPlayer();
    if (!player.isComputer) return;             // safety: only computers auto-play
    var first = isFirstMove();

    // 1) Ask the AI for its best placement play (Move | null).
    var best = AI().chooseMove(G().board, player.rack, player.difficulty || 'medium', first);

    // 2) Decide play vs exchange vs pass, weighing the leave value of keeping tiles
    //    (SPEC-leaves §6.6). The exchange is only legal with ≥7 in the bag.
    var canExchange = State().bagCount() >= 7;
    var rec = (canExchange && AI().recommendExchange) ? AI().recommendExchange(G().board, player.rack) : null;
    var recTiles = normalizeExchangeRec(rec);
    var recKeepValue = exchangeKeepValue(rec, player.rack);

    // Six-scoreless-turn OVERRIDE: if scoreless turns are mounting toward the §11.2
    // limit, prefer ANY scoring play over a pass/exchange to avoid ending the game
    // on a stalemate (ARCHITECTURE §7.5). Threshold of 4 leaves headroom under 6.
    var stalemateRisk = G().consecutiveScorelessTurns >= 4;

    if (best && (stalemateRisk || !shouldExchangeInstead(best, recKeepValue, canExchange))) {
      announceAiThenCommit(best);
      return;
    }
    if (recTiles && recTiles.length && canExchange) {
      // Call the un-guarded core directly: the public exchange() bails out on a
      // computer player (isHumanTurn() === false), which would stall the game.
      doExchange(player, recTiles);             // owns endTurn + scoreless++
      return;
    }
    // Nothing better to do: pass (no confirm for the AI).
    doPass(player);
  }

  // shouldExchangeInstead — true when keeping a good leave beats the best play's
  // equity (SPEC-leaves §6.6). Defensive about missing AI fields.
  function shouldExchangeInstead(best, recKeepValue, canExchange) {
    if (!canExchange || recKeepValue == null) return false;
    var equity = (best.equity != null) ? best.equity : best.score;
    return equity < recKeepValue;
  }

  // normalizeExchangeRec — accept BOTH documented shapes of recommendExchange:
  // ARCHITECTURE §7.5 says Tile[]|null; SPEC-leaves §6.6 says {tiles,keepLeave}|null.
  // We tolerate either since SC.AI is developed in parallel.
  function normalizeExchangeRec(rec) {
    if (!rec) return null;
    if (Array.isArray(rec)) return rec;          // Tile[]
    if (rec.tiles) return rec.tiles;             // {tiles, keepLeave}
    return null;
  }
  // exchangeKeepValue(rec, rack) — the leave value of the tiles KEPT after the
  // recommended exchange, used by shouldExchangeInstead to compare against the best
  // play's equity. Handles BOTH recommendExchange shapes:
  //   * Tile[] (the authoritative ARCHITECTURE §7.5 shape SC.AI actually returns):
  //     reconstruct the kept leave = rack tiles whose id is NOT in the toss list,
  //     as a letter string ('?' for a blank), and score it with AI.leaveValue.
  //   * {tiles, keepLeave} (the alternative SPEC-leaves §6.6 shape): use keepLeave
  //     directly. (Without this, a bare Tile[] always returned null, so
  //     shouldExchangeInstead was always false and the AI NEVER exchanged over a
  //     weak play — it only exchanged when no legal play existed at all.)
  function exchangeKeepValue(rec, rack) {
    if (!rec || !AI().leaveValue) return null;
    if (!Array.isArray(rec)) {
      return (rec.keepLeave != null) ? AI().leaveValue(rec.keepLeave) : null;
    }
    if (!rack) return null;
    // Build the set of tile ids being tossed, then spell the kept remainder.
    var toss = {};
    for (var i = 0; i < rec.length; i++) toss[rec[i].id] = true;
    var keep = '';
    for (var j = 0; j < rack.length; j++) {
      if (!toss[rack[j].id]) keep += rack[j].isBlank ? '?' : rack[j].letter;
    }
    return AI().leaveValue(keep);
  }

  // announceAiThenCommit — cue "opponent played", commit, and let commitPlay speak
  // the full summary (which respects the auto-read-opponent setting).
  function announceAiThenCommit(move) {
    if (Sounds()) Sounds().play('oppPlayed');
    commitPlay(move);
  }

  // ===========================================================================
  // endTurn / nextPlayer / checkGameEnd / endGame
  // ===========================================================================

  // endTurn — close out the current player's action: persist, check for game end,
  // and otherwise advance to the next player and begin their turn.
  function endTurn() {
    saveGame();                                 // autosave the post-move state (if on)
    if (checkGameEnd()) { endGame(); return; }
    nextPlayer();
    beginTurn();
  }

  // nextPlayer — advance the turn pointer (wrapping), bumping the turn number when
  // we wrap back to player 0 (one "turn number" = one full round).
  function nextPlayer() {
    var prev = G().currentPlayer;
    G().currentPlayer = (G().currentPlayer + 1) % G().players.length;
    if (G().currentPlayer <= prev) G().turnNumber++;   // wrapped -> new round
  }

  // checkGameEnd — true if the game is over (SCRABBLE_RULES §11):
  //   (a) the bag is empty AND the player who just moved emptied their rack, or
  //   (b) six consecutive scoreless turns have occurred (stalemate).
  function checkGameEnd() {
    var justMoved = State().currentPlayer();    // endTurn runs before nextPlayer()
    if (State().bagCount() === 0 && justMoved.rack.length === 0) return true;
    if (G().consecutiveScorelessTurns >= 6) return true;
    return false;
  }

  // endGame — final scoring (SCRABBLE_RULES §12):
  //   1) every player subtracts the point sum of tiles still on their rack;
  //   2) if a player went OUT (empty rack), they ADD the sum of all opponents'
  //      unplayed tiles to their own score;
  //   3) highest adjusted score wins (ties = shared win / draw, §12.1).
  function endGame() {
    G().phase = 'gameover';
    G().endTime = Date.now();
    stopAutosave();
    stopClock();                                // freeze the game clock at the end
    stopAITimer();                              // cancel any pending AI decision (cleanup)
    // Paint the final elapsed time (startTime..endTime) so #timer shows the total.
    var timerEl = $('timer');
    if (timerEl && G().startTime) timerEl.textContent = formatClock(G().endTime - G().startTime);
    clearSave();                                // a finished game is not resumable

    // Identify the out-player (if any). With an empty bag, at most one player can
    // have an empty rack (they just played their last tiles).
    var outPlayer = null;
    for (var i = 0; i < G().players.length; i++) {
      if (G().players[i].rack.length === 0 && State().bagCount() === 0) { outPlayer = G().players[i]; break; }
    }

    // 1) + 2): apply rack penalties; accumulate the out-player's bonus.
    var bonusToOut = 0;
    var adjustments = [];                        // for the spoken breakdown
    for (i = 0; i < G().players.length; i++) {
      var p = G().players[i];
      var rackSum = rackPointSum(p.rack);
      if (p === outPlayer) {
        // The out-player subtracts nothing of their own (empty rack) and gains the
        // opponents' totals (added below once we have the full sum).
        adjustments.push({ player: p, penalty: 0, rackSum: 0 });
      } else {
        p.score -= rackSum;
        bonusToOut += rackSum;
        adjustments.push({ player: p, penalty: rackSum, rackSum: rackSum });
      }
    }
    if (outPlayer) outPlayer.score += bonusToOut;

    // 3) Determine winner(s) (highest adjusted score; ties share the win).
    var top = -Infinity;
    for (i = 0; i < G().players.length; i++) if (G().players[i].score > top) top = G().players[i].score;
    var winners = [];
    for (i = 0; i < G().players.length; i++) if (G().players[i].score === top) winners.push(G().players[i]);

    // Audio: win for the human if they won (or share), else lose.
    var humanWon = false;
    for (i = 0; i < winners.length; i++) if (winners[i].isHuman) humanWon = true;
    if (Sounds()) Sounds().play(humanWon ? 'win' : 'lose');

    // Build the result + breakdown text and hand it to SC.UI's Game Over overlay.
    var result = buildResult(winners, outPlayer, adjustments, bonusToOut, top);
    if (UI()) UI().showGameOver(result);
    if (Speech()) Speech().alert(result.spoken);   // assertive: game over interrupts
    if (UI()) UI().updateInfoPanel();
  }

  // rackPointSum — sum of face values of tiles on a rack (blanks count 0).
  function rackPointSum(rack) {
    var s = 0;
    for (var i = 0; i < rack.length; i++) s += rack[i].points || 0;
    return s;
  }

  // buildResult — assemble the structured + spoken end-of-game summary the Game
  // Over overlay renders and SC.Speech announces (INTERFACE_DESIGN §6.6).
  function buildResult(winners, outPlayer, adjustments, bonusToOut, top) {
    var winnerNames = winners.map(function (p) {
      return (p.isHuman && isSinglePlayerHuman()) ? 'You' : p.name;
    });
    var draw = winners.length > 1;
    var headline;
    if (draw) {
      headline = "It's a draw between " + winnerNames.join(' and ') + ' at ' + top + '.';
    } else {
      var w = winners[0];
      var label = (w.isHuman && isSinglePlayerHuman()) ? 'You win' : (w.name + ' wins');
      headline = label + ' with ' + top + '!';
    }

    // Per-player breakdown: final score, and the rack penalty / out-bonus applied.
    var lines = [];
    for (var i = 0; i < adjustments.length; i++) {
      var a = adjustments[i];
      var name = (a.player.isHuman && isSinglePlayerHuman()) ? 'You' : a.player.name;
      var line = name + ': ' + a.player.score;
      if (a.player === outPlayer) {
        line += ' (went out, +' + bonusToOut + ' from opponents’ racks)';
      } else if (a.penalty > 0) {
        line += ' (−' + a.penalty + ' for tiles left on rack)';
      }
      lines.push(line);
    }

    var spoken = 'Game over. ' + headline + ' Final scores: ' +
      lines.join('; ') + '.';

    // Did a human win (or share the win)? Drives the win/lose perspective. (The
    // win/lose CUE is played once by endGame; this flag lets the overlay reflect
    // the same perspective without re-cueing.)
    var humanWon = false;
    for (var w2 = 0; w2 < winners.length; w2++) if (winners[w2].isHuman) humanWon = true;

    // Per-player {name, score, penalty} rows for the overlay's score table. The
    // out-player shows a NEGATIVE "penalty" so the row reads "+N" (they GAINED the
    // opponents' rack points), while everyone else shows their positive deduction.
    var scores = adjustments.map(function (a) {
      return {
        name: (a.player.isHuman && isSinglePlayerHuman()) ? 'You' : a.player.name,
        score: a.player.score,
        penalty: (a.player === outPlayer) ? -bonusToOut : a.penalty
      };
    });

    return {
      winners: winners,
      isDraw: draw,
      outPlayer: outPlayer,
      bonusToOut: bonusToOut,
      topScore: top,
      headline: headline,
      lines: lines,
      players: G().players,
      spoken: spoken,
      // Keys SC.UI.showGameOver reads (kept in sync so the overlay shows the
      // headline + per-player breakdown, not a generic fallback):
      isHumanWinner: humanWon,
      winnerName: draw ? null : winnerNames[0],
      scores: scores,
      reason: headline
    };
  }

  // ===========================================================================
  // Direction toggle (D key) + small shared announce helpers
  // ===========================================================================

  // toggleDirection — flip across<->down (shared by composer + tile-by-tile),
  // announce it (INTERFACE_DESIGN §5.3). Stored on G.direction (ARCHITECTURE §2).
  function toggleDirection() {
    G().direction = (G().direction === 'across') ? 'down' : 'across';
    if (Sounds()) Sounds().play('ui');
    if (Speech()) Speech().speak('Direction ' + G().direction + '.');
  }

  // announceInvalid — error cue + assertive message for a rejected action.
  function announceInvalid(msg) {
    if (Sounds()) Sounds().play('invalid');
    if (Speech()) Speech().alert(msg);
  }

  // isHumanTurn / isHumanTurnGuard — only humans may use the action keys.
  function isHumanTurn() {
    var p = State().currentPlayer();
    return G().phase === 'playing' && p && p.isHuman;
  }

  // ===========================================================================
  // handleKey(e) — the SINGLE global dispatcher (SPEC-housestyle §3).
  // Order is load-bearing: (A) overlays steal keys, (B) global keys, (C) modifier
  // pass-through, (D) game-screen gate, (E) Shift map, (F) plain nav map.
  // ===========================================================================
  function handleKey(e) {
    // --- (A) MODE GATING FIRST (integration fix #1+#2). One owner per mode:
    //   * Any SC.UI modal dialog (composer/preview/exchange/settings/help/game-
    //     over) binds its OWN capture-phase keydown handler in SC.UI.openDialog,
    //     which consumes its control keys (+ Tab/Esc) and stopPropagation()s them
    //     so they never reach here. So while a UI dialog is open, the document
    //     dispatcher does NOTHING (early-return) — the dialog is sole owner. This
    //     also keeps the composer <input> typing native (the SR echoes letters).
    //   * The board's "go to coordinate" mini-input does NOT self-bind a listener,
    //     so we ROUTE its keys to SC.Board.coordInputKey(e) (which handles Enter/
    //     Esc and lets typed chars fall through to the field). That keeps the
    //     coord-input the owner of its keys, consistent with the dialog model.
    // Predicates are called defensively (siblings may be loading at partial boot).
    if (uiDialogOpen()) { return; }
    if (boardOpen('isCoordInputOpen')) { if (Board()) Board().coordInputKey(e); return; }

    // --- (B) GLOBAL keys that work in any non-overlay state. ----------------
    var key = e.key ? e.key.toLowerCase() : '';
    if (key === '?') { e.preventDefault(); if (UI()) UI().showHelp(); return; }
    if (key === '/') { e.preventDefault(); if (UI()) UI().openSettings(); return; }
    if (key === 'escape') {
      // Top-level Escape stops speech and disarms any pending confirm.
      e.preventDefault();
      passArmed = false;
      if (Speech()) Speech().speak('');         // empty -> cancels current utterance
      return;
    }

    // --- (C) MODIFIER PASS-THROUGH: never swallow OS / browser / SR shortcuts.
    // Ctrl/Cmd/Alt belong to the browser & screen reader. Shift is OURS.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // --- (D) Only dispatch game keys when the game screen is up. ------------
    if (G().phase !== 'playing') return;

    // Any non-confirm key disarms a latched pass/new-game confirm (except the
    // matching repeat, handled inside the branch).
    if (key !== 'p' && key !== 'n' && passArmed) passArmed = false;

    // --- (E) Shift-modified keys (line review, tile-by-tile, global toggles).
    if (e.shiftKey) return shiftKey(e, key);

    // --- (F) Plain navigation-mode keymap. ---------------------------------
    return navKey(e, key);
  }

  // uiDialogOpen — is ANY SC.UI modal dialog open? (composer/preview/exchange/
  // settings/help/game-over). Defensive: tolerate SC.UI not yet loaded.
  function uiDialogOpen() {
    return !!(UI() && typeof UI().isDialogOpen === 'function' && UI().isDialogOpen());
  }
  // boardOpen — call a board "is…Open" predicate iff the module + method exist.
  function boardOpen(method) {
    return Board() && typeof Board()[method] === 'function' && Board()[method]();
  }

  // ---------------------------------------------------------------------------
  // navKey — plain (unmodified) Navigation/Review-mode keys (INTERFACE_DESIGN §5).
  // preventDefault ONLY on keys we consume that would otherwise scroll / trigger
  // SR quick-nav (movement, Space/Enter, jumps, actions) — Discipline 1.
  // ---------------------------------------------------------------------------
  function navKey(e, key) {
    // Movement: VIM cluster HJKL + arrow keys (the user's reconciled keymap, §5.1).
    var MOVE = {
      h: 'left', j: 'down', k: 'up', l: 'right',
      arrowleft: 'left', arrowdown: 'down', arrowup: 'up', arrowright: 'right'
    };
    if (MOVE[key]) { e.preventDefault(); if (Board()) Board().moveCursor(MOVE[key]); return; }

    switch (key) {
      case ' ':
      case 'enter':                             // Space/Enter: contextual (§5.3)
        e.preventDefault();
        if (State().getPending().length) {      // tiles staged -> go to Score Preview
          previewPending();                     // build the move from G.pending + preview
        } else {                                // else open the Composer at the cursor
          if (UI()) UI().openComposer();
        }
        return;
      case 'g': e.preventDefault(); if (Board()) Board().openCoordInput(); return;   // "go to H8"
      case '[': e.preventDefault(); if (Board()) Board().nextAnchor(-1); return;
      case ']': e.preventDefault(); if (Board()) Board().nextAnchor(+1); return;

      // Reading / information (no preventDefault — none are page-scroll keys).
      case 'c': if (Board()) Board().announceSquare(); return;        // current square detail
      case 'w': if (Board()) Board().readWordsThrough(); return;      // word(s) through cursor
      case 'b': if (Board()) Board().readBoard(); return;             // occupied squares
      case 'i': if (UI()) UI().announceRack(); return;                // Inventory (rack)
      case 'v': if (UI()) UI().rackValueSummary(); return;            // rack value summary
      case 's': if (UI()) UI().announceStatus(); return;              // scores/turn/bag
      case 't': if (UI()) UI().announceUnseen(); return;              // bag + unseen letters
      case 'm': if (UI()) UI().announceMoveLog(); return;             // move history
      case 'r': if (Speech()) Speech().repeat(); return;              // repeat last announcement

      // Actions.
      case 'd': e.preventDefault(); toggleDirection(); return;        // toggle direction
      case 'x': e.preventDefault(); if (UI()) UI().openExchange(); return;
      case 'p': e.preventDefault(); pass(); return;                   // confirms first
      case 'n': e.preventDefault(); newGame(); return;                // confirms first
      case 'f':                                  // word-finder / hint (only if enabled)
        // Canonical flag is config.hintEnabled (integration fix #5): the setup
        // checkbox, the Settings checkbox, this F-gate, and SC.UI.findHint all
        // read the SAME flag now.
        if (G().config && G().config.hintEnabled) { if (UI()) UI().findHint(); }
        else announceInvalid('The hint key is turned off. Enable it in Settings or on the start screen.');
        return;
      case 'u': e.preventDefault(); undoLastPending(); return;        // undo last staged tile
      case 'y': verifyPending(); return;                             // verify staged play
      case '-': if (Speech()) { Speech().setRate(Speech().getRate() - 0.1); saveSettings(); Speech().speak('Rate ' + Speech().getRate().toFixed(1)); } return;
      case '=': if (Speech()) { Speech().setRate(Speech().getRate() + 0.1); saveSettings(); Speech().speak('Rate ' + Speech().getRate().toFixed(1)); } return;
    }

    // Digits 1-7 (no Shift) = announce the tile in rack slot N. Use e.code so the
    // mapping is layout-independent (Discipline 3).
    var d = e.code && e.code.match(/^Digit([1-7])$/);
    if (d) { if (UI()) UI().announceSlot(parseInt(d[1], 10)); return; }
  }

  // ---------------------------------------------------------------------------
  // shiftKey — Shift-modified Navigation-mode keys (INTERFACE_DESIGN §5.2/§5.3a/§5.7).
  // Shift is a GAME modifier here (Discipline 2), not pass-through.
  // ---------------------------------------------------------------------------
  function shiftKey(e, key) {
    // Shift+M / Shift+B match on e.code (KeyM/KeyB) so they are layout-independent
    // and unambiguous (the switch below also sees 'm'/'b' via lowercased e.key, but
    // the task pins these to e.code; handling them first keeps that contract clear).
    if (e.code === 'KeyM') {                  // Shift+M (NOTE 1b): only the most recent round
      e.preventDefault(); if (UI()) UI().announceLastRound(); return;
    }
    if (e.code === 'KeyB') {                  // Shift+B (NOTE 2): read every WORD on the board
      e.preventDefault(); if (Board()) Board().readWords(); return;
    }
    switch (key) {
      case 'h': case 'l': e.preventDefault(); if (Board()) Board().readRow(); return;     // read row (across)
      case 'j': case 'k': e.preventDefault(); if (Board()) Board().readColumn(); return;  // read column (down)
      case 'i': e.preventDefault(); if (UI()) UI().shuffleRack(); return;                 // shuffle rack
      case 'u': e.preventDefault(); recallAllPending(); return;                           // pick up all staged
      case 'v': if (Speech()) Speech().toggleVoice(); saveSettings(); return;             // toggle TTS
      case 'a': if (Speech()) Speech().toggleAria(); saveSettings(); return;              // toggle ARIA
      case 's': if (Sounds()) Sounds().toggle(); saveSettings(); return;                  // toggle sound
    }
    // Shift+[ / Shift+] = jump to prev/next premium square. Match on e.code: with
    // Shift held, e.key for these is "{"/"}" (US layout) — never "["/"]" — so a
    // `case '['` switch (which sees the lowercased e.key) NEVER fires. e.code stays
    // "BracketLeft"/"BracketRight" regardless of Shift/layout, like the digits below.
    if (e.code === 'BracketLeft')  { e.preventDefault(); if (Board()) Board().nextPremium(-1); return; }
    if (e.code === 'BracketRight') { e.preventDefault(); if (Board()) Board().nextPremium(+1); return; }
    // Shift+1..7 = place rack tile N on the cursor (tile-by-tile). e.code keeps it
    // layout-independent (Shift+1 is "!" on US, but e.code stays "Digit1").
    var d = e.code && e.code.match(/^Digit([1-7])$/);
    if (d) { e.preventDefault(); placeTileFromSlot(parseInt(d[1], 10)); return; }
  }

  // ---------------------------------------------------------------------------
  // NOTE (integration fix #1+#2): the per-overlay key sub-dispatchers that used to
  // live here (overlayKey/composerKey/previewKey/exchangeKey/coordInputKey) were
  // REMOVED. Each dialog now owns its own keys via SC.UI.openDialog's capture-phase
  // onKey handler (Tab-trap + Esc + the dialog's control keys), and the G "go to"
  // mini-input owns its keys via SC.Board.coordInputKey. handleKey early-returns
  // (block A) while any of them is open, so there is exactly ONE owner per mode and
  // no double-fire. This keeps the composer/jump <input> typing native (the SR
  // echoes characters) because those handlers only stopPropagation on keys they
  // actually consume.
  // ===========================================================================
  // Public API — EXACTLY the SC.Game surface required by ARCHITECTURE §3 (+ the
  // controller-owned turn-flow methods the task lists). Internal helpers stay private.
  // ===========================================================================
  return {
    init: init,
    startGame: startGame,
    newGame: newGame,
    resumeGame: resumeGame,
    handleKey: handleKey,
    commitPlay: commitPlay,
    placeTileFromSlot: placeTileFromSlot,
    undoLastPending: undoLastPending,
    recallAllPending: recallAllPending,
    verifyPending: verifyPending,
    pass: pass,
    exchange: exchange,
    aiTurn: aiTurn,
    endTurn: endTurn,
    nextPlayer: nextPlayer,
    checkGameEnd: checkGameEnd,
    endGame: endGame,
    toggleDirection: toggleDirection
  };
})();

// =============================================================================
// Boot: initialise the controller once the DOM is ready (ARCHITECTURE §3 — "Call
// SC.Game.init() on window load"). Using window 'load' guarantees every sibling
// <script> (data/dawg/dict/state/rules/ai/speech/sounds/board/ui) has executed and
// its SC.* object exists before init() wires them together.
// =============================================================================
window.addEventListener('load', function () { SC.Game.init(); });
