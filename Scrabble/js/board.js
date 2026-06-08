/*
 * board.js — The board DOM, the review cursor, and all square/word announcements.
 *
 * Exposes SC.Board. Owns everything inside index.html's #board-grid: it builds a
 * 15x15 ARIA grid (role="grid" > role="row" > role="gridcell"), tracks a movable
 * review cursor via aria-activedescendant (NOT DOM focus, to avoid focus thrash),
 * and speaks square/row/column/board/word information through SC.Speech with audio
 * cues through SC.Sounds.
 *
 * It is a *view* over the model: every render reads SC.State.G.board (committed
 * tiles), SC.State.G.pending (this turn's staged tiles, drawn as an overlay), and
 * SC.Data.PREMIUM (the premium-square layout). It never mutates the model — turn
 * flow and key dispatch are owned by SC.Game; rack/overlays by SC.UI.
 *
 * Echo discipline (ARCHITECTURE.md §7.6 / SPEC-housestyle §4.2): a cursor move
 * speaks the square exactly ONCE via SC.Speech (which writes one polite live
 * region) and moves aria-activedescendant for the SR focus ring + braille. We do
 * NOT also write the square text into a second announcement — no double-talk.
 *
 * Constraints (ARCHITECTURE.md §0): plain ES5-ish JS, no ES modules, no fetch,
 * runs from file://. Other SC modules are referenced ONLY inside functions (called
 * at/after init) so <script> load order is not fragile.
 *
 * Depends on (all lazily, inside functions): SC.Data, SC.State, SC.Speech,
 * SC.Sounds. The "go to coordinate" mini-dialog binds to index.html's #jump-*
 * elements.
 */
