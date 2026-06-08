// =============================================================================
// js/ui.js  —  SC.UI
// -----------------------------------------------------------------------------
// The view/widget layer for Accessible Scrabble: it owns the rack, the Composer
// (type-a-whole-word entry), the Score Preview/Confirm dialog, the Exchange
// dialog, the Settings dialog, the Help dialog, the status/info readouts, the
// move-log rendering, and the Game-Over dialog. It also exposes findHint() (the
// optional F key) and a shared focus-trapped dialog mechanism.
//
// CONTRACT (authoritative): ARCHITECTURE.md §3 "SC.UI" lists the EXACT public
// surface this file must export, and §2 fixes the shared data shapes (Tile,
// Placement, Move, GameState). Behaviour/wording/keys come from
// INTERFACE_DESIGN.md (§3 layout, §5.4–5.6 dialog keys, §6 walkthroughs, §7 the
// exhaustive settings list). index.html (ARCHITECTURE §7.0) is the DOM source of
// truth — we bind to its exact element IDs and never invent new ones.
//
// HARD CONSTRAINTS (ARCHITECTURE §0):
//   * Plain ES5-ish JS: var + the repo's assigning-IIFE form. No ES modules, no
//     import/export, no fetch, no top-level async — the game runs from file://.
//   * Other SC.* modules are referenced ONLY inside functions (i.e. at/after
//     init), never at load time, so <script> order is not fragile.
//   * Thoroughly commented, clean, DRY (strict repo style).
//
// SEPARATION OF CONCERNS:
//   * SC.UI does NOT handle the global keydown stream. SC.Game.handleKey routes
//     keys here by calling the relevant public method (e.g. openExchange,
//     toggleExchangeTile(n), confirmExchange). The ONLY keydown listeners we add
//     are scoped to individual dialogs (focus-trap Tab cycling, Esc-to-close, and
//     the text fields inside the Composer/Jump dialogs) — never document-global.
//   * Turn execution (drawing tiles, advancing the turn, AI moves) belongs to
//     SC.Game; when the player confirms a play/exchange/pass we delegate to the
//     matching SC.Game turn-flow method and let it mutate authoritative state.
//   * Validation + scoring is SC.Rules.evaluatePlay — we never re-implement it.
// =============================================================================

window.SC = window.SC || {};
SC.UI = (function () {
  'use strict';

  // ===========================================================================
  // 0. Lazy module handles & tiny DOM helpers
  // ---------------------------------------------------------------------------
  // Per ARCHITECTURE §0 we grab sibling SC modules lazily (inside functions) so
  // load order is irrelevant. These thin accessors keep call sites readable and
  // tolerate a module being momentarily absent in a partial build.
  // ===========================================================================
  function S()      { return SC.State; }           // game state + primitives
  function G()      { return SC.State.G; }          // the live GameState object
  function Data()   { return SC.Data; }             // constants + coord helpers
  function Rules()  { return SC.Rules; }            // validation + scoring
  function Speech() { return SC.Speech; }           // dual TTS + ARIA output
  function Sounds() { return SC.Sounds; }           // Web Audio cues
  function Board()  { return SC.Board; }             // board DOM + cursor (may load later)
  function Game()   { return SC.Game; }              // controller / turn flow
  function AI()     { return SC.AI; }                // move generation (for hints)
  function Dict()   { return SC.Dict; }              // dictionary (readiness checks)

  // getElementById shortcut. Used everywhere; one place to change if needed.
  function byId(id) { return document.getElementById(id); }

  // Speak routine status through the dual-output speech layer (TTS + polite
  // ARIA). Guarded so a partial build (no Speech yet) degrades to silence rather
  // than throwing. interrupt defaults to true (SC.Speech.speak's own default).
  function say(text, interrupt) {
    if (Speech() && text) Speech().speak(text, interrupt);
  }

  // Speak an interruption (illegal move, confirmation prompt, your turn) through
  // the assertive region. Used for things the player must not miss.
  function alertSay(text) {
    if (Speech() && text) Speech().alert(text);
  }

  // Fire a Web Audio cue, tolerating an absent/half-built Sounds module.
  function cue(type, opts) {
    if (Sounds()) Sounds().play(type, opts);
  }

  // ---------------------------------------------------------------------------
  // Spoken-tile description helpers (INTERFACE_DESIGN §2 "Letters/tiles").
  // Centralised so rack, composer, preview, and exchange all narrate tiles the
  // SAME way (DRY): an unassigned blank, a blank assigned a letter, or a normal
  // lettered tile.
  // ---------------------------------------------------------------------------
  function pointWord(n) { return n === 1 ? '1 point' : n + ' points'; }

  // spokenWord — lowercase a whole word for SPEECH/announcement strings only
  // (accessibility). Tiles and Move.word/crossWords[].word are UPPERCASE, which
  // Web Speech and most screen readers spell out letter-by-letter ("B-A-R-N")
  // instead of pronouncing as a word ("barn"). Route every PRONOUNCED whole word
  // through this; keep the SPELLED-OUT copies (e.g. word.split('').join(' ')) and
  // tile glyphs uppercase.
  function spokenWord(w) { return (w || '').toLowerCase(); }

  // "R, 1 point" / "blank, 0 points" / "blank as E, 0 points".
  function describeTile(tile) {
    if (!tile) return 'empty';
    if (tile.isBlank) {
      return tile.letter
        ? 'blank as ' + tile.letter + ', 0 points'
        : 'blank, 0 points';
    }
    return tile.letter + ', ' + pointWord(tile.points);
  }

  // The single human player whose rack/turn this UI represents. In vs-Computer
  // and Solo modes that is players[0]; in Pass-and-Play the "current" human is
  // whoever's turn it is. We therefore always read the CURRENT player when they
  // are human, falling back to players[0]. SC.Game owns turn order; we just
  // render whoever is active.
  function activePlayer() {
    var cur = S().currentPlayer();
    return (cur && cur.isHuman) ? cur : G().players[0];
  }

  // ===========================================================================
  // 1. Settings persistence — single localStorage JSON blob
  // ---------------------------------------------------------------------------
  // ARCHITECTURE §3 + INTERFACE_DESIGN §7: EVERY setting is saved to localStorage
  // the instant it changes and restored on load. We keep ONE JSON blob under
  // "scrabble-settings" that bundles Speech's settings, Sounds' settings, and the
  // UI/gameplay flags that live in G.config. Speech and Sounds each own their
  // own getSettings()/restoreSettings(); we never duplicate their fields here —
  // we just nest their blobs (DRY: each module is the source of truth for its
  // own state).
  // ===========================================================================
  var STORAGE_KEY = 'scrabble-settings';

  // UI/gameplay defaults (the slice SC.UI itself owns). Speech/Sounds defaults
  // live inside those modules. These mirror the checkbox/select defaults in
  // index.html and the §7.3/§7.4 settings list.
  var DEFAULT_UI = {
    verbosity: 'normal',          // 'terse' | 'normal' | 'verbose' (§2 verbosity)
    announcePremium: true,        // announce premium squares while navigating
    announceCoords: true,         // announce coordinates while navigating
    autoReadOpponent: true,       // auto-read the opponent's play
    autoReadBoard: false,         // auto-read whole board after each turn
    audioScoreCounter: true,      // beep-count points when a play scores
    hintEnabled: false,           // the F word-finder key (off by default)
    confirmActions: true,         // confirm before pass/exchange/new game
    advanceCursorOnPlace: true,   // after Shift+N stages a tile, auto-advance the
                                  // cursor to the next empty square (NOTE 5)
    // Canonical AI move delay in MILLISECONDS (integration fix #10): ONE unit,
    // ONE key shared with SC.Game (which reads config.aiMoveDelayMs in ms). The
    // Settings slider shows seconds and converts on read/write. NOTE 3 raised the
    // default 1200->2000 so each computer's spoken move is fully audible before the
    // next player acts (esp. with multiple computers in a row).
    aiMoveDelayMs: 2000,
    playerName: 'You'             // setup-screen name, persisted like the speech settings
  };

  // Read the persisted blob (or null). Defensive: any storage/JSON error yields
  // null so the game still starts with built-in defaults.
  function loadSettingsBlob() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // Persist the CURRENT settings of every owning module as one blob. Called after
  // every individual change (so a crash never loses a setting) and is cheap.
  function saveSettings() {
    try {
      var blob = {
        speech: Speech() ? Speech().getSettings() : null,
        sounds: Sounds() ? Sounds().getSettings() : null,
        ui: uiSettingsSnapshot()
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    } catch (e) {
      // localStorage can be unavailable (private mode / file:// quirks). Failing
      // to persist must never break play, so we swallow the error.
    }
  }

  // Snapshot just the UI-owned settings (those kept on G.config) for the blob.
  function uiSettingsSnapshot() {
    var cfg = G().config || {};
    var out = {};
    for (var k in DEFAULT_UI) {
      if (DEFAULT_UI.hasOwnProperty(k)) {
        out[k] = (cfg[k] !== undefined) ? cfg[k] : DEFAULT_UI[k];
      }
    }
    return out;
  }

  // Restore persisted settings into every module on load (called from init()).
  // Each module restores its OWN slice; the UI slice is merged onto G.config so
  // gameplay code (verbosity, hint toggle, etc.) reads it from one place.
  function restoreSettings() {
    var blob = loadSettingsBlob();

    // Always seed G.config with UI defaults first so missing keys are defined.
    var cfg = G().config = G().config || {};
    for (var k in DEFAULT_UI) {
      if (DEFAULT_UI.hasOwnProperty(k) && cfg[k] === undefined) cfg[k] = DEFAULT_UI[k];
    }

    if (!blob) return;                                 // nothing saved yet

    // Hand each sub-blob to its owner. Speech/Sounds clamp + reflect to their UI.
    if (blob.speech && Speech()) Speech().restoreSettings(blob.speech);
    if (blob.sounds && Sounds()) Sounds().restoreSettings(blob.sounds);
    if (blob.ui) {
      for (var u in blob.ui) {
        if (blob.ui.hasOwnProperty(u) && DEFAULT_UI.hasOwnProperty(u)) {
          cfg[u] = blob.ui[u];
        }
      }
    }
  }

  // Set one UI-owned config flag and immediately persist the whole blob.
  function setUIConfig(key, value) {
    G().config = G().config || {};
    G().config[key] = value;
    saveSettings();
  }

  // ===========================================================================
  // 2. Focus-trapped dialog machinery (shared by ALL overlays)
  // ---------------------------------------------------------------------------
  // Every overlay in index.html is a `.overlay.hidden` wrapper containing a
  // `.dialog[role=dialog][aria-modal=true]`. ARCHITECTURE §3 + INTERFACE_DESIGN
  // §3.3 require each to be focus-trapped, Esc-closable, and to RESTORE focus to
  // wherever it was on close. We implement that ONCE here so every dialog behaves
  // identically (DRY) and SC.Game never needs to special-case dialog focus.
  //
  // Only one dialog is open at a time. `activeDialog` tracks it: the overlay id,
  // the element focus should return to, the per-dialog keydown handler we added
  // (so we can remove it on close), and an optional onClose callback (used by the
  // Composer to recall staged tiles when cancelled).
  // ===========================================================================
  var activeDialog = null;

  // All focusable elements inside a container, in DOM order, skipping disabled /
  // hidden ones. Used to wrap Tab/Shift+Tab focus within the dialog.
  function focusable(container) {
    var sel = 'button, [href], input, select, textarea, ' +
              '[tabindex]:not([tabindex="-1"])';
    var nodes = container.querySelectorAll(sel);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      // offsetParent === null catches display:none / hidden ancestors; disabled
      // controls are not tab stops.
      if (!el.disabled && el.offsetParent !== null) out.push(el);
    }
    return out;
  }

  /*
   * openDialog(overlayId, opts) — reveal an overlay and trap focus inside it.
   *
   * opts:
   *   focus    : element (or id string) to focus first (default: first focusable)
   *   onKey    : optional extra keydown handler (e, dialogEl) -> bool. Return true
   *              to indicate the key was handled (we then stop default/trap logic).
   *              Used by dialogs that bind their own keys (e.g. Composer Tab =
   *              toggle direction, Preview/Exchange number/letter keys).
   *   onClose  : optional callback fired when the dialog closes by ANY path
   *              (Esc, programmatic closeDialog). Used to recall staged tiles.
   *   trapEsc  : if false, Esc is NOT auto-handled here (the dialog's onKey owns
   *              it). Default true: Esc closes via the dialog's documented cancel.
   *   onEsc    : what Esc should call (defaults to plain closeDialog). Lets a
   *              dialog route Esc to its semantic "cancel" (recall tiles etc.).
   */
  function openDialog(overlayId, opts) {
    opts = opts || {};
    var overlay = byId(overlayId);
    if (!overlay) return;

    // If another dialog is somehow open, close it first (single-modal model).
    if (activeDialog) closeDialog();

    var dialog = overlay.querySelector('.dialog') || overlay;

    // Remember where focus was so we can restore it on close (a11y requirement).
    var returnFocus = document.activeElement;

    // The per-dialog keydown handler: Tab trapping + Esc + the dialog's own keys.
    // This is the SINGLE owner of dialog keys (integration fix #1): for every key
    // it CONSUMES (a dialog control key, Tab, or Esc) it calls stopPropagation()
    // so the document-level SC.Game.handleKey never ALSO sees it (no double-fire).
    // Keys it does NOT consume (typed letters/digits/editing in the composer or
    // jump input) are left entirely alone — no preventDefault, no stopPropagation
    // — so the native <input> still receives them and the SR echoes typing.
    var keyHandler = function (e) {
      // Give the dialog's own key map first refusal (it may consume Enter, Tab,
      // letters, digits, B, etc.). If it handles the key, we stop here.
      if (opts.onKey && opts.onKey(e, dialog) === true) {
        e.preventDefault();
        e.stopPropagation();                 // do not let it reach document handleKey
        return;
      }

      if (e.key === 'Tab') {
        // Focus trap: wrap from last->first and first->last so focus never
        // escapes the modal. (Buttons/inputs inside still get native behaviour.)
        e.stopPropagation();                 // Tab is ours; never leak to handleKey
        var items = focusable(dialog);
        if (items.length === 0) { e.preventDefault(); return; }
        var first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
        return;
      }

      if (e.key === 'Escape' && opts.trapEsc !== false) {
        e.preventDefault();
        e.stopPropagation();                 // Esc is ours; never leak to handleKey
        if (opts.onEsc) opts.onEsc(); else closeDialog();
        return;
      }
      // Any other key (typed letter/digit/Backspace/arrows): fall through to the
      // native input untouched so the field edits and the SR echoes characters.
    };

    // Listen on the overlay (capture phase) so we see Tab/Esc before the browser
    // moves focus, while leaving normal typing in inner inputs untouched.
    overlay.addEventListener('keydown', keyHandler, true);

    activeDialog = {
      overlayId: overlayId,
      overlay: overlay,
      returnFocus: returnFocus,
      keyHandler: keyHandler,
      onClose: opts.onClose || null
    };

    overlay.classList.remove('hidden');

    // Move focus inside the dialog. Default to the first focusable control.
    var target = opts.focus;
    if (typeof target === 'string') target = byId(target);
    if (!target) {
      var f = focusable(dialog);
      target = f.length ? f[0] : dialog;
    }
    if (target && target.focus) target.focus();
  }

  /*
   * closeDialog() — hide the active overlay, remove its key handler, run its
   * onClose, and RESTORE focus to where it was when the dialog opened. Safe to
   * call when nothing is open (no-op). This is the single close path every
   * dialog's cancel/confirm funnels through.
   */
  function closeDialog() {
    if (!activeDialog) return;
    var d = activeDialog;
    activeDialog = null;                               // clear first: onClose may reopen

    d.overlay.removeEventListener('keydown', d.keyHandler, true);
    d.overlay.classList.add('hidden');

    if (d.onClose) d.onClose();                        // e.g. recall staged tiles

    // Restore focus to the prior element if it is still in the document and
    // focusable; otherwise fall back to the board so the player isn't stranded.
    var rf = d.returnFocus;
    if (rf && document.contains(rf) && rf.focus) {
      rf.focus();
    } else {
      var board = byId('board');
      if (board && board.focus) board.focus();
    }
  }

  // Is any modal dialog currently open? SC.Game can consult this when deciding
  // how to route a key (though it primarily tracks mode itself).
  function isDialogOpen() { return activeDialog !== null; }

  // The id of the open overlay, or null. Lets SC.Game know WHICH dialog is up.
  function openDialogId() { return activeDialog ? activeDialog.overlayId : null; }

  // Per-overlay "is this specific dialog open?" predicates (integration fix #1):
  // thin sugar over openDialogId() so SC.Game.handleKey can mode-gate by name.
  // These are the public surface SC.Game expects (isComposerOpen, etc.).
  function isComposerOpen() { return openDialogId() === 'composer-overlay'; }
  function isPreviewOpen()  { return openDialogId() === 'preview-overlay'; }
  function isExchangeOpen() { return openDialogId() === 'exchange-overlay'; }
  function isSettingsOpen() { return openDialogId() === 'settings-overlay'; }
  function isHelpOpen()     { return openDialogId() === 'help-overlay'; }

  // ===========================================================================
  // 3. The Rack
  // ---------------------------------------------------------------------------
  // index.html: <ul id="rack" role="list" aria-label="Your rack">. We render up
  // to 7 slots, each an <li> labelled "slot N: <tile>" (INTERFACE_DESIGN §3.2 /
  // §5.2). Clicking a slot announces it (mouse parity for the 1–7 keys). The rack
  // reflects the ACTIVE player's tiles MINUS any tiles currently staged on the
  // board this turn (staged tiles visually/audibly leave the rack until recalled
  // or committed). We compute "tiles still in the rack" by removing pending tile
  // ids from the player's rack list.
  // ===========================================================================

  // The set of tile ids currently staged on the board this turn (so they are not
  // also shown in the rack). Built fresh each render from G.pending.
  function stagedTileIds() {
    var ids = {};
    var pend = S().getPending();
    for (var i = 0; i < pend.length; i++) ids[pend[i].tile.id] = true;
    return ids;
  }

  // The active player's rack tiles that are AVAILABLE (not staged on the board this
  // turn), in rack order. This is the "what can I still use" set — it drives the
  // Inventory readout, the rack value summary, the Composer's letter pool, and the
  // Exchange overlay (you cannot type/exchange a tile that's already staged).
  //
  // NOTE 4: this is NO LONGER the basis for "slot N". Slots are now POSITIONAL —
  // slot N is always player.rack[N-1], whether or not it is staged — so use
  // slotTile(n) for slot-addressed operations (render, announceSlot, placement).
  // Keeping the two concepts separate is what makes a vacated slot stay empty
  // instead of later tiles renumbering into it.
  function visibleRackTiles() {
    var staged = stagedTileIds();
    var rack = activePlayer().rack;
    var out = [];
    for (var i = 0; i < rack.length; i++) {
      if (!staged[rack[i].id]) out.push(rack[i]);
    }
    return out;
  }

  // slotTile(n) — the tile in POSITIONAL rack slot n (1-based), or null if the slot
  // is empty (NOTE 4): no tile at that index, or its tile is currently staged on the
  // board this turn. Mirrors SC.Game.slotTile so screen + keys agree on "slot N".
  function slotTile(n) {
    var rack = activePlayer().rack;
    var t = rack[n - 1];
    if (!t) return null;                               // beyond the rack -> empty
    var staged = stagedTileIds();
    return staged[t.id] ? null : t;                    // staged -> shown empty
  }

  /*
   * renderRack() — rebuild the rack list using POSITIONAL slots (NOTE 4). We iterate
   * the rack by FIXED index: slot N (= rack[N-1]) keeps its place whether or not its
   * tile is staged. A slot whose tile is staged this turn renders as an explicit
   * empty placeholder ("slot N: empty"), so later tiles never shift into it and the
   * 1–7 / Shift+1–7 keys always address the same physical tile. Each <li> is a
   * labelled, focusable list item (arrowable by a screen reader); clicking announces
   * the slot. Data attributes carry the slot index + tile id for click handling.
   */
  function renderRack() {
    var ul = byId('rack');
    if (!ul) return;
    ul.innerHTML = '';

    var rack = activePlayer().rack;
    for (var i = 0; i < rack.length; i++) {
      var slot = i + 1;
      var tile = slotTile(slot);                       // null when staged (empty slot)
      var li = document.createElement('li');
      li.setAttribute('role', 'listitem');
      li.setAttribute('tabindex', '-1');               // focusable on demand, not a tab stop
      li.setAttribute('data-slot', String(slot));      // 1-based slot number
      if (tile) {
        // Class contract (integration fix #8): css/styles.css §9 targets
        // "#rack .tile" (+ ".blank"/".selected"). Add 'tile' (and ' blank') so the
        // stylesheet's tile face applies; keep the legacy names too (harmless).
        li.className = 'tile rack-tile' + (tile.isBlank ? ' blank rack-tile-blank' : '');
        li.setAttribute('data-tile-id', String(tile.id));
        // Full spoken label (slot + tile), e.g. "slot 3: R, 1 point".
        li.setAttribute('aria-label', 'slot ' + slot + ': ' + describeTile(tile));
        // Visible glyph for sighted helpers: the letter (or a box for a blank) and
        // its point value as a small superscript-ish suffix.
        var glyph = tile.isBlank ? (tile.letter || '□') : tile.letter; // □ for empty blank
        li.textContent = glyph + (tile.points ? ' ' + tile.points : '');
      } else {
        // Staged-away (or absent) slot: a held EMPTY placeholder keeps the position.
        li.className = 'tile rack-tile rack-slot-empty';
        li.setAttribute('aria-label', 'slot ' + slot + ': empty');
        li.textContent = '–';
      }
      // Click = announce this slot (mouse users / sighted helpers).
      (function (s) {
        li.addEventListener('click', function () { announceSlot(s); });
      })(slot);
      ul.appendChild(li);
    }

    // A genuinely empty rack (end of game: no tiles at all) still reads sensibly.
    if (rack.length === 0) {
      var empty = document.createElement('li');
      empty.setAttribute('role', 'listitem');          // parity with tile items
      empty.setAttribute('tabindex', '-1');
      empty.setAttribute('aria-label', 'rack empty');
      empty.textContent = '(empty)';
      ul.appendChild(empty);
    }
  }

  /*
   * announceRack() — the I ("Inventory") key. Read the rack by POSITIONAL slot
   * (NOTE 4): each slot 1..N in order, naming its tile or "empty" when its tile is
   * staged on the board this turn, so the spoken inventory matches the rendered
   * rack and the stable slot numbers. The lead count is the number of AVAILABLE
   * (unstaged) tiles — what you can still play. Terse verbosity drops point values.
   */
  function announceRack() {
    var rack = activePlayer().rack;
    if (rack.length === 0) { say('Your rack is empty.'); return; }

    var terse = (G().config && G().config.verbosity === 'terse');
    var avail = 0;
    var parts = [];
    for (var i = 0; i < rack.length; i++) {
      var t = slotTile(i + 1);                          // null when that slot is staged-away
      if (!t) { parts.push('empty'); continue; }
      avail++;
      if (terse) {
        parts.push(t.isBlank ? (t.letter ? 'blank ' + t.letter : 'blank') : t.letter);
      } else {
        parts.push(describeTile(t));
      }
    }
    say(avail + ' tile' + (avail === 1 ? '' : 's') + '. ' + parts.join(', ') + '.');
  }

  /*
   * announceSlot(n) — the 1–7 keys (and rack clicks): announce the tile in POSITIONAL
   * slot n (1-based, NOTE 4). slotTile(n) returns null when the slot is empty — i.e.
   * its tile is staged on the board this turn, or there is no tile at that index — in
   * which case we give a gentle "slot N is empty" with a soft cue (not the harsh edge
   * buzz), matching the placement key's behaviour so a vacated slot reads consistently.
   */
  function announceSlot(n) {
    var tile = slotTile(n);
    if (!tile) {
      cue('ui');                                        // soft cue, not 'edge'
      say('Slot ' + n + ' is empty.');
      return;
    }
    say('Slot ' + n + ': ' + describeTile(tile));
  }

  /*
   * rackValueSummary() — the V key. Total points on the rack, blank count, and
   * the vowel/consonant split (INTERFACE_DESIGN §5.2). A strategic at-a-glance
   * summary spoken in one breath.
   */
  function rackValueSummary() {
    var tiles = visibleRackTiles();
    var total = 0, blanks = 0, vowels = 0, consonants = 0;
    var VOWELS = 'AEIOU';
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      total += t.points;
      if (t.isBlank) {
        blanks++;                                       // a blank is neither V nor C until assigned
      } else if (VOWELS.indexOf(t.letter) >= 0) {
        vowels++;
      } else {
        consonants++;
      }
    }
    var msg = 'Rack value ' + pointWord(total) + '. ' +
              vowels + (vowels === 1 ? ' vowel' : ' vowels') + ', ' +
              consonants + (consonants === 1 ? ' consonant' : ' consonants');
    if (blanks > 0) msg += ', ' + blanks + (blanks === 1 ? ' blank' : ' blanks');
    say(msg + '.');
  }

  /*
   * shuffleRack() — Shift+I. Randomly reorder the ACTIVE player's rack tiles
   * (Fisher–Yates), re-render, and announce the new order. Reordering the rack is
   * a pure presentation change (tile ids are unaffected), but because slot
   * numbers are positional this genuinely changes what "slot N" selects — handy
   * for spotting plays. We shuffle the underlying player's rack array so the new
   * order persists for the rest of the turn.
   */
  function shuffleRack() {
    var rack = activePlayer().rack;
    for (var i = rack.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = rack[i]; rack[i] = rack[j]; rack[j] = tmp;
    }
    cue('exchange');                                    // the riffle/whoosh cue fits a reshuffle
    renderRack();
    announceRack();
  }

  // ===========================================================================
  // 4. The Composer  (type a whole word; INTERFACE_DESIGN §4.2 / §5.4 / §6.1)
  // ---------------------------------------------------------------------------
  // The composer is the primary play method: the player opens it at the cursor in
  // the current direction, types a word, hears a live preview (which letters come
  // from the rack vs the board, whether it fits, and a running score), then
  // presses Enter to go to the Score Preview. Blank syntax: parentheses force a
  // blank, e.g. "C(A)T" makes the A a blank. When a needed letter is not in the
  // rack but a blank is available, the composer uses the blank automatically and
  // says "blank as X" (auto-blank fallback).
  //
  // The composer is a focus-trapped dialog whose Tab key toggles direction (so it
  // is consumed by our onKey rather than moving focus). Enter -> preview; Esc ->
  // cancel and recall any tiles (here, nothing is staged yet, but we keep the
  // contract uniform). The running parse text is written to #composer-preview, an
  // aria-live region wired to the input via aria-describedby.
  // ===========================================================================

  // Composer working state for the current open session.
  var composer = {
    open: false,
    anchor: null,        // {row,col} where the word starts (the cursor square)
    direction: 'across', // 'across' | 'down' (mirrors/feeds G.direction)
    lastParse: null,     // cached parse result (placements/word/messages) for Enter
    // The last input value we ACCEPTED (used by the typing-feedback in
    // onComposerInput to detect a freshly-appended letter and to REVERT the field
    // when that letter can't be placed). Reset to '' each time the composer opens.
    lastAccepted: ''
  };

  /*
   * openComposer() — open the Composer dialog anchored at the board cursor in the
   * current play direction. Resets the field, seeds the direction display, and
   * announces the mode transition ("Composing across from H8").
   */
  function openComposer() {
    var cur = Board() ? Board().getCursor() : Data().CENTER;
    composer.open = true;
    composer.anchor = { row: cur.row, col: cur.col };
    composer.direction = G().direction || 'across';
    composer.lastParse = null;
    composer.lastAccepted = '';                         // fresh session: nothing typed yet

    // Reset the input + live preview before showing.
    var input = byId('composer-input');
    if (input) input.value = '';
    setComposerDirectionLabel();
    setComposerContext();
    writeComposerPreview('Type a word.');

    openDialog('composer-overlay', {
      focus: 'composer-input',
      onKey: composerKey,
      // Esc cancels the composer (recall is a no-op here but keeps the contract).
      onEsc: cancelComposer,
      onClose: function () { composer.open = false; }
    });

    // Announce the transition assertively so it is never missed.
    alertSay('Composing ' + composer.direction + ' from ' +
             Data().coordToString(composer.anchor.row, composer.anchor.col) + '.');
  }

  // The dialog-scoped key map for the Composer (return true = handled). Tab
  // toggles direction (instead of moving focus); Enter goes to Preview; ";" reads
  // the current preview (INTERFACE_DESIGN §5.4). All other keys (A–Z, parens,
  // backspace, caret movement) fall through to the native input.
  function composerKey(e) {
    if (e.key === 'Tab') { toggleComposerDirection(); return true; }
    if (e.key === 'Enter') { composerToPreview(); return true; }
    if (e.key === ';') { readComposerPreview(); return true; }
    return false;                                       // let the input handle it
  }

  // closeComposer() — public close (without the cancel semantics). Used when the
  // composer hands off to the Preview dialog: we hide it but DON'T recall tiles.
  function closeComposer() {
    composer.open = false;
    if (openDialogId() === 'composer-overlay') closeDialog();
  }

  // cancelComposer() — Esc path: discard the typed word, announce, and close.
  // (No tiles are staged from the composer until commit, so there is nothing to
  // recall; the wording matches INTERFACE_DESIGN §5.4 "Cancel, recall tiles".)
  function cancelComposer() {
    composer.open = false;
    say('Cancelled.');
    if (openDialogId() === 'composer-overlay') closeDialog();
  }

  // Reflect composer.direction into the #composer-direction span.
  function setComposerDirectionLabel() {
    var span = byId('composer-direction');
    if (span) span.textContent = composer.direction;
  }

  // Fill #composer-context with the anchor + direction sentence for sighted users
  // and as supplementary SR text.
  function setComposerContext() {
    var p = byId('composer-context');
    if (!p || !composer.anchor) return;
    p.textContent = 'Anchored at ' +
      Data().coordToString(composer.anchor.row, composer.anchor.col) +
      ', playing ' + composer.direction + '.';
  }

  // Write the live preview text into #composer-preview (the aria-live region the
  // input is described by). One place so the format is consistent.
  function writeComposerPreview(text) {
    var el = byId('composer-preview');
    if (el) {
      // Clear-then-set so identical consecutive previews still re-announce (same
      // trick SC.Speech uses for its live regions).
      el.textContent = '';
      el.textContent = text;
    }
  }

  // Read the current preview text aloud (the ";" key) without changing modes.
  function readComposerPreview() {
    var el = byId('composer-preview');
    say(el && el.textContent ? el.textContent : 'No preview yet.');
  }

  /*
   * toggleComposerDirection() — Tab inside the composer flips across<->down,
   * updates the label/context, re-parses the current text against the new axis,
   * and announces the change. Also writes through to G.direction so the rest of
   * the game (cursor, tile-by-tile) shares the choice.
   */
  function toggleComposerDirection() {
    composer.direction = (composer.direction === 'across') ? 'down' : 'across';
    G().direction = composer.direction;
    setComposerDirectionLabel();
    setComposerContext();
    say('Direction ' + composer.direction + '.');
    // Re-run the live parse so the preview reflects the new axis immediately.
    var input = byId('composer-input');
    onComposerInput(input ? input.value : '');
  }

  // ---------------------------------------------------------------------------
  // Composer parsing — the heart of "type a word".
  // ---------------------------------------------------------------------------
  // Given the typed string and the anchor/direction, we walk the board along the
  // axis from the anchor, matching each typed letter to either:
  //   * an EXISTING board tile at that square (the letter must match), or
  //   * a NEW tile drawn from the player's rack (exact letter, or a blank as a
  //     wildcard — auto-blank fallback), with parentheses FORCING a blank.
  // We build the list of NEW Placements (with blanks assigned their letter) plus
  // a human-readable running description. The parse is PURE (it does not stage
  // anything); composerToPreview() is what actually evaluates + opens Preview.
  //
  // Returns:
  //   { ok, placements, word, fits, usesRack, blanksUsed, message, error }
  // ok=false with `error` means the word can't be formed from rack+board (e.g.
  // letter not available, runs off the board, conflicts with a board tile).
  // ---------------------------------------------------------------------------

  // Parse the parenthesis blank-syntax into a flat list of {ch, forceBlank}.
  // "C(A)T" -> [{C,false},{A,true},{T,false}]. Unmatched/empty parens are
  // tolerated (ignored) so partial typing never throws mid-keystroke.
  function parseLetters(raw) {
    var letters = [];
    var force = false;
    var s = (raw || '').toUpperCase();
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '(') { force = true; continue; }
      if (ch === ')') { force = false; continue; }
      if (ch >= 'A' && ch <= 'Z') {
        letters.push({ ch: ch, forceBlank: force });
        // A forced blank applies to the SINGLE letter inside its parens; if the
        // user wrote "(AB)" we treat both as forced, which is harmless.
      }
      // Any other character (digit, space, punctuation) is ignored.
    }
    return letters;
  }

  /*
   * parseComposerWord(raw) — resolve the typed word against board + rack.
   *
   * Strategy mirrors how a sighted player lays tiles: we step square-by-square
   * from the anchor. For each square we need the NEXT typed letter UNLESS the
   * square already holds a tile, in which case that board letter is consumed
   * "for free" and must match the typed letter at that position. Crucially, real
   * Scrabble words can run THROUGH existing tiles, so the typed word includes
   * board letters (INTERFACE_DESIGN §6.1: "BARN ... includes existing board
   * letters"). We therefore advance the typed pointer for every square (board or
   * new) and only DRAW FROM THE RACK for squares that are currently empty.
   */
  function parseComposerWord(raw) {
    var letters = parseLetters(raw);
    var result = {
      ok: false, placements: [], word: '', fits: false,
      usesRack: 0, blanksUsed: 0, message: '', error: null
    };
    if (letters.length === 0) {
      result.message = 'Type a word.';
      return result;
    }

    var Data_ = Data();
    var board = G().board;
    var dr = (composer.direction === 'down') ? 1 : 0;
    var dc = (composer.direction === 'down') ? 0 : 1;

    // A working multiset of the rack tiles available to consume (visible tiles
    // only — staged tiles are gone). We clone to a list and remove as we match so
    // a letter is never used twice. Blanks are tracked separately as wildcards.
    var pool = visibleRackTiles().slice();

    // Helper: pull the first non-blank tile of letter `ch` from the pool. Returns
    // the tile (removed from pool) or null.
    function takeLetter(ch) {
      for (var i = 0; i < pool.length; i++) {
        if (!pool[i].isBlank && pool[i].letter === ch) { return pool.splice(i, 1)[0]; }
      }
      return null;
    }
    // Helper: pull a blank tile from the pool (for wildcard / forced blank).
    function takeBlank() {
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].isBlank) { return pool.splice(i, 1)[0]; }
      }
      return null;
    }

    var r = composer.anchor.row, c = composer.anchor.col;
    var spoken = [];                                    // per-letter narration
    var placements = [];

    for (var li = 0; li < letters.length; li++) {
      // Ran off the edge of the board before consuming all typed letters.
      if (!Data_.inBounds(r, c)) {
        result.error = 'The word runs off the board.';
        result.message = result.error;
        return result;
      }

      var want = letters[li].ch;
      var forceBlank = letters[li].forceBlank;
      var onBoard = board[r][c];

      if (onBoard) {
        // Square already has a committed tile: it is consumed for free, but the
        // typed letter must agree with it (you can't overwrite the board).
        if (onBoard.letter !== want) {
          result.error = 'Conflict at ' + Data_.coordToString(r, c) +
                         ': board has ' + onBoard.letter + ', word needs ' + want + '.';
          result.message = result.error;
          return result;
        }
        spoken.push(want + ' on board');
        // (No placement; no rack draw.)
      } else {
        // Empty square: we must supply a NEW tile from the rack.
        var tile = null;
        var asBlank = false;
        if (forceBlank) {
          // Parentheses: insist on a blank even if the real letter is in the rack.
          tile = takeBlank();
          if (!tile) {
            result.error = 'No blank available for ' + want + '.';
            result.message = result.error;
            return result;
          }
          asBlank = true;
        } else {
          // Prefer the real letter; auto-fall back to a blank as a wildcard.
          tile = takeLetter(want);
          if (!tile) {
            tile = takeBlank();
            if (!tile) {
              result.error = 'You don\'t have ' + want + ' (or a blank) for ' +
                             Data_.coordToString(r, c) + '.';
              result.message = result.error;
              return result;
            }
            asBlank = true;
          }
        }

        // Assign the blank its played letter (Tile contract §2: blank keeps
        // points 0 but carries the letter it represents). CRITICAL: push a COPY
        // carrying the SAME id rather than MUTATING the real rack tile. pool is a
        // shallow slice of the rack, so `tile` IS the player's rack tile; mutating
        // it here (this parser runs on EVERY keystroke and is contracted PURE) left
        // an abandoned-preview rack blank permanently labelled "blank as X" for the
        // screen reader. Keeping the id means commit/removeTileFromRack (by id),
        // visibleRackTiles, stagedTileIds, and toggleBlankInPreview still match.
        if (asBlank) {
          tile = { id: tile.id, letter: want, isBlank: true, points: 0 };
          result.blanksUsed++;
          spoken.push('blank as ' + want);
        } else {
          spoken.push(want + ' from rack');
        }
        placements.push({ row: r, col: c, tile: tile });
        result.usesRack++;
      }

      result.word += want;
      r += dr; c += dc;
    }

    // A play must place at least one NEW tile (otherwise it's just re-reading the
    // board). The full legality (connection, center, contiguity) is checked by
    // SC.Rules at preview time — here we only confirm the word is buildable.
    if (placements.length === 0) {
      result.error = 'That word uses no new tiles — type a word that adds tiles.';
      result.message = result.error;
      return result;
    }

    result.ok = true;
    result.fits = true;
    result.placements = placements;
    // Running description for the live region (terse-aware at call sites). The
    // per-letter narration in `spoken` (e.g. "B from rack") is single letters and
    // stays uppercase; the WHOLE running word is pronounced lowercase ("barn") so
    // the SR doesn't spell it out.
    result.message = spoken.join(', ') + '. ' +
      spokenWord(result.word) + ', uses ' + result.usesRack +
      (result.usesRack === 1 ? ' rack tile' : ' rack tiles') +
      (result.blanksUsed ? ' (' + result.blanksUsed +
        (result.blanksUsed === 1 ? ' blank' : ' blanks') + ')' : '') + '.';
    return result;
  }

  /*
   * onComposerInput(value) — live-preview callback. SC.Game forwards the input's
   * value here on every change (INTERFACE_DESIGN §4.2: announce the running word,
   * rack vs board letters, fit, and a live score). We parse, then if the word is
   * buildable we ask SC.Rules.evaluatePlay for the would-be score and append it.
   * The whole string is written to the aria-live preview region (no extra TTS —
   * the SR echoes typed characters natively; the live region carries the rest).
   */
  // Count the A–Z letters in a string (parentheses/other chars ignored). Used to
  // pick the rising-ding pitch index = position of the just-typed letter.
  function countLetters(s) {
    var n = 0, up = (s || '').toUpperCase();
    for (var i = 0; i < up.length; i++) { var ch = up.charAt(i); if (ch >= 'A' && ch <= 'Z') n++; }
    return n;
  }

  function onComposerInput(value) {
    if (!composer.open) return;

    // ---- Typing-feedback (SET 3a): per-keystroke buzz/ding ------------------
    // Detect a single character freshly APPENDED to the end of what we last
    // accepted (the ordinary "type the next letter" case). We only police that
    // case; deletions, caret edits, and pastes are accepted silently so we never
    // fight the user's editing.
    var prev = composer.lastAccepted || '';
    var isAppend = (value.length === prev.length + 1) &&
                   (value.slice(0, prev.length) === prev);
    var added = isAppend ? value.charAt(value.length - 1) : null;
    var addedIsLetter = !!added && /^[A-Za-z]$/.test(added);

    if (isAppend && addedIsLetter) {
      // Is this newly-typed LETTER placeable at its position (rack tile, blank, or a
      // matching board tile along the line)? parseComposerWord is the authoritative
      // rack/board resolver, so a parse that now FAILS means the just-added letter
      // can't go there -> reject it: buzz and REVERT the field to the prior value.
      var tryParse = parseComposerWord(value);
      if (!tryParse.ok) {
        cue('reject');                                  // brief buzz
        var inputEl = byId('composer-input');
        if (inputEl) inputEl.value = prev;              // revert: drop the bad char
        // Re-show the preview for the (restored) valid prefix, plus why it failed.
        renderComposerPreview(prev);
        writeComposerPreview(parseComposerWord(prev).message +
          ' ' + (tryParse.error || 'That letter can’t go there.'));
        return;                                         // do NOT accept the bad char
      }
      // Valid letter -> "for fun" rising ding: pitch climbs with the letter's
      // position in the word (0-based index of the just-typed letter).
      cue('stage', { index: countLetters(value) - 1 });
    }

    // Accept this value as the new baseline for the next keystroke.
    composer.lastAccepted = value;

    // ---- Live preview (unchanged behaviour) --------------------------------
    renderComposerPreview(value);
  }

  /*
   * renderComposerPreview(value) — parse the value and write the running word /
   * rack-vs-board / fit / live-score line into the composer's aria-live region.
   * Extracted from onComposerInput (DRY) so the buzz/revert path can refresh the
   * preview for the restored prefix without re-running the typing-feedback logic.
   */
  function renderComposerPreview(value) {
    var parse = parseComposerWord(value);
    composer.lastParse = parse;                         // cache for Enter (DRY)

    if (!parse.ok) {
      writeComposerPreview(parse.message);
      return;
    }

    // Score preview via the authoritative evaluator. We pass the composer
    // direction so a single-tile word picks the intended axis (§7.2). We do NOT
    // surface validity errors letter-by-letter beyond the score line — full
    // validation is the Preview dialog's job; here we give the running points so
    // the player can gauge a play while typing.
    var isFirst = isFirstMove();
    var move = Rules().evaluatePlay(G().board, parse.placements, isFirst,
                                    composer.direction);
    var scoreText;
    if (move.valid) {
      scoreText = ' Preview ' + pointWord(move.score) +
                  (move.isBingo ? '. Bingo!' : '.');
    } else {
      // Show the would-be score even when invalid (friendly UX per §7.3).
      scoreText = ' Would score ' + pointWord(move.score) +
                  ', but ' + (move.reason || 'not a legal play') + '';
    }
    writeComposerPreview(parse.message + scoreText);
  }

  /*
   * composerToPreview() — Enter in the composer. Re-parse (using the cached parse
   * when current) and, if the word is buildable, evaluate it and hand off to the
   * Score Preview dialog. If it isn't buildable, we keep the composer open and
   * announce the problem (so the player can fix the word).
   */
  function composerToPreview() {
    var input = byId('composer-input');
    var parse = parseComposerWord(input ? input.value : '');
    if (!parse.ok) {
      cue('invalid');
      alertSay(parse.error || parse.message);
      writeComposerPreview(parse.message);
      return;
    }

    // Evaluate the play in full (geometry + dictionary) for the Preview dialog.
    var move = Rules().evaluatePlay(G().board, parse.placements, isFirstMove(),
                                    composer.direction);

    // Carry the parse's placements onto the move so commit/preview narration can
    // reflect blank assignments etc. (evaluatePlay already copies placements, but
    // we keep ours as the canonical staged set.)
    move.placements = parse.placements;

    // Hand off: hide the composer (no recall) and open the Preview on this move.
    closeComposer();
    showPreview(move);
  }

  // Is this the opening play (board empty)? Reused by composer + tile-by-tile.
  function isFirstMove() {
    var board = G().board;
    for (var r = 0; r < Data().BOARD_SIZE; r++) {
      for (var c = 0; c < Data().BOARD_SIZE; c++) {
        if (board[r][c]) return false;
      }
    }
    return true;
  }

  // ===========================================================================
  // 5. Score Preview / Confirm  (INTERFACE_DESIGN §5.5 / §6.3)
  // ---------------------------------------------------------------------------
  // Shows the main word (spelled + valid/invalid), every cross-word (each
  // validated), premiums triggered, the bingo notice, and the total. Enter
  // commits (only if valid — illegal plays cannot be committed, §6.3); B toggles
  // which qualifying tile is the blank when the play is ambiguous; Esc goes back.
  //
  // The preview can be reached two ways: from the Composer (move built from typed
  // word) OR from tile-by-tile placement via SC.Game (move built from G.pending).
  // Either way showPreview(move) takes a fully-evaluated Move and SC.Game's
  // commit path does the actual board mutation + draw on confirm.
  // ===========================================================================

  var preview = { move: null };

  /*
   * showPreview(move) — render and open the Score Preview for a Move. Builds the
   * spoken/visible description, then opens the focus-trapped dialog. The Commit
   * button is disabled when the move is invalid so it literally cannot be
   * committed (the controller also guards, but disabling makes it obvious to all
   * input methods).
   */
  function showPreview(move) {
    preview.move = move;
    var text = describeMove(move);

    var el = byId('preview-text');
    if (el) { el.innerHTML = ''; el.textContent = text; }

    // Enable/disable Commit by validity; toggle-blank only when ≥1 blank is in
    // play (otherwise there is nothing to reassign).
    var commitBtn = byId('preview-commit');
    if (commitBtn) commitBtn.disabled = !move.valid;
    var blankBtn = byId('preview-blank');
    if (blankBtn) blankBtn.disabled = !hasBlankPlacement(move);

    openDialog('preview-overlay', {
      focus: move.valid ? 'preview-commit' : 'preview-cancel',
      onKey: previewKey,
      onEsc: cancelPreview
    });

    // Cue + speak the result. Valid -> validWord chime; invalid -> error buzz.
    cue(move.valid ? 'validWord' : 'invalid');
    if (move.valid) say(text); else alertSay(text);
  }

  // Does the move place at least one blank tile? (Drives the B toggle button.)
  function hasBlankPlacement(move) {
    var p = move && move.placements;
    if (!p) return false;
    for (var i = 0; i < p.length; i++) if (p[i].tile.isBlank) return true;
    return false;
  }

  // Dialog-scoped keys for the Preview (return true = handled). Enter commits; B
  // toggles the blank; Esc is handled by the trap (-> cancelPreview).
  function previewKey(e) {
    if (e.key === 'Enter') { commitFromPreview(); return true; }
    if (e.key === 'b' || e.key === 'B') { toggleBlankInPreview(); return true; }
    return false;
  }

  /*
   * describeMove(move) — the spoken/visible Score Preview text (INTERFACE_DESIGN
   * §6.3). Format, e.g.:
   *   "BARN across H8 to H11. B A R N. Valid. Also forms: AN, NO. 12 points.
   *    Press Enter to commit."
   * Invalid plays state the offending word and that commit is blocked.
   */
  function describeMove(move) {
    if (!move) return 'No play to preview.';
    var Data_ = Data();
    var terse = (G().config && G().config.verbosity === 'terse');

    // Coordinate span of the main word (start -> end cell).
    var span = '';
    if (move.mainWord && move.mainWord.cells.length) {
      var cells = move.mainWord.cells;
      var a = cells[0], b = cells[cells.length - 1];
      span = ' ' + move.dir + ' ' + Data_.coordToString(a.row, a.col) +
             ' to ' + Data_.coordToString(b.row, b.col);
    }

    var parts = [];
    // Pronounce the main word lowercase ("barn"); the spelled-out copy below stays
    // uppercase so the user hears both "barn" and "B A R N".
    parts.push((move.word ? spokenWord(move.word) : '(no word)') + span + '.');

    if (!terse && move.word) {
      // Spelled-out main word for unambiguous reading — MUST stay uppercase letters.
      parts.push(move.word.split('').join(' ') + '.');
    }

    if (move.valid) {
      parts.push('Valid.');
      // Cross-words formed (each is already dictionary-valid since the move is).
      if (move.crossWords && move.crossWords.length) {
        var cw = [];
        // Pronounce each cross-word lowercase.
        for (var i = 0; i < move.crossWords.length; i++) cw.push(spokenWord(move.crossWords[i].word));
        parts.push('Also forms: ' + cw.join(', ') + '.');
      } else if (!terse) {
        parts.push('Also forms: none.');
      }
      if (move.isBingo) parts.push('Bingo! All seven tiles.');
      parts.push(pointWord(move.score) + '.');
      parts.push('Press Enter to commit.');
    } else {
      // Invalid: report would-be score + the reason, and that commit is blocked.
      parts.push('Invalid. ' + (move.reason || 'Not a legal play.'));
      if (move.score) parts.push('Would have scored ' + pointWord(move.score) + '.');
      parts.push('Press Escape to edit.');
    }
    return parts.join(' ');
  }

  /*
   * commitFromPreview() — Enter on a VALID preview. Delegates the actual commit
   * (board mutation, scoring application, drawing replacement tiles, advancing
   * the turn) to SC.Game.commitPlay, which owns turn flow. We refuse to commit an
   * invalid move (defence in depth; the button is also disabled). On success we
   * close the dialog; SC.Game announces the result + re-renders.
   */
  function commitFromPreview() {
    var move = preview.move;
    if (!move) return;
    if (!move.valid) {
      cue('invalid');
      alertSay('That play is not legal and cannot be committed. ' +
               (move.reason || ''));
      return;
    }
    closeDialog();                                      // close Preview first (restores focus)
    if (Game() && Game().commitPlay) {
      Game().commitPlay(move);                          // controller does the rest
    }
    preview.move = null;
  }

  /*
   * toggleBlankInPreview() — B in the preview (INTERFACE_DESIGN §5.5). When the
   * play uses a blank for a letter that the player ALSO holds as a real tile,
   * this swaps which physical tile fills that square (real tile <-> blank). It
   * changes the SCORE (the real tile scores its face value; the blank scores 0),
   * so after swapping we re-evaluate and re-render the preview.
   *
   * We cycle through the blank placements: for each blank-as-X, if the rack still
   * holds a real X, swap to it; otherwise (a real tile was previously swapped in)
   * swap back to the blank. This gives the player a simple B-to-cycle behaviour.
   */
  function toggleBlankInPreview() {
    var move = preview.move;
    if (!move || !move.placements) return;

    // Build the candidate pool from rack tiles that are NOT already used in THIS
    // move's placements. Critical for the Composer path: composer placements are
    // built directly into move.placements and are never added to G.pending, so a
    // plain visibleRackTiles() would still INCLUDE those very tiles — letting the
    // swap pick a tile that is already on the board (corrupting placements so two
    // squares share one tile object). Excluding the placement tile ids prevents
    // that for both the composer and tile-by-tile (pending) paths.
    var usedIds = {};
    for (var u = 0; u < move.placements.length; u++) usedIds[move.placements[u].tile.id] = true;
    var pool = [];
    var vis = visibleRackTiles();
    for (var v = 0; v < vis.length; v++) if (!usedIds[vis[v].id]) pool.push(vis[v]);

    var swapped = false;

    for (var i = 0; i < move.placements.length && !swapped; i++) {
      var pl = move.placements[i];
      var tile = pl.tile;
      if (tile.isBlank) {
        // Try to replace this blank with a real tile of the same letter.
        for (var j = 0; j < pool.length; j++) {
          if (!pool[j].isBlank && pool[j].letter === tile.letter) {
            // Return the blank to "unassigned" and stage the real tile instead.
            var real = pool[j];
            // Reset the freed blank so it can be reused elsewhere/redrawn.
            tile.letter = null; tile.points = 0;
            pl.tile = real;                             // the square now holds the real tile
            swapped = true;
            say('Using your real ' + real.letter + ' instead of the blank.');
            break;
          }
        }
      } else {
        // This square currently holds a real tile; if we have a spare blank, swap
        // back to it (letting the player choose the blank again). Stage a COPY of
        // the spare blank (same id) rather than MUTATING the real rack tile: if the
        // player then cancels the preview (cancelPreview resets nothing), the real
        // spare blank stays unassigned instead of being left as "blank as X". Commit
        // still removes the right tile (removeTileFromRack matches by id).
        for (var k = 0; k < pool.length; k++) {
          if (pool[k].isBlank) {
            pl.tile = { id: pool[k].id, letter: tile.letter, isBlank: true, points: 0 };
            swapped = true;
            say('Using a blank as ' + pl.tile.letter + '.');
            break;
          }
        }
      }
    }

    if (!swapped) { say('No ambiguous tile to toggle.'); return; }

    // Re-evaluate the play with the new tile assignment and refresh the preview.
    var move2 = Rules().evaluatePlay(G().board, move.placements, isFirstMove(),
                                     move.dir);
    move2.placements = move.placements;
    preview.move = move2;
    var el = byId('preview-text');
    if (el) { el.textContent = describeMove(move2); }
    var commitBtn = byId('preview-commit');
    if (commitBtn) commitBtn.disabled = !move2.valid;
  }

  /*
   * cancelPreview() — Esc / Back on the preview (INTERFACE_DESIGN §5.5: "Back to
   * editing the word"). If the preview came from the composer we cannot easily
   * re-open it with the same text (the composer was closed), so we simply close
   * the preview and return the player to navigation; they can reopen the composer
   * with Space/Enter. Tiles were never staged from the composer, so nothing to
   * recall. (For tile-by-tile previews, SC.Game keeps G.pending intact, so the
   * staged tiles remain on the board for further editing.)
   */
  function cancelPreview() {
    preview.move = null;
    say('Back.');
    if (openDialogId() === 'preview-overlay') closeDialog();
  }

  // ===========================================================================
  // 6. Exchange  (INTERFACE_DESIGN §5.6 / §6.5)
  // ---------------------------------------------------------------------------
  // Mark tiles (1–7) to swap back into the bag for new ones. Needs ≥7 tiles in
  // the bag (standard rule). Enter confirms; Esc cancels. We render the rack as a
  // list of toggle buttons (mouse parity) and SC.Game forwards the 1–7 keys to
  // toggleExchangeTile(n). The actual bag swap + redraw is SC.Game.exchange.
  // ===========================================================================

  var exchange = { selected: {} };   // map: slotIndex(1-based) -> tileId

  /*
   * openExchange() — open the Exchange dialog. If the bag has fewer than 7 tiles,
   * exchanging is illegal, so we refuse with an explanation rather than opening.
   */
  function openExchange() {
    if (S().bagCount() < 7) {
      cue('invalid');
      alertSay('You can only exchange when at least seven tiles are in the bag. ' +
               S().bagCount() + ' left.');
      return;
    }
    exchange.selected = {};
    renderExchangeBody();
    openDialog('exchange-overlay', {
      focus: firstExchangeButtonId(),
      onKey: exchangeKey,
      onEsc: cancelExchange
    });
    say('Exchange. Press 1 to 7 to mark tiles, then Enter to confirm.');
  }

  // Build #exchange-body: one toggle button per visible rack tile, labelled with
  // slot + tile + selection state. Rebuilt whenever a selection changes so the
  // labels stay accurate for the screen reader.
  function renderExchangeBody() {
    var body = byId('exchange-body');
    if (!body) return;
    body.innerHTML = '';
    var tiles = visibleRackTiles();
    if (tiles.length === 0) {
      body.textContent = 'Your rack is empty.';
      return;
    }
    var ul = document.createElement('ul');
    ul.setAttribute('role', 'list');
    ul.className = 'exchange-list';
    for (var i = 0; i < tiles.length; i++) {
      var slot = i + 1;
      var tile = tiles[i];
      var chosen = !!exchange.selected[slot];
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'exchange-tile-' + slot;
      // Class contract (integration fix #8): css/styles.css §11 targets
      // "#exchange-body .tile" (+ ".selected"/".blank"). Add 'tile' so the
      // stylesheet applies; keep the legacy 'exchange-tile' name too (harmless).
      btn.className = 'tile exchange-tile' +
                     (tile.isBlank ? ' blank' : '') + (chosen ? ' selected' : '');
      btn.setAttribute('aria-pressed', chosen ? 'true' : 'false');
      btn.setAttribute('aria-label',
        'slot ' + slot + ': ' + describeTile(tile) +
        (chosen ? ', selected for exchange' : ''));
      btn.textContent = (tile.isBlank ? (tile.letter || '□') : tile.letter) +
                        (chosen ? ' ✓' : '');     // ✓ when selected
      (function (s) {
        btn.addEventListener('click', function () { toggleExchangeTile(s); });
      })(slot);
      li.appendChild(btn);
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  // The id of the first exchange toggle button (for initial focus), or the
  // confirm button if the rack is empty.
  function firstExchangeButtonId() {
    return visibleRackTiles().length ? 'exchange-tile-1' : 'exchange-confirm';
  }

  // Dialog keys for Exchange: Enter confirms; Esc handled by trap; digits 1–7 are
  // forwarded by SC.Game to toggleExchangeTile, but we ALSO accept them here so
  // the dialog works even if focus is on a button (defence in depth).
  function exchangeKey(e) {
    if (e.key === 'Enter') { confirmExchange(); return true; }
    if (e.key >= '1' && e.key <= '7') { toggleExchangeTile(parseInt(e.key, 10)); return true; }
    return false;
  }

  /*
   * toggleExchangeTile(n) — flip slot n's selection (1-based). Re-renders the
   * body so labels/aria-pressed update, and announces the new state. Out-of-range
   * slots buzz.
   */
  function toggleExchangeTile(n) {
    var tiles = visibleRackTiles();
    if (n < 1 || n > tiles.length) { cue('edge'); return; }
    var tile = tiles[n - 1];
    if (exchange.selected[n]) {
      delete exchange.selected[n];
      say('Slot ' + n + ' deselected.');
    } else {
      exchange.selected[n] = tile.id;
      say('Slot ' + n + ' selected: ' + describeTile(tile) + '.');
    }
    renderExchangeBody();
    cue('ui');
    // Keep focus on the (re-rendered) toggled button so repeated toggling works.
    var btn = byId('exchange-tile-' + n);
    if (btn) btn.focus();
  }

  /*
   * confirmExchange() — Enter. Gather the selected tiles and delegate the swap to
   * SC.Game.exchange (which returns them to the bag, draws replacements, advances
   * the turn). Requires ≥1 selected tile and ≥7 in the bag (re-checked).
   */
  function confirmExchange() {
    var ids = [];
    for (var slot in exchange.selected) {
      if (exchange.selected.hasOwnProperty(slot)) ids.push(exchange.selected[slot]);
    }
    if (ids.length === 0) {
      cue('invalid');
      alertSay('Select at least one tile to exchange, or press Escape to cancel.');
      return;
    }
    if (S().bagCount() < 7) {
      cue('invalid');
      alertSay('Not enough tiles in the bag to exchange.');
      return;
    }

    // Resolve the selected tile ids to the actual Tile objects from the rack.
    var rack = activePlayer().rack;
    var tiles = [];
    for (var i = 0; i < rack.length; i++) {
      for (var j = 0; j < ids.length; j++) {
        if (rack[i].id === ids[j]) { tiles.push(rack[i]); break; }
      }
    }

    closeDialog();
    if (Game() && Game().exchange) Game().exchange(tiles);   // controller does the swap
  }

  // cancelExchange() — Esc. Discard the selection and close.
  function cancelExchange() {
    exchange.selected = {};
    say('Exchange cancelled.');
    if (openDialogId() === 'exchange-overlay') closeDialog();
  }

  // ===========================================================================
  // 7. Settings dialog  (INTERFACE_DESIGN §7 — exhaustive, all persisted)
  // ---------------------------------------------------------------------------
  // We build the controls programmatically into #settings-body so the wiring +
  // persistence is centralised. Each control is bound to its owning module
  // (SC.Speech / SC.Sounds) or to G.config (UI flags) and PERSISTS TO localStorage
  // on EVERY change (the single "scrabble-settings" blob). On open we sync each
  // control to the current live value so the dialog always shows reality.
  //
  // To stay DRY we declare the settings as DATA (a small schema) and a tiny set
  // of factory helpers turn each entry into a labelled control + change handler.
  // ===========================================================================

  // Build (once) and open the Settings dialog.
  function openSettings() {
    buildSettingsBody();                                // (re)build to reflect live values
    openDialog('settings-overlay', {
      onEsc: closeSettings
    });
    say('Settings.');
  }

  function closeSettings() {
    if (openDialogId() === 'settings-overlay') closeDialog();
  }

  // ---- Small DOM factories for settings rows (DRY) --------------------------

  // A labelled wrapper <div class="setting-row"> with the control inside.
  function settingRow(labelText, control, controlId) {
    var row = document.createElement('div');
    row.className = 'setting-row';
    var label = document.createElement('label');
    label.textContent = labelText + ' ';
    if (controlId) label.setAttribute('for', controlId);
    // Checkboxes read best with the control BEFORE the text; others after.
    if (control.type === 'checkbox') {
      label.textContent = ' ' + labelText;
      label.insertBefore(control, label.firstChild);
      row.appendChild(label);
    } else {
      row.appendChild(label);
      row.appendChild(control);
    }
    return row;
  }

  // A checkbox bound to getter/setter, persisting on change.
  function makeCheckbox(id, labelText, get, set) {
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!get();
    input.addEventListener('change', function () {
      set(input.checked);
      saveSettings();
      cue('ui');
    });
    return settingRow(labelText, input, id);
  }

  // A <select> bound to options [{value,label}], getter/setter, persisting.
  function makeSelect(id, labelText, options, get, set) {
    var select = document.createElement('select');
    select.id = id;
    for (var i = 0; i < options.length; i++) {
      var opt = document.createElement('option');
      opt.value = options[i].value;
      opt.textContent = options[i].label;
      select.appendChild(opt);
    }
    select.value = get();
    select.addEventListener('change', function () {
      set(select.value);
      saveSettings();
      cue('ui');
    });
    return settingRow(labelText, select, id);
  }

  // A range slider bound to getter/setter, with a live numeric readout, persisting.
  function makeRange(id, labelText, min, max, step, get, set, format) {
    var wrap = document.createElement('div');
    wrap.className = 'setting-row';
    var label = document.createElement('label');
    label.setAttribute('for', id);
    var readoutId = id + '-value';
    var fmt = format || function (v) { return String(v); };
    label.textContent = labelText + ' ';
    var readout = document.createElement('span');
    readout.id = readoutId;
    readout.textContent = fmt(get());
    label.appendChild(readout);

    var input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(get());
    input.setAttribute('aria-describedby', readoutId);
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      set(v);
      readout.textContent = fmt(v);
      saveSettings();
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  // A small section heading inside the settings body.
  function settingsHeading(text) {
    var h = document.createElement('h3');
    h.textContent = text;
    return h;
  }

  // Convenience getters/setters for UI-owned config flags (read default-aware).
  function cfg(key) {
    var v = G().config ? G().config[key] : undefined;
    return (v === undefined) ? DEFAULT_UI[key] : v;
  }

  /*
   * buildSettingsBody() — construct every settings control, grouped by section
   * (Speech / Sound / Announcements / Gameplay / Data), each wired to its owning
   * module and persisting on change. Rebuilt on each open so it always mirrors the
   * current live values (e.g. the speech rate changed via the -/= keys).
   */
  function buildSettingsBody() {
    var body = byId('settings-body');
    if (!body) return;
    body.innerHTML = '';

    var Sp = Speech(), So = Sounds();

    // ---- Speech (§7.1) ------------------------------------------------------
    body.appendChild(settingsHeading('Speech'));

    // Voice <select>: SC.Speech owns the option list; we create the element and
    // let populateVoiceSelect fill it, then bind change -> setVoice + persist.
    var voiceRow = document.createElement('div');
    voiceRow.className = 'setting-row';
    var voiceLabel = document.createElement('label');
    voiceLabel.setAttribute('for', 'settings-voice-select');
    voiceLabel.textContent = 'Voice ';
    var voiceSelect = document.createElement('select');
    voiceSelect.id = 'settings-voice-select';
    voiceRow.appendChild(voiceLabel);
    voiceRow.appendChild(voiceSelect);
    body.appendChild(voiceRow);
    if (Sp) {
      Sp.populateVoiceSelect('settings-voice-select');  // fills + selects current
      voiceSelect.addEventListener('change', function () {
        Sp.setVoice(voiceSelect.value);
        saveSettings();
      });
    }

    // Speech rate (0.5–6.0; default 2.5) — bound to Speech.getRate/setRate.
    if (Sp) {
      body.appendChild(makeRange('settings-rate', 'Speech rate ', 0.5, 6, 0.1,
        function () { return Sp.getRate(); },
        function (v) { Sp.setRate(v); },
        function (v) { return v.toFixed(1); }));
    }

    // Voice (TTS) on/off + ARIA on/off (independent). These call the toggles only
    // when the desired state differs, so the control sets an ABSOLUTE state.
    if (Sp) {
      body.appendChild(makeCheckbox('settings-voice-enabled', 'Voice (text to speech)',
        function () { return Sp.isVoiceEnabled(); },
        function (on) { if (Sp.isVoiceEnabled() !== on) Sp.toggleVoice(); }));
      body.appendChild(makeCheckbox('settings-aria-enabled', 'Screen-reader announcements (ARIA)',
        function () { return Sp.isAriaEnabled(); },
        function (on) { if (Sp.isAriaEnabled() !== on) Sp.toggleAria(); }));
    }

    // NATO phonetic spelling: Off / On-demand / Always (Speech.setNatoMode). We
    // keep the chosen mode in G.config too so it round-trips in our blob via
    // Speech.getSettings (which already serialises natoMode).
    if (Sp) {
      body.appendChild(makeSelect('settings-nato', 'NATO phonetic spelling',
        [{ value: 'off', label: 'Off' },
         { value: 'demand', label: 'On demand' },
         { value: 'always', label: 'Always' }],
        function () {
          var s = Sp.getSettings();
          return s.natoMode || 'off';
        },
        function (v) { Sp.setNatoMode(v); }));
    }

    // Verbosity (UI-owned): Terse / Normal / Verbose.
    body.appendChild(makeSelect('settings-verbosity', 'Verbosity',
      [{ value: 'terse', label: 'Terse' },
       { value: 'normal', label: 'Normal' },
       { value: 'verbose', label: 'Verbose' }],
      function () { return cfg('verbosity'); },
      function (v) { setUIConfig('verbosity', v); }));

    // ---- Sound (§7.2) -------------------------------------------------------
    body.appendChild(settingsHeading('Sound'));
    if (So) {
      body.appendChild(makeCheckbox('settings-sound-enabled', 'Sound effects',
        function () { return So.isEnabled(); },
        function (on) { So.setEnabled(on); }));
      body.appendChild(makeRange('settings-volume', 'Master volume ', 0, 1, 0.05,
        function () {
          var s = So.getSettings(); return (s.volume != null) ? s.volume : 1;
        },
        function (v) { So.setVolume(v); },
        function (v) { return Math.round(v * 100) + '%'; }));
      body.appendChild(makeCheckbox('settings-spatial', 'Spatial audio (pan by column, pitch by row)',
        function () {
          var s = So.getSettings(); return !!s.spatial;
        },
        function (on) { So.setSpatial(on); }));
    }
    // Audio score counter (UI-owned flag; SC.Game reads it when a play scores).
    body.appendChild(makeCheckbox('settings-score-counter', 'Audio score counter',
      function () { return cfg('audioScoreCounter'); },
      function (on) { setUIConfig('audioScoreCounter', on); }));

    // ---- Announcements / Verbosity (§7.3) -----------------------------------
    body.appendChild(settingsHeading('Announcements'));
    body.appendChild(makeCheckbox('settings-announce-premium', 'Announce premium squares while navigating',
      function () { return cfg('announcePremium'); },
      function (on) { setUIConfig('announcePremium', on); }));
    body.appendChild(makeCheckbox('settings-announce-coords', 'Announce coordinates while navigating',
      function () { return cfg('announceCoords'); },
      function (on) { setUIConfig('announceCoords', on); }));
    body.appendChild(makeCheckbox('settings-auto-opponent', "Auto-read opponent's play",
      function () { return cfg('autoReadOpponent'); },
      function (on) { setUIConfig('autoReadOpponent', on); }));
    body.appendChild(makeCheckbox('settings-auto-board', 'Auto-read board after each turn',
      function () { return cfg('autoReadBoard'); },
      function (on) { setUIConfig('autoReadBoard', on); }));

    // ---- Gameplay (§7.4) ----------------------------------------------------
    body.appendChild(settingsHeading('Gameplay'));
    // The slider shows SECONDS but the canonical stored value is MILLISECONDS
    // (integration fix #10): get converts ms->s for display; set converts s->ms.
    body.appendChild(makeRange('settings-ai-delay', 'Computer move delay ', 0, 5, 0.5,
      function () { return cfg('aiMoveDelayMs') / 1000; },
      function (v) { setUIConfig('aiMoveDelayMs', Math.round(v * 1000)); },
      function (v) { return v.toFixed(1) + ' s'; }));
    body.appendChild(makeCheckbox('settings-hint', 'Word-finder / hint key (F)',
      function () { return cfg('hintEnabled'); },
      function (on) { setUIConfig('hintEnabled', on); }));
    body.appendChild(makeCheckbox('settings-advance-cursor', 'Advance cursor after placing a tile',
      function () { return cfg('advanceCursorOnPlace'); },
      function (on) { setUIConfig('advanceCursorOnPlace', on); }));
    body.appendChild(makeCheckbox('settings-confirm', 'Confirm before pass / exchange / new game',
      function () { return cfg('confirmActions'); },
      function (on) { setUIConfig('confirmActions', on); }));

    // ---- Data (§7.5) --------------------------------------------------------
    body.appendChild(settingsHeading('Data'));
    // Reset all settings: clear the blob, restore module defaults, rebuild.
    var resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.id = 'settings-reset';
    resetBtn.textContent = 'Reset all settings';
    resetBtn.addEventListener('click', resetAllSettings);
    body.appendChild(resetBtn);
  }

  /*
   * resetAllSettings() — wipe the persisted blob and restore defaults. We remove
   * the storage key, then re-seed G.config with DEFAULT_UI and ask Speech/Sounds
   * to restore THEIR defaults by handing them empty restore (each clamps/sets its
   * own baseline). Simplest robust approach: clear key, reset UI config, re-save,
   * rebuild the dialog. Speech/Sounds keep their current live state (resetting
   * them mid-session would need a reload to re-init voices), which we note to the
   * player.
   */
  function resetAllSettings() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    // Reset UI-owned flags to defaults.
    G().config = G().config || {};
    for (var k in DEFAULT_UI) {
      if (DEFAULT_UI.hasOwnProperty(k)) G().config[k] = DEFAULT_UI[k];
    }
    saveSettings();
    buildSettingsBody();
    say('Settings reset to defaults.');
  }

  // ===========================================================================
  // 8. Help dialog  (fills #help-body from the INTERFACE_DESIGN keymap)
  // ---------------------------------------------------------------------------
  // We render the keyboard reference as accessible <table>s grouped by section,
  // built from a data model so it stays DRY and easy to keep in sync with
  // INTERFACE_DESIGN §5. showHelp builds (once) + opens; hideHelp closes.
  // ===========================================================================

  // The keymap as data: [sectionTitle, [[keys, action], ...]]. Mirrors
  // INTERFACE_DESIGN §5 (with the user's VIM-style HJKL movement choice).
  var HELP_SECTIONS = [
    ['Movement', [
      ['Arrow keys or H / J / K / L', 'Move cursor left / down / up / right (VIM-style)'],
      ['G', 'Go to a coordinate (e.g. H8) or "center"'],
      ['[ / ]', 'Jump to previous / next anchor (a square you can connect to)'],
      ['Shift+[ / Shift+]', 'Jump to previous / next premium square']
    ]],
    ['Reading & Information', [
      ['C', 'Read the current square in detail'],
      ['W', 'Read the word(s) running through the cursor'],
      ['Shift+H / Shift+L', 'Read the entire current row'],
      ['Shift+J / Shift+K', 'Read the entire current column'],
      ['B', 'Read the board (occupied squares only, character by character)'],
      ['Shift+B', 'Read every word on the board (with start square and direction)'],
      ['I', 'Read your rack (Inventory)'],
      ['1 – 7', 'Announce the tile in rack slot 1 – 7'],
      ['V', 'Rack value: total points, vowels, consonants, blanks'],
      ['S', 'Status: scores, whose turn, turn number, tiles in bag'],
      ['T', 'Tiles remaining: bag count and unseen-letter breakdown'],
      ['M', 'Move history (most recent first)'],
      ['Shift+M', "Read only the most recent round (opponents' moves since your last turn)"],
      ['R', 'Repeat the last spoken announcement']
    ]],
    ['Actions', [
      ['Space or Enter', 'Commit staged tiles, or open the Composer at the cursor'],
      ['D', 'Toggle play direction (across / down)'],
      ['X', 'Exchange tiles'],
      ['P', 'Pass the turn'],
      ['Shift+I', 'Shuffle the rack order'],
      ['F', 'Find a play (word-finder / hint — off by default)'],
      ['N', 'New game']
    ]],
    ['Tile-by-tile placement', [
      ['Shift+1 – Shift+7', 'Place the tile in rack slot 1 – 7 on the current square'],
      ['U', 'Undo the last staged tile (pick it back up)'],
      ['Shift+U', 'Pick up all tiles staged this turn'],
      ['Y', 'Verify the staged play: words, validity, and score so far']
    ]],
    ['Composer (typing a word)', [
      ['A – Z', 'Type the word (rack/board letters resolved automatically)'],
      ['( letter )', 'Force a blank for that letter, e.g. C(A)T'],
      ['Tab', 'Toggle Across / Down'],
      ['Enter', 'Go to Score Preview'],
      [';', 'Read the current preview text'],
      ['Esc', 'Cancel and recall tiles']
    ]],
    ['Score Preview', [
      ['Enter', 'Commit the play'],
      ['B', 'Toggle which qualifying tile is the blank'],
      ['Esc', 'Back to editing']
    ]],
    ['Exchange', [
      ['1 – 7 (or click)', 'Toggle which tiles to exchange'],
      ['Enter', 'Confirm (needs 7+ tiles in the bag)'],
      ['Esc', 'Cancel']
    ]],
    ['Global / System', [
      ['?', 'Help'],
      ['/', 'Settings'],
      ['Esc', 'Stop speech / cancel / close overlay'],
      ['- / =', 'Speech rate down / up'],
      ['Shift+V', 'Toggle Voice (text to speech)'],
      ['Shift+A', 'Toggle ARIA announcements'],
      ['Shift+S', 'Toggle sound effects']
    ]]
  ];

  // Build the help body from HELP_SECTIONS (one accessible table per section).
  function buildHelpBody() {
    var body = byId('help-body');
    if (!body) return;
    body.innerHTML = '';
    for (var s = 0; s < HELP_SECTIONS.length; s++) {
      var section = HELP_SECTIONS[s];
      var h = document.createElement('h3');
      h.textContent = section[0];
      body.appendChild(h);

      var table = document.createElement('table');
      table.className = 'help-table';
      // Header row gives the columns programmatic names for the screen reader.
      var thead = document.createElement('thead');
      var hr = document.createElement('tr');
      var thK = document.createElement('th'); thK.scope = 'col'; thK.textContent = 'Key';
      var thA = document.createElement('th'); thA.scope = 'col'; thA.textContent = 'Action';
      hr.appendChild(thK); hr.appendChild(thA); thead.appendChild(hr); table.appendChild(thead);

      var tbody = document.createElement('tbody');
      var rows = section[1];
      for (var r = 0; r < rows.length; r++) {
        var tr = document.createElement('tr');
        var tdK = document.createElement('td');
        var kbd = document.createElement('kbd'); kbd.textContent = rows[r][0];
        tdK.appendChild(kbd);
        var tdA = document.createElement('td'); tdA.textContent = rows[r][1];
        tr.appendChild(tdK); tr.appendChild(tdA); tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      body.appendChild(table);
    }
  }

  // showHelp() — build (idempotent) + open the focus-trapped Help dialog.
  function showHelp() {
    buildHelpBody();
    openDialog('help-overlay', { onEsc: hideHelp });
    say('Keyboard help. Press Escape to close.');
  }

  // hideHelp() — close the Help dialog.
  function hideHelp() {
    if (openDialogId() === 'help-overlay') closeDialog();
  }

  // ===========================================================================
  // 9. Status / information readouts  (INTERFACE_DESIGN §2 / §5.2)
  // ---------------------------------------------------------------------------
  // The single-key info queries (S, T, M) and the always-current info panel.
  // updateInfoPanel keeps the visible #scores / #bag-count / #turn-number in
  // sync; the spoken variants speak the same facts on demand.
  // ===========================================================================

  // "You 142, Computer 130." — the scores of all players in turn order.
  function scoresSentence() {
    var ps = G().players;
    var parts = [];
    for (var i = 0; i < ps.length; i++) parts.push(ps[i].name + ' ' + ps[i].score);
    return parts.join(', ') + '.';
  }

  // announceScores() — speak the scores (used by S and after plays).
  function announceScores() { say(scoresSentence()); }

  // announceBag() — "23 tiles left." (the bag count alone).
  function announceBag() {
    var n = S().bagCount();
    say(n + (n === 1 ? ' tile left.' : ' tiles left.'));
  }

  /*
   * announceStatus() — the S key. Scores, whose turn it is, the turn number, and
   * the bag count, in one spoken status line (INTERFACE_DESIGN §5.2).
   */
  function announceStatus() {
    var g = G();
    var cur = S().currentPlayer();
    var whose = cur ? (cur.isHuman ? 'Your turn' : cur.name + "'s turn") : '';
    var n = S().bagCount();
    say(scoresSentence() + ' ' + whose + '. Turn ' + g.turnNumber + '. ' +
        n + (n === 1 ? ' tile' : ' tiles') + ' in the bag.');
  }

  /*
   * announceUnseen() — the T key. Bag count, then the unseen-letter breakdown
   * (every tile not visible to the human: bag + opponents' racks), which is a key
   * strategic aid. We read only letters with a nonzero count, plus blanks.
   */
  function announceUnseen() {
    var counts = S().unseenTiles(activePlayer());
    var total = S().bagCount();
    var parts = [];
    var letters = Data().LETTERS;
    for (var i = 0; i < letters.length; i++) {
      var L = letters[i];
      if (counts[L]) parts.push(L + ' ' + counts[L]);
    }
    if (counts['_']) parts.push('blank ' + counts['_']);

    var head = total + (total === 1 ? ' tile' : ' tiles') + ' in the bag. ';
    if (parts.length === 0) {
      say(head + 'No unseen tiles.');
    } else {
      say(head + 'Unseen: ' + parts.join(', ') + '.');
    }
  }

  /*
   * updateInfoPanel() — refresh the visible status region (#scores, #bag-count,
   * #turn-number). Called by SC.Game after every state change so the side panel
   * (the S-key focus target) always reflects reality for sighted helpers and for
   * a screen reader that navigates to it directly.
   */
  function updateInfoPanel() {
    var scores = byId('scores');
    if (scores) scores.textContent = 'Scores: ' + scoresSentence();
    var bag = byId('bag-count');
    if (bag) {
      var n = S().bagCount();
      bag.textContent = 'Tiles in bag: ' + n;
    }
    var turn = byId('turn-number');
    if (turn) turn.textContent = 'Turn ' + G().turnNumber;

    // Keep the header turn-indicator in step with whose turn it is.
    var ind = byId('turn-indicator');
    if (ind) {
      var cur = S().currentPlayer();
      ind.textContent = cur ? (cur.isHuman ? 'Your turn' : cur.name + ' thinking…') : '';
    }

    // Re-render the move log so the list stays current (it is cheap).
    renderMoveLog();
  }

  // ---------------------------------------------------------------------------
  // Move log — the running play history (#move-log), most recent first.
  // ---------------------------------------------------------------------------

  // Format one logged move into a spoken/visible line: who, what, where, score.
  // The log entry shape is {playerName, move, turn} (ARCHITECTURE §2 moveLog).
  function moveLogLine(entry) {
    var m = entry.move;
    if (!m) {
      return entry.playerName + ': (no move)';
    }
    // Pass / exchange are logged (game.js doPass/doExchange) as move STUBS with
    // word '(pass)' / '(exchange N)' and no `type` field — so the old `m.type`
    // branches were dead and these read awkwardly as "Name: (pass), 0 points."
    // Detect the stub words and phrase them naturally instead (confirmed bug).
    if (m.word === '(pass)') return entry.playerName + ' passed.';
    var ex = m.word && m.word.match(/^\(exchange (\d+)\)$/);
    if (ex) {
      var nEx = ex[1];
      return entry.playerName + ' exchanged ' + nEx + ' tile' + (nEx === '1' ? '' : 's') + '.';
    }
    var where = '';
    if (m.mainWord && m.mainWord.cells && m.mainWord.cells.length) {
      var a = m.mainWord.cells[0];
      var b = m.mainWord.cells[m.mainWord.cells.length - 1];
      where = ' ' + (m.dir || '') + ' ' + Data().coordToString(a.row, a.col) +
              ' to ' + Data().coordToString(b.row, b.col);
    } else if (m.row != null && m.col != null) {
      where = ' at ' + Data().coordToString(m.row, m.col);
    }
    // Pronounce the played word lowercase ("barn") so the SR doesn't spell it out
    // when the move log is read (the (pass)/(exchange N) stubs are unaffected).
    return entry.playerName + ': ' + spokenWord(m.word || '') + where +
           (m.isBingo ? ', bingo' : '') + ', ' + pointWord(m.score || 0) + '.';
  }

  // Re-render the #move-log list (most recent first).
  function renderMoveLog() {
    var ul = byId('move-log');
    if (!ul) return;
    ul.innerHTML = '';
    var log = G().moveLog || [];
    // moveLog is built newest-FIRST (game.js uses unshift, so index 0 is the most
    // recent play). Iterate ASCENDING so the newest entry is appended FIRST and ends
    // up as the top <li> — matching INTERFACE_DESIGN §3.2 ("most recent first") and
    // the CSS that bolds li:first-child. (The old `i = len-1 .. 0` loop appended
    // oldest-first, so the newest play sank to the bottom — confirmed bug.)
    for (var i = 0; i < log.length; i++) {
      var li = document.createElement('li');
      var line = moveLogLine(log[i]) + ' (turn ' + log[i].turn + ')';
      li.textContent = line;
      li.setAttribute('aria-label', line);
      ul.appendChild(li);
    }
  }

  /*
   * announceMoveLog() — the M key. Speak the most recent play FIRST (so the
   * opponent's last move is heard immediately, INTERFACE_DESIGN §5.2), then a few
   * more for context. moveLog is newest-first (index 0 = most recent, built via
   * unshift in game.js), so we iterate ASCENDING and cap at the last ~6 entries.
   *
   * BUG FIX (NOTE 1a): the old loop walked the log BACKWARDS (`i = len-1 .. 0`)
   * and stopped after the first MAX it touched — i.e. it read the OLDEST entries.
   * While the log had <=MAX entries (through ~turn 2) that happened to include
   * everything, just reversed; once it grew past MAX (turn 3+) M permanently
   * replayed the opening plays and NEVER the latest move, so to a screen-reader
   * user it "stopped being heard after ~the 2nd turn." Reading newest-first fixes it.
   */
  function announceMoveLog() {
    var log = G().moveLog || [];
    if (log.length === 0) { say('No moves yet.'); return; }
    var MAX = 6;                                        // last ~6 entries, newest first
    var lines = [];
    for (var i = 0; i < log.length && lines.length < MAX; i++) {
      lines.push(moveLogLine(log[i]));
    }
    say(lines.join(' '));
  }

  // entryIsHuman — is a logged entry's player a HUMAN? The log stores only
  // playerName, so we resolve it against the live roster (names are assigned
  // uniquely per game). Used by announceLastRound to find the "human's last turn"
  // boundary. Defensive: an unknown name is treated as non-human (a computer).
  function entryIsHuman(entry) {
    var players = G().players || [];
    for (var i = 0; i < players.length; i++) {
      if (players[i].name === entry.playerName) return !!players[i].isHuman;
    }
    return false;
  }

  // lastRoundLine — terse phrasing for Shift+M: "<player> <word>, N points." Passes
  // and exchanges reuse moveLogLine's natural phrasing; scoring plays are read as
  // the task specifies (player + LOWERCASE word + score), without coords/cross-words.
  function lastRoundLine(entry) {
    var m = entry.move;
    if (!m || m.word === '(pass)' || (m.word && /^\(exchange \d+\)$/.test(m.word))) {
      return moveLogLine(entry);                        // "X passed." / "X exchanged N tiles."
    }
    return entry.playerName + ' ' + spokenWord(m.word || '') + ', ' + pointWord(m.score || 0) + '.';
  }

  /*
   * announceLastRound() — Shift+M (NOTE 1b). Read ONLY the most recent round: the
   * opponents' moves since the human's last turn. We walk moveLog newest->older
   * (index 0 is newest) and collect entries UNTIL — but EXCLUDING — the first one
   * that belongs to a human (the human's previous own move). Those collected
   * entries are exactly what happened since the human last acted; we read them
   * OLDEST-first so they play back in the order they occurred. If nothing has
   * happened since the human last moved, we say so.
   */
  function announceLastRound() {
    var log = G().moveLog || [];
    if (log.length === 0) { say('No moves yet.'); return; }

    var collected = [];                                 // newest-first while collecting
    for (var i = 0; i < log.length; i++) {
      if (entryIsHuman(log[i])) break;                  // reached the human's own move -> stop (exclude it)
      collected.push(log[i]);
    }
    if (collected.length === 0) { say('Nothing has happened since your last turn.'); return; }

    var lines = [];
    for (var j = collected.length - 1; j >= 0; j--) {   // reverse -> oldest-first
      lines.push(lastRoundLine(collected[j]));
    }
    say(lines.join(' '));
  }

  // ===========================================================================
  // 10. Game Over  (final scores + endgame breakdown; INTERFACE_DESIGN §6.6)
  // ---------------------------------------------------------------------------
  // SC.Game computes the result (winner, final scores, endgame rack penalties /
  // out-bonus) and hands us a `result` object; we render + open the Game-Over
  // dialog. New Game (N) is wired to SC.Game.newGame.
  //
  // SC.Game owns the AUDIO + the assertive announcement for game over (it plays the
  // win/lose cue and speaks result.spoken in endGame), so this method ONLY renders
  // the visible overlay text — it must NOT re-cue or re-announce, which would
  // duplicate the fanfare and double-speak the summary.
  //
  // `result` is SC.Game.buildResult's shape; we prefer its rich, pre-formatted
  // pieces (headline + per-player lines) and fall back to the older
  // {winnerName, scores:[{name,score,penalty}], reason} fields for robustness.
  // ===========================================================================

  function showGameOver(result) {
    result = result || {};
    var lines = [];

    // Headline: prefer the fully-formatted headline SC.Game built ("You win with
    // 142!" / "It's a draw …"); else derive from winnerName; else generic.
    if (result.headline) {
      lines.push(result.headline);
    } else if (result.winnerName) {
      lines.push(result.winnerName + ' wins!');
    } else {
      lines.push('Game over.');
    }

    // Per-player breakdown: prefer SC.Game's ready-made lines (final score + the
    // rack penalty / went-out bonus per player). Otherwise format the scores rows.
    if (result.lines && result.lines.length) {
      lines.push('Final scores: ' + result.lines.join('; ') + '.');
    } else if (result.scores && result.scores.length) {
      var sc = [];
      for (var i = 0; i < result.scores.length; i++) {
        var p = result.scores[i];
        var line = p.name + ' ' + p.score;
        // penalty>0 = points lost for tiles left on rack; penalty<0 = went-out
        // bonus gained from opponents' racks.
        if (p.penalty > 0) line += ' (after ' + pointWord(p.penalty) + ' rack penalty)';
        else if (p.penalty < 0) line += ' (+' + (-p.penalty) + ' from opponents’ racks)';
        sc.push(line);
      }
      lines.push('Final scores: ' + sc.join(', ') + '.');
    } else {
      lines.push(scoresSentence());
    }

    var text = lines.join(' ');
    var el = byId('gameover-text');
    if (el) { el.textContent = text; }

    openDialog('gameover-overlay', {
      focus: 'gameover-newgame',
      trapEsc: false,                                  // no Esc-cancel: the game is over
      // The button is labelled "New Game (N)" and the help table advertises N, but
      // while a dialog is open SC.Game.handleKey early-returns, so N would otherwise
      // be dead here (only Enter/Space on the focused button worked). Handle N in the
      // dialog's own onKey, mirroring the gameover-newgame click handler.
      onKey: function (e) {
        if (e.key === 'n' || e.key === 'N') {
          if (openDialogId() === 'gameover-overlay') closeDialog();
          if (Game() && Game().newGame) Game().newGame();
          return true;                                 // consumed (openDialog stops it)
        }
        return false;
      }
    });
    // No cue()/alertSay() here: SC.Game.endGame already played the win/lose cue and
    // spoke the summary assertively. Re-doing either would double up.
  }

  // ===========================================================================
  // 11. findHint()  (the optional F key; INTERFACE_DESIGN §5.3 / §7.4)
  // ---------------------------------------------------------------------------
  // Ask SC.AI for the best play(s) for the human's current rack and announce the
  // top suggestion (word, where, score). Respects the hint-enabled setting (off
  // by default): if disabled we say so rather than silently doing nothing. The
  // dictionary must be ready (move-gen needs the DAWG).
  // ===========================================================================

  function findHint() {
    if (!cfg('hintEnabled')) {
      say('The hint key is turned off. Enable it in Settings.');
      return;
    }
    if (!Dict() || !Dict().ready) {
      say('Still loading the dictionary. Try again in a moment.');
      return;
    }
    if (!AI() || !AI().findHints) {
      say('Hints are not available.');
      return;
    }

    // Gather the human's playable tiles (visible rack tiles) as a rack array for
    // the move generator, then ask for the single best play.
    var rack = visibleRackTiles();
    var hints = AI().findHints(G().board, rack, isFirstMove(), 1);
    if (!hints || hints.length === 0) {
      say('No play found. You could exchange tiles or pass.');
      return;
    }
    var h = hints[0];
    var where = '';
    if (h.mainWord && h.mainWord.cells && h.mainWord.cells.length) {
      var a = h.mainWord.cells[0];
      where = ' ' + (h.dir || '') + ' at ' + Data().coordToString(a.row, a.col);
    } else if (h.row != null) {
      where = ' at ' + Data().coordToString(h.row, h.col);
    }
    cue('validWord');
    // Pronounce the suggested word lowercase ("barn"), not spelled out.
    say('Hint: ' + spokenWord(h.word || '') + where + ' for ' + pointWord(h.score || 0) +
        (h.isBingo ? ', a bingo' : '') + '.');
  }

  // ===========================================================================
  // 12. init()  — wire the toolbar buttons, restore settings, first render
  // ---------------------------------------------------------------------------
  // SC.Game calls init() once after the other modules are up. We:
  //   * restore persisted settings into Speech/Sounds/G.config (single blob);
  //   * wire the header + dialog BUTTONS to their UI methods (so mouse users and
  //     sighted helpers have parity with the keyboard — the keyboard itself is
  //     SC.Game.handleKey's job, NOT ours);
  //   * render the rack once and sync the info panel.
  // We do NOT add any document-global key listener (that is SC.Game's exclusive
  // responsibility). All listeners here are on specific buttons/inputs.
  // ===========================================================================

  // Bind a click handler to a button by id (no-op if the button is absent).
  function onClick(id, fn) {
    var el = byId(id);
    if (el) el.addEventListener('click', fn);
  }

  // One-time-wiring guard. init() is called from SC.Game.enterGameScreen on EVERY
  // startGame()/resumeGame(), but its button + input listeners must be attached
  // exactly ONCE — addEventListener has no de-dup, so re-running init() per game
  // would double-bind every dialog button and the composer-input listener (firing
  // handlers twice per click/keystroke). We therefore wire listeners only on the
  // first call; the per-game refreshes (renderRack/updateInfoPanel) are driven by
  // SC.Game.enterGameScreen separately, so they still run every game.
  var inited = false;

  function init() {
    if (inited) return;          // listeners are wired once; ignore later calls
    inited = true;

    // 1) Restore every persisted setting (Speech/Sounds clamp + reflect to their
    //    own toolbar buttons; UI flags land on G.config). Safe before a game
    //    exists (G.config is seeded with defaults).
    restoreSettings();

    // 2) Header toolbar buttons that map to UI dialogs/actions. (Voice/ARIA/Sound
    //    toggle buttons are wired by SC.Speech/SC.Sounds themselves.)
    onClick('settings-btn', openSettings);
    onClick('help-btn-game', showHelp);
    onClick('help-btn', showHelp);                      // setup-screen Help button

    // 3) Dialog buttons -> their UI methods (keyboard parity for pointer users).
    onClick('help-close', hideHelp);
    onClick('settings-close', closeSettings);
    onClick('composer-next', composerToPreview);
    onClick('composer-cancel', cancelComposer);
    onClick('preview-commit', commitFromPreview);
    onClick('preview-blank', toggleBlankInPreview);
    onClick('preview-cancel', cancelPreview);
    onClick('exchange-confirm', confirmExchange);
    onClick('exchange-cancel', cancelExchange);
    onClick('gameover-newgame', function () {
      // New game from the Game-Over dialog: close it, then hand off to SC.Game.
      if (openDialogId() === 'gameover-overlay') closeDialog();
      if (Game() && Game().newGame) Game().newGame();
    });

    // 4) The Composer's live preview: every input change feeds onComposerInput so
    //    the running word/score is announced as the player types. This is an
    //    input-scoped listener (not global), so it is ours to own.
    var composerInput = byId('composer-input');
    if (composerInput) {
      composerInput.addEventListener('input', function () {
        onComposerInput(composerInput.value);
      });
    }

    // 5) First paint of the dynamic widgets (a game may not have started yet, in
    //    which case these read as empty/zero gracefully).
    renderRack();
    updateInfoPanel();
  }

  // ===========================================================================
  // Public API — EXACTLY the SC.UI surface required by ARCHITECTURE.md §3.
  // (Plus a couple of read-only dialog-state helpers SC.Game may consult; they
  // do not change the contract surface but make integration robust.)
  // ===========================================================================
  return {
    init: init,

    // Rack
    renderRack: renderRack,
    announceRack: announceRack,
    announceSlot: announceSlot,
    rackValueSummary: rackValueSummary,
    shuffleRack: shuffleRack,

    // Composer
    openComposer: openComposer,
    closeComposer: closeComposer,
    onComposerInput: onComposerInput,
    toggleComposerDirection: toggleComposerDirection,
    composerToPreview: composerToPreview,
    // Public name for the ";" read-preview action (integration fix #3). The
    // composer's own onKey already calls readComposerPreview; this exposes it so
    // any external caller (or SC.Game) can trigger it too.
    speakComposerPreview: readComposerPreview,

    // Preview
    showPreview: showPreview,
    commitFromPreview: commitFromPreview,
    toggleBlankInPreview: toggleBlankInPreview,
    cancelPreview: cancelPreview,

    // Exchange
    openExchange: openExchange,
    toggleExchangeTile: toggleExchangeTile,
    confirmExchange: confirmExchange,
    cancelExchange: cancelExchange,

    // Settings
    openSettings: openSettings,
    closeSettings: closeSettings,
    // The single settings store (integration fix #10): SC.Game delegates its
    // persistence here so there is one key + one shape across the app.
    saveSettings: saveSettings,
    restoreSettings: restoreSettings,

    // Help
    showHelp: showHelp,
    hideHelp: hideHelp,

    // Status / information
    announceStatus: announceStatus,
    announceScores: announceScores,
    announceBag: announceBag,
    announceUnseen: announceUnseen,
    updateInfoPanel: updateInfoPanel,
    announceMoveLog: announceMoveLog,
    announceLastRound: announceLastRound,   // Shift+M: opponents' moves since your last turn

    // Game over + hint
    showGameOver: showGameOver,
    findHint: findHint,

    // Read-only dialog-state helpers (integration aid; not in the §3 list but
    // harmless additive getters SC.Game can use to know which modal is open).
    isDialogOpen: isDialogOpen,
    openDialogId: openDialogId,
    // Per-overlay predicates SC.Game.handleKey mode-gates on (integration fix #1).
    isComposerOpen: isComposerOpen,
    isPreviewOpen: isPreviewOpen,
    isExchangeOpen: isExchangeOpen,
    isSettingsOpen: isSettingsOpen,
    isHelpOpen: isHelpOpen
  };
})();