(function () {
  // Shared global namespace, created by whichever SC module loads first.
  window.SC = window.SC || {};

  // ---- Lazy module accessors ----------------------------------------------
  // Grabbing SC.* at call time (not load time) keeps script order flexible: the
  // board never touches another module before that module's <script> has run.
  function data()   { return SC.Data; }
  function state()  { return SC.State; }
  function speech() { return SC.Speech; }
  function sounds() { return SC.Sounds; }

  // ---- DOM id conventions (index.html is the source of truth) -------------
  // Cell ids are "sq-<row>-<col>" with 0-based indices, e.g. the center H8 is
  // "sq-7-7". aria-activedescendant on the grid points at one of these ids.
  function cellId(row, col) { return 'sq-' + row + '-' + col; }

  // ---- Module-private state ------------------------------------------------
  var gridEl = null;            // the role="grid" element (#board-grid)
  var cursor = { row: 7, col: 7 };  // review-cursor position; starts at center (H8)

  // The "go to coordinate" mini-dialog (#jump-overlay) is owned here because the
  // G key flow (SPEC-housestyle §3.1) routes through SC.Board.openCoordInput /
  // isCoordInputOpen / coordInputKey. We remember the element to restore focus to.
  var coordInputOpen = false;
  var coordReturnFocus = null;

  // =========================================================================
  // RENDERING
  // =========================================================================

  /*
   * render — (re)build the entire 15x15 grid inside #board-grid.
   *
   * Structure (ARCHITECTURE.md §3 / SPEC-housestyle §4.1):
   *   #board (role="application")           [in index.html, not built here]
   *     #board-grid (role="grid")           [we fill this]
   *       role="row"  (15 of them)
   *         role="gridcell" id="sq-r-c"     (15 per row)
   *
   * Each gridcell gets an aria-label from squareLabel(r,c) so the activedescendant
   * label is always current, plus a visible glyph for sighted helpers. Premium
   * squares get a CSS class hook (premium-TW/DW/TL/DL) for styling only — all
   * meaning is also in the label/speech, never color-only (INTERFACE_DESIGN §9).
   *
   * Idempotent: clears and rebuilds, so it is safe to call after every committed
   * play or whenever pending placements change.
   */
  function render() {
    gridEl = document.getElementById('board-grid');
    if (!gridEl) { return; }                 // defensive: nothing to draw into

    var size = data().BOARD_SIZE;

    // Build the whole grid in a fragment, then swap in once (one reflow, no fl)
    var frag = document.createDocumentFragment();

    for (var r = 0; r < size; r++) {
      var rowEl = document.createElement('div');
      rowEl.setAttribute('role', 'row');

      for (var c = 0; c < size; c++) {
        var cell = document.createElement('div');
        cell.setAttribute('role', 'gridcell');
        cell.id = cellId(r, c);
        // Visual state classes (premium for empty squares; placed/pending/blank
        // for covered squares) so css/styles.css tile faces apply (DRY helper).
        cell.className = cellClasses(r, c);

        // aria-label is the full square description; visible text is a short glyph.
        cell.setAttribute('aria-label', squareLabel(r, c));
        cell.textContent = cellGlyph(r, c);

        rowEl.appendChild(cell);
      }
      frag.appendChild(rowEl);
    }

    gridEl.innerHTML = '';                    // drop any previous grid
    gridEl.appendChild(frag);

    // Re-assert the cursor onto the freshly-built cells (activedescendant + class).
    applyCursorToDom();
  }

  /*
   * cellGlyph — the short on-screen text for a cell (sighted-assist only).
   * Shows the tile letter if occupied (lowercase for a blank, to hint "wildcard"),
   * else the premium code, else a dot. None of this is the accessible source —
   * the aria-label / speech is. Kept tiny and DRY.
   */
  function cellGlyph(row, col) {
    var t = tileAt(row, col);
    if (t) { return t.isBlank ? (t.letter || '?').toLowerCase() : t.letter; }
    var prem = data().premiumAt(row, col);
    if (prem) { return prem.center ? '*' : prem.code; }
    return '.';
  }

  /*
   * cellClasses — compute the full className string for a cell, so render() and
   * refreshCell() agree (DRY). The class contract css/styles.css §8 expects:
   *   - premium-<TW|DW|TL|DL> and .center ONLY on EMPTY squares (an uncovered
   *     premium shows its colour/code; a tile sitting on it hides the premium),
   *   - .placed on a committed-board tile, .pending on a tile staged this turn,
   *   - .blank on either kind when the tile is a blank (accent ring).
   * Always starts with 'board-cell'. Visual only — all meaning is in the label.
   */
  function cellClasses(row, col) {
    var cls = 'board-cell';
    // Distinguish committed vs pending without re-walking pending twice: read the
    // committed board first, then fall back to the pending overlay.
    var b = state().G.board;
    var committed = (b && b[row] && b[row][col]) ? b[row][col] : null;
    var tile = committed;
    var isPending = false;
    if (!tile) {
      var pend = state().getPending();
      for (var i = 0; i < pend.length; i++) {
        if (pend[i].row === row && pend[i].col === col) { tile = pend[i].tile; isPending = true; break; }
      }
    }

    if (tile) {
      // Covered square: a tile face replaces the premium colour/code.
      cls += isPending ? ' pending' : ' placed';
      if (tile.isBlank) { cls += ' blank'; }
    } else {
      // Empty square: keep the premium class hook so its colour/code shows.
      var prem = data().premiumAt(row, col);
      if (prem) { cls += ' premium-' + prem.code; if (prem.center) { cls += ' center'; } }
    }
    return cls;
  }

  /*
   * refreshCellLabels — after pending changes, update only the cells whose
   * contents changed (the pending squares) plus the cursor, instead of a full
   * rebuild. DRY helper used by callers that stage/recall tiles. Safe no-op if the
   * grid hasn't been built yet. Re-applies the visual state classes too (a square
   * may have gone empty->pending->placed), preserving the .cursor class if set.
   */
  function refreshCell(row, col) {
    var cell = document.getElementById(cellId(row, col));
    if (!cell) { return; }
    var hadCursor = cell.classList.contains('cursor');
    cell.className = cellClasses(row, col);
    if (hadCursor) { cell.classList.add('cursor'); }   // don't clobber the cursor outline
    cell.setAttribute('aria-label', squareLabel(row, col));
    cell.textContent = cellGlyph(row, col);
  }

  // =========================================================================
  // MODEL READ HELPERS (committed board + pending overlay)
  // =========================================================================

  /*
   * tileAt — the effective tile shown at (row,col): a committed board tile if any,
   * otherwise a pending (staged) tile if one is placed there this turn, else null.
   * This single accessor is the board's source of truth for every label/readout,
   * keeping committed + pending logic in ONE place (DRY).
   */
  function tileAt(row, col) {
    var b = state().G.board;
    if (b && b[row] && b[row][col]) { return b[row][col]; }
    var pend = state().getPending();
    for (var i = 0; i < pend.length; i++) {
      if (pend[i].row === row && pend[i].col === col) { return pend[i].tile; }
    }
    return null;
  }

  // True if a square currently holds any tile (committed OR pending). Used for
  // navigation/anchor logic, where a staged tile is "occupied" like a real one.
  function isOccupied(row, col) { return tileAt(row, col) !== null; }

  // =========================================================================
  // SQUARE / TILE / WORD WORDING  (INTERFACE_DESIGN.md §2)
  // =========================================================================

  /*
   * tilePhrase — spoken description of a single tile, e.g.:
   *   normal tile     -> "letter R, 1 point"
   *   played blank    -> "blank as E, 0 points"
   *   unassigned blank-> "blank, 0 points"   (only happens off-board; rack)
   * Pluralizes "point/points" correctly.
   */
  function tilePhrase(tile) {
    var pts = tile.points;
    var unit = (pts === 1) ? 'point' : 'points';
    if (tile.isBlank) {
      var as = tile.letter ? ('blank as ' + tile.letter) : 'blank';
      return as + ', ' + pts + ' ' + unit;
    }
    return 'letter ' + tile.letter + ', ' + pts + ' ' + unit;
  }

  /*
   * spokenWord — lowercase a whole word for SPEECH only (accessibility). Tiles and
   * Move.word/collectWord().text are UPPERCASE, but Web Speech and most screen
   * readers spell an all-caps token letter-by-letter ("B-A-R-N") instead of saying
   * it as a word ("barn"). Route every PRONOUNCED whole word through this; keep the
   * SPELLED-OUT copy (e.g. letters.join(' ')) and on-screen glyphs UPPERCASE.
   */
  function spokenWord(w) { return (w || '').toLowerCase(); }

  /*
   * squareLabel — the full, contents-first description of a square. Used both as
   * the per-cell aria-label AND as the string spoken when the cursor moves.
   *
   * Order is CONTENTS FIRST, then premium (INTERFACE_DESIGN §2), so experienced
   * players hear the meaningful part fastest:
   *   empty plain     -> "G6, empty"
   *   empty premium   -> "H8, empty, center double word score"
   *   occupied        -> "D4, letter R, 1 point, double word score"
   *
   * This is the NORMAL-verbosity wording. moveCursor() may trim/extend it per the
   * verbosity & toggle settings (see spokenSquare()); the cell's static aria-label
   * always uses this full form so braille/AT users get complete context.
   */
  function squareLabel(row, col) {
    var coord = data().coordToString(row, col);
    var tile = tileAt(row, col);
    var prem = data().premiumAt(row, col);

    var parts = [coord];
    parts.push(tile ? tilePhrase(tile) : 'empty');
    if (prem) { parts.push(prem.name); }     // premium named even when covered
    return parts.join(', ');
  }

  // =========================================================================
  // SETTINGS / VERBOSITY HELPERS
  // =========================================================================
  // Verbosity and the two "while navigating" toggles live in SC.State.G.config
  // (INTERFACE_DESIGN §7.1/§7.3), written by SC.UI's settings. We read them
  // defensively with documented defaults so the board works before settings exist.

  function config() { return state().G.config || {}; }

  // 'terse' | 'normal' | 'verbose'  (default 'normal').
  function verbosity() {
    var v = config().verbosity;
    return (v === 'terse' || v === 'verbose') ? v : 'normal';
  }

  // Announce the premium while navigating? (INTERFACE_DESIGN §7.3, default on.)
  function announcePremiumOn() { return config().announcePremium !== false; }

  // Announce the coordinate while navigating? (INTERFACE_DESIGN §7.3, default on.)
  // Canonical config key is `announceCoords` (matches SC.UI Settings + SC.Game).
  function announceCoordOn() { return config().announceCoords !== false; }

  /*
   * spokenSquare — the string SPOKEN on a cursor move, honoring verbosity and the
   * two navigation toggles. (The static cell aria-label always uses the full
   * squareLabel; this only shapes the spoken echo so fast navigation stays terse.)
   *
   *   terse   : coord + contents only ("H8, empty" / "D4, letter R, 1 point")
   *   normal  : + premium name              (the squareLabel() default)
   *   verbose : + spelled-out coordinate    ("row H, column 8, ...")
   *
   * The "announce coordinate/premium while navigating" toggles can drop those
   * pieces independently of verbosity.
   */
  function spokenSquare(row, col) {
    var tile = tileAt(row, col);
    var prem = data().premiumAt(row, col);
    var parts = [];

    // Coordinate piece (optional via toggle; spelled out only when verbose).
    if (announceCoordOn()) {
      if (verbosity() === 'verbose') {
        parts.push('row ' + data().LETTERS[row] + ', column ' + (col + 1));
      } else {
        parts.push(data().coordToString(row, col));
      }
    }

    // Contents are always spoken — the most important part of the square.
    parts.push(tile ? tilePhrase(tile) : 'empty');

    // Premium piece: skipped at terse, or when the toggle is off.
    if (prem && announcePremiumOn() && verbosity() !== 'terse') {
      parts.push(prem.name);
    }

    // NOTE 6: when an EMPTY square touches a placed tile, hint that on every cursor
    // move so the user can tell a connectable square from open space while
    // navigating. Respect verbosity: terse gets a bare "adjacent" flag; normal /
    // verbose name the neighbors and directions ("adjacent: above T, right A").
    if (!tile) {
      var np = neighborPhrase(row, col, verbosity() === 'terse' ? 'flag' : 'detail');
      if (np) { parts.push(np); }
    }
    return parts.join(', ');
  }

  // =========================================================================
  // CURSOR
  // =========================================================================

  // Return a COPY of the cursor so callers can't mutate our state by reference.
  function getCursor() { return { row: cursor.row, col: cursor.col }; }

  /*
   * applyCursorToDom — reflect the cursor in the DOM without stealing focus:
   *   - aria-activedescendant on the grid -> the current cell id (SR + braille),
   *   - a .cursor class on the current cell for a visible outline (sighted assist).
   * Pure view sync; no speech, no sound. Called by render() and setCursor().
   */
  function applyCursorToDom() {
    if (!gridEl) { return; }
    var id = cellId(cursor.row, cursor.col);
    gridEl.setAttribute('aria-activedescendant', id);

    // Move the visible-cursor class from the old cell to the new one.
    var prev = gridEl.querySelector('.board-cell.cursor');
    if (prev) { prev.classList.remove('cursor'); }
    var cur = document.getElementById(id);
    if (cur) { cur.classList.add('cursor'); }
  }

  /*
   * setCursor — place the cursor at (row,col) and update the DOM, WITHOUT speaking
   * or playing a sound. Used by jumps and by SC.Game/SC.UI when they need to move
   * the cursor as a side effect and announce something of their own. Out-of-bounds
   * coordinates are ignored (no throw). Returns the (clamped) cursor copy.
   */
  function setCursor(row, col) {
    if (!data().inBounds(row, col)) { return getCursor(); }
    cursor.row = row;
    cursor.col = col;
    applyCursorToDom();
    return getCursor();
  }

  /*
   * cueForSquare — play the RIGHT per-square audio cue for (row,col), so the user
   * hears WHAT they landed on, not just that they moved (INTERFACE_DESIGN §8). The
   * dedicated cues in SC.Sounds (onTile / premiumDL / premiumTL / premiumDW /
   * premiumTW) were previously unused; this single helper wires them up and is
   * called from moveCursor and every jump path (DRY). Priority:
   *   - empty square on a premium  -> 'premium' + code  (e.g. 'premiumTW')
   *   - occupied square (any tile)  -> 'onTile'
   *   - plain empty square          -> 'move'
   * Always passes {row,col} so spatial audio can pan by column / pitch by row.
   */
  function cueForSquare(row, col) {
    var opts = { row: row, col: col };
    var prem = data().premiumAt(row, col);
    if (!isOccupied(row, col) && prem) {
      sounds().play('premium' + prem.code, opts);   // premiumTW/DW/TL/DL
    } else if (isOccupied(row, col)) {
      sounds().play('onTile', opts);
    } else {
      sounds().play('move', opts);
    }
  }

  /*
   * moveCursor — move the cursor one square in a direction and ANNOUNCE the new
   * square (this is the interactive arrow/HJKL path; the HJKL<->direction mapping
   * itself is owned by SC.Game, which calls us with a resolved 'up'/'down'/...).
   *
   * At a board edge the cursor does not move: we play the 'edge' cue instead and
   * stay put (no re-announcement of the same square). Otherwise we move, cue the
   * step via SC.Sounds with {row,col} for spatial pan/pitch (the cue varies by
   * square contents/premium, see cueForSquare), and speak the square once (echo
   * discipline §7.6: speech is the single spoken source; the moved
   * activedescendant carries the SR focus ring/braille, not a second utterance).
   */
  function moveCursor(dir) {
    var dr = 0, dc = 0;
    if (dir === 'up')         { dr = -1; }
    else if (dir === 'down')  { dr = 1; }
    else if (dir === 'left')  { dc = -1; }
    else if (dir === 'right') { dc = 1; }

    var nr = cursor.row + dr;
    var nc = cursor.col + dc;

    // Edge: cannot move there -> buzz and stay (no square re-announce).
    if (!data().inBounds(nr, nc)) {
      sounds().play('edge', { row: cursor.row, col: cursor.col });
      return getCursor();
    }

    setCursor(nr, nc);
    // Per-square cue (pan by column, pitch by row): premium/occupied/plain.
    cueForSquare(nr, nc);
    // Speak the square exactly once, shaped by verbosity/toggles.
    speech().speak(spokenSquare(nr, nc));
    return getCursor();
  }

  // =========================================================================
  // ANNOUNCEMENTS (the reading keys: C, W, Shift+H/L, Shift+J/K, B)
  // =========================================================================

  /*
   * announceSquare — read the CURRENT (or a given) square in detail (the C key).
   * Contents-first then premium (squareLabel order). In NORMAL/VERBOSE it also
   * appends the word(s) running through the square, since C is the explicit
   * "tell me everything about here" key (INTERFACE_DESIGN §5.2). In TERSE it stays
   * to the bare square. Spoken once via SC.Speech (no live-region double-write).
   *
   * Args optional: announceSquare() uses the cursor; announceSquare(r,c) targets a
   * specific square WITHOUT moving the cursor.
   *
   * prefix (optional) is prepended into the SAME utterance (e.g. "Board is empty.")
   * so callers can give context without firing a second, clobbering announcement —
   * keeping the speak-once echo discipline intact.
   */
  function announceSquare(row, col, prefix) {
    if (row == null || col == null) { row = cursor.row; col = cursor.col; }
    if (!data().inBounds(row, col)) { return; }

    // Full detail regardless of the navigate-toggles: C is an explicit query.
    var phrase = squareLabel(row, col);

    // Append words through the square at normal/verbose (the "+ words" of the C key).
    if (verbosity() !== 'terse') {
      var wp = wordsThroughPhrase(row, col);
      if (wp) { phrase += '. ' + wp; }
    }
    // NOTE 6: C is the explicit "tell me everything here" key, so for an EMPTY square
    // also name any occupied orthogonal neighbors (e.g. "adjacent: above T, right A")
    // — otherwise a connectable square sounds identical to open space. Occupied
    // squares already got their word context above; neighborPhrase no-ops on them.
    var np = neighborPhrase(row, col, 'detail');
    if (np) { phrase += '. ' + np; }
    speech().speak(prefix ? (prefix + ' ' + phrase) : phrase);
  }

  /*
   * collectWord — walk from (row,col) along an axis to find the maximal run of
   * occupied squares containing it, returning {text, letters, count} or null if
   * the square is empty or the run is a lone tile (<2 letters = not a word).
   *
   * dAxis: 'across' walks columns (horizontal), 'down' walks rows (vertical).
   * One generic walker drives both readWordsThrough and announceSquare (DRY).
   */
  function collectWord(row, col, dAxis) {
    if (!isOccupied(row, col)) { return null; }
    var horiz = (dAxis === 'across');

    // Step back to the first occupied square of the run.
    var r = row, c = col;
    while (true) {
      var pr = horiz ? r : r - 1;
      var pc = horiz ? c - 1 : c;
      if (!data().inBounds(pr, pc) || !isOccupied(pr, pc)) { break; }
      r = pr; c = pc;
    }

    // Walk forward collecting letters until the run ends.
    var letters = [];
    while (data().inBounds(r, c) && isOccupied(r, c)) {
      letters.push(tileAt(r, c).letter || '?');   // blank's assigned letter, or ?
      if (horiz) { c++; } else { r++; }
    }

    if (letters.length < 2) { return null; }       // a single tile is not a word
    return { text: letters.join(''), letters: letters, count: letters.length };
  }

  /*
   * neighborPhrase — adjacency reporting for an EMPTY square (NOTE 6). When the
   * cursor lands on an empty square that orthogonally touches one or more placed
   * tiles, a blind player otherwise can't tell it apart from open space — yet that
   * is exactly where a new word can connect. This helper inspects the four
   * orthogonal neighbors (reusing the inBounds + isOccupied + tileAt pattern from
   * isAnchor, DRY) and returns:
   *   mode 'flag'   -> 'adjacent'                      (terse: just a hint)
   *   mode 'detail' -> 'adjacent: above T, right A'    (normal/verbose: letters+dirs)
   * Returns '' for an occupied square (its context comes from wordsThroughPhrase)
   * or an empty square with no occupied neighbor. Direction order is fixed
   * (above, below, left, right) so the readout is predictable.
   */
  function neighborPhrase(row, col, mode) {
    if (isOccupied(row, col)) { return ''; }            // only empty squares get this
    var dirs = [
      { dr: -1, dc: 0, name: 'above' },
      { dr: 1,  dc: 0, name: 'below' },
      { dr: 0,  dc: -1, name: 'left' },
      { dr: 0,  dc: 1,  name: 'right' }
    ];
    var found = [];
    for (var i = 0; i < dirs.length; i++) {
      var r = row + dirs[i].dr, c = col + dirs[i].dc;
      if (data().inBounds(r, c) && isOccupied(r, c)) {
        var t = tileAt(r, c);
        found.push({ dir: dirs[i].name, letter: (t && t.letter) ? t.letter : '?' });
      }
    }
    if (!found.length) { return ''; }
    if (mode === 'flag') { return 'adjacent'; }
    // detail: name each occupied neighbor by direction and letter.
    var parts = [];
    for (var j = 0; j < found.length; j++) { parts.push(found[j].dir + ' ' + found[j].letter); }
    return 'adjacent: ' + parts.join(', ');
  }

  /*
   * wordsThroughPhrase — spoken phrase for the word(s) crossing (row,col), across
   * first then down (INTERFACE_DESIGN §5.2). Each word is spelled then named:
   *   "Across: BARN, B A R N. Down: BE, B E."
   * Returns '' when the square is empty or part of no ≥2-letter word.
   */
  function wordsThroughPhrase(row, col) {
    var out = [];
    var across = collectWord(row, col, 'across');
    var down   = collectWord(row, col, 'down');
    // Pronounce the word lowercase ("barn"), then spell it uppercase ("B A R N").
    if (across) { out.push('Across: ' + spokenWord(across.text) + ', ' + across.letters.join(' ')); }
    if (down)   { out.push('Down: '   + spokenWord(down.text)   + ', ' + down.letters.join(' ')); }
    if (!out.length) { return ''; }
    return out.join('. ');
  }

  /*
   * readWordsThrough — the W key: speak the word(s) through the cursor (or a given
   * square). If no word runs through it, say so. Spoken once via SC.Speech.
   */
  function readWordsThrough(row, col) {
    if (row == null || col == null) { row = cursor.row; col = cursor.col; }
    if (!data().inBounds(row, col)) { return; }
    var phrase = wordsThroughPhrase(row, col);
    if (phrase) { speech().speak(phrase); return; }     // occupied square in a word
    // NOTE 6: an EMPTY square has no word THROUGH it, but if it touches placed tiles
    // those are the perpendicular words/tiles it would connect to — name them so the
    // user knows the square is connectable rather than free-standing.
    var coord = data().coordToString(row, col);
    var np = neighborPhrase(row, col, 'detail');
    speech().speak(np
      ? (coord + ', no word through this square, but ' + np + '.')
      : (coord + ', no word through this square.'));
  }

  /*
   * linePhrase — describe an entire row or column as a compact run-length readout:
   * occupied squares speak their letter; consecutive empties collapse to
   * "3 empty". Keeps a full 15-cell line short enough to be useful. One helper
   * serves both readRow and readColumn (DRY).
   *
   * fixed: the constant index (the row for across, the column for down).
   * horiz: true to scan columns 0..14 (a row), false to scan rows 0..14 (a column).
   */
  function linePhrase(fixed, horiz) {
    var size = data().BOARD_SIZE;
    var segs = [];
    var emptyRun = 0;

    // Flush any pending run of empties as a single "N empty" segment.
    function flushEmpty() {
      if (emptyRun === 1) { segs.push('1 empty'); }
      else if (emptyRun > 1) { segs.push(emptyRun + ' empty'); }
      emptyRun = 0;
    }

    for (var i = 0; i < size; i++) {
      var r = horiz ? fixed : i;
      var c = horiz ? i : fixed;
      var t = tileAt(r, c);
      if (t) {
        flushEmpty();
        // Name the letter and its coordinate so a listener can locate it.
        segs.push((t.letter || '?') + ' at ' + data().coordToString(r, c));
      } else {
        emptyRun++;
      }
    }
    flushEmpty();
    return segs.join(', ');
  }

  /*
   * readRow — Shift+H / Shift+L: read the cursor's entire row (across).
   * Prefixes with the row letter; notes an all-empty row.
   */
  function readRow() {
    var rowLetter = data().LETTERS[cursor.row];
    var body = linePhrase(cursor.row, true);
    speech().speak('Row ' + rowLetter + ': ' + (body || 'all empty') + '.');
  }

  /*
   * readColumn — Shift+J / Shift+K: read the cursor's entire column (down).
   * Prefixes with the column number; notes an all-empty column.
   */
  function readColumn() {
    var colNum = cursor.col + 1;
    var body = linePhrase(cursor.col, false);
    speech().speak('Column ' + colNum + ': ' + (body || 'all empty') + '.');
  }

  /*
   * readBoard — the B key: read every OCCUPIED square in reading order (left to
   * right, top to bottom). Empty squares are skipped entirely (a full board would
   * be 225 cells). Announces "The board is empty." when nothing is placed.
   */
  function readBoard() {
    var size = data().BOARD_SIZE;
    var segs = [];
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var t = tileAt(r, c);
        if (t) { segs.push((t.letter || '?') + ' at ' + data().coordToString(r, c)); }
      }
    }
    speech().speak(segs.length ? ('Board: ' + segs.join(', ') + '.') : 'The board is empty.');
  }

  /*
   * collectWordEntries — enumerate every maximal >=2-letter run on the board exactly
   * ONCE, as {text, startRow, startCol, dir} (dir 'across'|'down'). Reuses the
   * collectWord() walker (DRY): for each occupied cell we emit its ACROSS run only
   * when the cell is the run's LEFT end (no occupied left neighbor) and its DOWN run
   * only when the cell is the run's TOP end (no occupied up neighbor) — those two
   * start-of-run tests visit each maximal word exactly once. Reading order is
   * row-major, so words are listed top-to-bottom, left-to-right.
   */
  function collectWordEntries() {
    var size = data().BOARD_SIZE;
    var out = [];
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (!isOccupied(r, c)) { continue; }
        // ACROSS run, emitted only at its left end.
        if (!(data().inBounds(r, c - 1) && isOccupied(r, c - 1))) {
          var across = collectWord(r, c, 'across');
          if (across) { out.push({ text: across.text, startRow: r, startCol: c, dir: 'across' }); }
        }
        // DOWN run, emitted only at its top end.
        if (!(data().inBounds(r - 1, c) && isOccupied(r - 1, c))) {
          var down = collectWord(r, c, 'down');
          if (down) { out.push({ text: down.text, startRow: r, startCol: c, dir: 'down' }); }
        }
      }
    }
    return out;
  }

  /*
   * readWords — Shift+B (NOTE 2): speak every WORD currently on the board, each
   * maximal horizontal run (>=2 letters) and vertical run (>=2 letters), spoken
   * LOWERCASE with its start coordinate and direction, e.g. "barn, H8 across".
   * Complements plain B (readBoard), which spells out occupied squares character by
   * character. Says "No words on the board yet." when none.
   */
  function readWords() {
    var entries = collectWordEntries();
    if (!entries.length) { speech().speak('No words on the board yet.'); return; }
    var parts = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      // Pronounce the word ("barn"), then its anchor: "<word>, <coord> <direction>".
      parts.push(spokenWord(e.text) + ', ' + data().coordToString(e.startRow, e.startCol) + ' ' + e.dir);
    }
    speech().speak('Words on the board: ' + parts.join('. ') + '.');
  }

  // =========================================================================
  // JUMPS  (G "go to", center, anchors, premiums)
  // =========================================================================

  /*
   * jumpToCoord — move the cursor to a typed coordinate string ("H8", or the word
   * "center"). Returns true on success. On a bad string it plays the edge cue and
   * speaks a short error, returning false. On success it announces the square
   * (via announceSquare so the listener gets full detail at the destination).
   */
  function jumpToCoord(str) {
    if (str && /^\s*center\s*$/i.test(str)) { return jumpToCenter(); }
    var co = data().stringToCoord(str);
    if (!co) {
      // Position the buzz at the (unchanged) cursor, like moveCursor's edge cue, so
      // spatial audio stays consistent instead of always playing dead-centre.
      sounds().play('edge', { row: cursor.row, col: cursor.col });
      speech().speak('I did not understand that coordinate.');
      return false;
    }
    setCursor(co.row, co.col);
    cueForSquare(co.row, co.col);              // contents-aware cue at the target
    announceSquare(co.row, co.col);
    return true;
  }

  /*
   * jumpToCenter — move the cursor to the center square (H8) and announce it.
   * prefix (optional) is folded into the single announcement (used by nextAnchor's
   * empty-board fallback). Returns true (boolean for symmetry with jumpToCoord).
   */
  function jumpToCenter(prefix) {
    var ctr = data().CENTER;
    setCursor(ctr.row, ctr.col);
    cueForSquare(ctr.row, ctr.col);            // contents-aware cue at the center
    announceSquare(ctr.row, ctr.col, prefix);
    return true;
  }

  /*
   * isAnchor — an empty square orthogonally adjacent to at least one OCCUPIED
   * square (Appel–Jacobson; SPEC-movegen §2). These are exactly the squares where
   * a new word can legally connect, so [ / ] jump between them. "Occupied" here
   * includes pending tiles (they are tiles on the board this turn).
   *
   * Special case: on a completely empty board there are no anchors, so the only
   * legal first-move connection is CENTER — nextAnchor() handles that fallback.
   */
  function isAnchor(row, col) {
    if (isOccupied(row, col)) { return false; }          // anchors are empty squares
    return (data().inBounds(row - 1, col) && isOccupied(row - 1, col)) ||
           (data().inBounds(row + 1, col) && isOccupied(row + 1, col)) ||
           (data().inBounds(row, col - 1) && isOccupied(row, col - 1)) ||
           (data().inBounds(row, col + 1) && isOccupied(row, col + 1));
  }

  // True if any tile is on the board at all (committed or pending).
  function boardHasTiles() {
    var size = data().BOARD_SIZE;
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) { if (isOccupied(r, c)) { return true; } }
    }
    return false;
  }

  /*
   * jumpBySatisfying — generic "jump to the next square (in reading order, forward
   * or backward from the cursor) for which test(r,c) is true". Powers nextAnchor
   * and nextPremium (DRY). Wraps neither; if none is found it returns false and the
   * caller cues/speaks the miss.
   *
   * dir: +1 scans forward (reading order), -1 scans backward.
   */
  function jumpBySatisfying(dir, test) {
    var size = data().BOARD_SIZE;
    var idx = cursor.row * size + cursor.col;     // flatten cursor to a 0..224 index
    var total = size * size;

    for (var step = 1; step <= total; step++) {
      var k = idx + dir * step;
      if (k < 0 || k >= total) { break; }         // ran off the start/end (no wrap)
      var r = Math.floor(k / size);
      var c = k % size;
      if (test(r, c)) {
        setCursor(r, c);
        cueForSquare(r, c);                    // contents-aware cue at the target
        announceSquare(r, c);
        return true;
      }
    }
    return false;
  }

  /*
   * nextAnchor — the [ and ] keys: jump to the previous/next anchor square.
   * dir is -1 (previous) or +1 (next). On an empty board, the only connectable
   * square is the center, so we route there. If none is found ahead/behind, we
   * buzz and say so without moving.
   */
  function nextAnchor(dir) {
    if (!boardHasTiles()) {
      // Opening move: there are no anchors, so the lone legal connection is the
      // center. One folded announcement (prefix + square) keeps speak-once.
      jumpToCenter('Board is empty.');
      return;
    }
    var found = jumpBySatisfying(dir < 0 ? -1 : 1, function (r, c) { return isAnchor(r, c); });
    if (!found) {
      sounds().play('edge', { row: cursor.row, col: cursor.col });   // buzz at the cursor (spatial-consistent)
      speech().speak(dir < 0 ? 'No anchor before here.' : 'No anchor after here.');
    }
  }

  /*
   * nextPremium — Shift+[ and Shift+]: jump to the previous/next premium square,
   * regardless of whether it is covered (still strategically useful to find).
   * dir is -1 (previous) or +1 (next). Buzzes + speaks if none is found.
   */
  function nextPremium(dir) {
    var found = jumpBySatisfying(dir < 0 ? -1 : 1, function (r, c) {
      return data().premiumAt(r, c) != null;
    });
    if (!found) {
      sounds().play('edge', { row: cursor.row, col: cursor.col });   // buzz at the cursor (spatial-consistent)
      speech().speak(dir < 0 ? 'No premium square before here.' : 'No premium square after here.');
    }
  }

  // =========================================================================
  // "GO TO COORDINATE" MINI-DIALOG  (#jump-overlay; the G key)
  // =========================================================================
  // SC.Game's dispatch (SPEC-housestyle §3.1) routes the G key here and, while the
  // input is open, sends keystrokes to coordInputKey so they don't leak into the
  // board map. We own this small overlay because it is purely a board action.

  function isCoordInputOpen() { return coordInputOpen; }

  /*
   * openCoordInput — show #jump-overlay and focus its input. Remembers the element
   * that had focus so we can restore it on close (board, normally). The input
   * starts empty; the user types "H8" or "center".
   */
  function openCoordInput() {
    var overlay = document.getElementById('jump-overlay');
    var input = document.getElementById('jump-input');
    if (!overlay || !input) { return; }

    coordReturnFocus = document.activeElement;
    coordInputOpen = true;
    overlay.classList.remove('hidden');
    input.value = '';
    input.focus();

    // Bind the dialog's own buttons once (idempotent via a data flag) so a click
    // works as well as Enter/Esc. Wiring here keeps the overlay self-contained.
    bindCoordButtons();
  }

  // Close the overlay, restoring focus to wherever it was (the board grid).
  function closeCoordInput() {
    var overlay = document.getElementById('jump-overlay');
    if (overlay) { overlay.classList.add('hidden'); }
    coordInputOpen = false;
    if (coordReturnFocus && coordReturnFocus.focus) { coordReturnFocus.focus(); }
    else { var b = document.getElementById('board'); if (b) { b.focus(); } }
    coordReturnFocus = null;
  }

  /*
   * submitCoordInput — read the input, attempt the jump, and close on success.
   * On a bad coordinate jumpToCoord already cued/spoke the error; we keep the
   * dialog open so the user can correct it.
   */
  function submitCoordInput() {
    var input = document.getElementById('jump-input');
    var value = input ? input.value : '';
    if (jumpToCoord(value)) { closeCoordInput(); }
  }

  /*
   * coordInputKey — keystroke handler while the go-to input is focused. Enter
   * submits, Esc cancels; every other key (typing the coordinate, editing) falls
   * through to the native input so the SR echoes characters. Mirrors the composer
   * discipline in SPEC-housestyle §3.5.
   */
  function coordInputKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); submitCoordInput(); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeCoordInput();  return; }
    // Tab trap: this overlay is role="dialog" aria-modal="true", so focus must NOT
    // escape it. SC.Game routes all keys here while it is open and does not handle
    // Tab, so without this Tab/Shift+Tab would fall through to native browser tabbing
    // and leak focus onto the (supposedly inert) page behind the modal. Cycle focus
    // among the three controls (input, OK, Cancel), like SC.UI.openDialog's trap.
    if (e.key === 'Tab') {
      e.preventDefault();
      var byId = document.getElementById.bind(document);
      var f = [byId('jump-input'), byId('jump-ok'), byId('jump-cancel')].filter(Boolean);
      if (!f.length) { return; }
      var i = f.indexOf(document.activeElement);
      var n = (i + (e.shiftKey ? -1 : 1) + f.length) % f.length;
      if (f[n] && f[n].focus) { f[n].focus(); }
      return;
    }
    // Other keys: let the input handle them (no preventDefault).
  }

  // Wire #jump-ok / #jump-cancel click handlers exactly once.
  function bindCoordButtons() {
    var ok = document.getElementById('jump-ok');
    var cancel = document.getElementById('jump-cancel');
    if (ok && !ok.getAttribute('data-sc-bound')) {
      ok.setAttribute('data-sc-bound', '1');
      ok.addEventListener('click', submitCoordInput);
    }
    if (cancel && !cancel.getAttribute('data-sc-bound')) {
      cancel.setAttribute('data-sc-bound', '1');
      cancel.addEventListener('click', closeCoordInput);
    }
  }

  // =========================================================================
  // PUBLIC API  (ARCHITECTURE.md §3 SC.Board + the §3-SC.Game coord-input hooks)
  // =========================================================================
  SC.Board = {
    // Rendering
    render: render,
    refreshCell: refreshCell,          // partial update after a pending change

    // Cursor
    getCursor: getCursor,
    setCursor: setCursor,
    moveCursor: moveCursor,

    // Announcements
    announceSquare: announceSquare,
    readRow: readRow,
    readColumn: readColumn,
    readBoard: readBoard,
    readWords: readWords,              // Shift+B: every maximal word on the board (NOTE 2)
    readWordsThrough: readWordsThrough,

    // Jumps
    jumpToCoord: jumpToCoord,
    jumpToCenter: jumpToCenter,
    nextAnchor: nextAnchor,
    nextPremium: nextPremium,

    // Wording (shared with cell aria-labels)
    squareLabel: squareLabel,

    // "Go to coordinate" mini-dialog hooks required by SC.Game.handleKey
    // (SPEC-housestyle §3.1): the G key opens it; dispatch checks isCoordInputOpen.
    openCoordInput: openCoordInput,
    closeCoordInput: closeCoordInput,
    isCoordInputOpen: isCoordInputOpen,
    coordInputKey: coordInputKey
  };
})();
