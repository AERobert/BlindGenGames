/*
 * rules.js — Placement validation and scoring for Accessible Scrabble.
 *
 * Exposes SC.Rules. This module is PURE: no DOM, no SC.State mutation, and no
 * board copying. It reads a committed board plus a list of pending Placements
 * through a small overlay "view" and answers four questions:
 *
 *   validatePlacement(board, placements, isFirstMove) -> {valid, reason}
 *   wordsFormed(board, placements)                    -> [{word, dir, cells}]
 *   scorePlay(board, placements)                      -> {score, words, isBingo}
 *   evaluatePlay(board, placements, isFirstMove, dir) -> Move  (validate+score+dictionary)
 *
 * Only evaluatePlay touches the dictionary (SC.Dict); the other three are
 * dictionary-free so the AI can call them millions of times cheaply.
 *
 * Per ARCHITECTURE.md §0, other SC modules are grabbed LAZILY inside functions
 * (never at load time) so script order is not fragile and Node tests can shim
 * `window`. See research/SPEC-scoring.md for the authoritative algorithm and the
 * 11 hand-verified scoring vectors, and SCRABBLE_RULES.md §3/§5/§6/§7/§14 for
 * the rules these implement.
 */
(function () {
  // Shared global namespace, created by whichever module loads first.
  window.SC = window.SC || {};

  // Lazy SC.Data handle (load-order independence; see SPEC-scoring.md §1.2).
  var D = null;
  function data() { return D || (D = SC.Data); }

  // ===========================================================================
  // 1. Shared helpers
  // ===========================================================================

  /*
   * buildView(board, placements) — the overlay getter (SPEC-scoring.md §1.2).
   *
   * Returns "the effective tile at (r,c) given these pending placements" without
   * ever mutating the board. Pending placements are indexed in an O(1) map keyed
   * "row,col". `at` returns a committed-or-pending Tile (or null); `isPending`
   * tells whether a given cell is supplied by a NEW (this-turn) tile, which is
   * how scoring decides where premiums apply.
   */
  function buildView(board, placements) {
    var pend = {};                                  // "r,c" -> Tile
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      pend[p.row + ',' + p.col] = p.tile;
    }
    return {
      isPending: function (r, c) {
        return Object.prototype.hasOwnProperty.call(pend, r + ',' + c);
      },
      at: function (r, c) {
        if (!data().inBounds(r, c)) return null;    // off-board reads are empty
        var k = r + ',' + c;
        if (Object.prototype.hasOwnProperty.call(pend, k)) return pend[k];
        return board[r][c];
      }
    };
  }

  /*
   * inferDirection(view, placements) — pick the play's main-word axis.
   *
   * With 2+ collinear tiles the axis is forced by the placements. With exactly
   * one new tile the axis is whichever side has a neighbour (preferring 'across'
   * when a tile has neighbours on both axes — a harmless, deterministic
   * convention; the set of scored words is the same either way, so the total is
   * direction-independent). Returns null only when 2+ tiles are not in a line
   * (validation rejects that case). See SPEC-scoring.md §1.3.
   */
  function inferDirection(view, placements) {
    if (placements.length >= 2) {
      var sameRow = true, sameCol = true;
      var r0 = placements[0].row, c0 = placements[0].col;
      for (var i = 1; i < placements.length; i++) {
        if (placements[i].row !== r0) sameRow = false;
        if (placements[i].col !== c0) sameCol = false;
      }
      if (sameRow && !sameCol) return 'across';
      if (sameCol && !sameRow) return 'down';
      if (sameRow && sameCol) return 'across';      // duplicate cell — validation catches it
      return null;                                  // neither: not a single line
    }
    // Exactly one new tile: direction follows an existing neighbour.
    var p = placements[0];
    var horiz = view.at(p.row, p.col - 1) || view.at(p.row, p.col + 1);
    var vert  = view.at(p.row - 1, p.col) || view.at(p.row + 1, p.col);
    if (horiz) return 'across';                      // prefer across when both exist
    if (vert)  return 'down';
    return 'across';                                 // isolated tile (illegal — caller's problem)
  }

  /*
   * collectWord(view, r, c, dir) — the maximal contiguous run through (r,c).
   *
   * Walks back to the start of the run, then forward to its end, recording one
   * tagged cell per square. Returns null when the run is a single tile (a lone
   * letter is not a "word"). Each cell carries everything a caller needs:
   *   row, col      — position
   *   letter        — resolved 'A'..'Z' (for a blank, its assigned letter)
   *   isBlank       — true for a blank tile (for "blank as X" narration)
   *   fromBoard     — true = pre-existing committed tile (no premium re-applies)
   *   points        — face value (0 for a blank); copied here so scoreWord stays
   *                   pure and need not rebuild the view (SPEC-scoring.md §4.1)
   * `word` is UPPERCASE. See SPEC-scoring.md §1.4.
   */
  function collectWord(view, r, c, dir) {
    var dr = (dir === 'down') ? 1 : 0;
    var dc = (dir === 'down') ? 0 : 1;

    // Walk to the first filled cell of the run.
    var sr = r, sc = c;
    while (view.at(sr - dr, sc - dc) !== null) { sr -= dr; sc -= dc; }

    // Walk forward to the end, building the word and its tagged cells.
    var cells = [];
    var str = '';
    var cr = sr, cc = sc;
    var t = view.at(cr, cc);
    while (t !== null) {
      cells.push({
        row: cr,
        col: cc,
        letter: t.letter,
        isBlank: t.isBlank,
        fromBoard: !view.isPending(cr, cc),
        points: t.points
      });
      str += t.letter;
      cr += dr; cc += dc;
      t = view.at(cr, cc);
    }

    if (cells.length < 2) return null;               // lone letter is not a word
    return { word: str, dir: dir, cells: cells };
  }

  // Tiny result constructors for validatePlacement (DRY + readable).
  function ok() { return { valid: true, reason: null }; }
  function fail(msg) { return { valid: false, reason: msg }; }

  // ===========================================================================
  // 2. validatePlacement — legality of WHERE tiles go (not dictionary validity)
  // ===========================================================================

  /*
   * validatePlacement(board, placements, isFirstMove) -> {valid, reason}
   *
   * Returns the FIRST failure with a human-readable reason (the UI speaks it).
   * Word validity (dictionary) is intentionally NOT checked here — that lives in
   * evaluatePlay. Checks, in order (SPEC-scoring.md §2.1, SCRABBLE_RULES.md §5):
   *   C1  at least one tile placed
   *   C2  each placement in bounds, onto an empty board cell, no duplicate cell,
   *       and no unassigned blank
   *   C3  all placements in a single row OR a single column
   *   C4  contiguous (incl. existing tiles) — no gaps between the extreme tiles
   *   C5a first move: >=2 tiles AND covers the center (H8)
   *   C5b later move: at least one new tile orthogonally touches a committed tile
   */
  function validatePlacement(board, placements, isFirstMove) {
    var Data = data();

    // --- C1: at least one tile placed --------------------------------------
    if (!placements || placements.length === 0) {
      return fail('Place at least one tile.');
    }

    var view = buildView(board, placements);

    // --- C2: bounds + empty target + no duplicate cell + no blank-unassigned -
    var seen = {};
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      if (!Data.inBounds(p.row, p.col)) {
        return fail('Tile ' + Data.coordToString(p.row, p.col) + ' is off the board.');
      }
      if (board[p.row][p.col] !== null) {
        return fail(Data.coordToString(p.row, p.col) + ' is already occupied.');
      }
      var key = p.row + ',' + p.col;
      if (seen[key]) {
        return fail('Two tiles placed on ' + Data.coordToString(p.row, p.col) + '.');
      }
      seen[key] = true;
      // Defensive: an unassigned blank must be given a letter (UI "C(A)T") first.
      if (p.tile.letter === null || p.tile.letter === undefined) {
        return fail('Assign a letter to the blank before placing it.');
      }
    }

    // --- C3: all placements in one line ------------------------------------
    var sameRow = true, sameCol = true;
    var r0 = placements[0].row, c0 = placements[0].col;
    for (i = 1; i < placements.length; i++) {
      if (placements[i].row !== r0) sameRow = false;
      if (placements[i].col !== c0) sameCol = false;
    }
    if (!sameRow && !sameCol) {
      return fail('All tiles must be in a single row or column.');
    }
    // Direction for the contiguity scan. With 2+ tiles it is forced by C3; with
    // exactly one tile we use neighbour inference so the gap scan is a no-op.
    var dir;
    if (placements.length === 1) {
      dir = inferDirection(view, placements);
    } else {
      dir = sameRow ? 'across' : 'down';            // sameRow && sameCol impossible after C2
    }

    // --- C4: contiguous incl. existing tiles (no gaps) ---------------------
    // Every cell between the extreme NEW tiles (inclusive) along `dir` must be
    // filled — by a new OR an existing tile (the overlay view sees both), which
    // is what lets a play run THROUGH committed tiles.
    if (dir === 'across') {
      var line = placements[0].row;
      var lo = c0, hi = c0;
      for (i = 1; i < placements.length; i++) {
        if (placements[i].col < lo) lo = placements[i].col;
        if (placements[i].col > hi) hi = placements[i].col;
      }
      for (var c = lo; c <= hi; c++) {
        if (view.at(line, c) === null) {
          return fail('Gap at ' + Data.coordToString(line, c) +
                      ' — tiles must be contiguous.');
        }
      }
    } else {
      var col = placements[0].col;
      var loR = r0, hiR = r0;
      for (i = 1; i < placements.length; i++) {
        if (placements[i].row < loR) loR = placements[i].row;
        if (placements[i].row > hiR) hiR = placements[i].row;
      }
      for (var r = loR; r <= hiR; r++) {
        if (view.at(r, col) === null) {
          return fail('Gap at ' + Data.coordToString(r, col) +
                      ' — tiles must be contiguous.');
        }
      }
    }

    // --- C5a: FIRST MOVE -> >=2 tiles AND covers the center ----------------
    if (isFirstMove) {
      if (placements.length < 2) {
        return fail('The first word must be at least two letters.');
      }
      var coversCenter = false;
      for (i = 0; i < placements.length; i++) {
        if (placements[i].row === Data.CENTER.row &&
            placements[i].col === Data.CENTER.col) { coversCenter = true; break; }
      }
      if (!coversCenter) {
        return fail('The first word must cover the center square ' +
                    Data.coordToString(Data.CENTER.row, Data.CENTER.col) + '.');
      }
      return ok();
    }

    // --- C5b: SUBSEQUENT MOVE -> must connect to existing tiles -------------
    // Adjacency to a COMMITTED neighbour is a complete connectivity test: an
    // extension touches an existing tile end-to-end, and a parallel hook shares
    // a perpendicular committed neighbour; a wholly detached word has neither.
    // (See SPEC-scoring.md §2.2.)
    var neighbours = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (i = 0; i < placements.length; i++) {
      var pp = placements[i];
      for (var n = 0; n < neighbours.length; n++) {
        var nr = pp.row + neighbours[n][0];
        var nc = pp.col + neighbours[n][1];
        if (Data.inBounds(nr, nc) && board[nr][nc] !== null) {
          return ok();                              // found a committed neighbour
        }
      }
    }
    return fail('New tiles must connect to tiles already on the board.');
  }

  // ===========================================================================
  // 3. wordsFormed — every scoring word this play creates
  // ===========================================================================

  /*
   * wordsFormed(board, placements) -> [{word, dir, cells}]
   *
   * Main word first, then one cross-word per new tile that has a perpendicular
   * neighbour. Only words >=2 letters are returned (collectWord drops lone
   * letters). Cross-words are inherently distinct (each passes through exactly
   * one new tile; two new tiles on the same perpendicular line would BE the main
   * word), so no de-duplication is needed. The function is TOTAL even on inputs
   * validation would reject. See SPEC-scoring.md §3.
   */
  function wordsFormed(board, placements) {
    if (!placements || placements.length === 0) return [];
    var view = buildView(board, placements);
    var dir = inferDirection(view, placements);
    var cross = (dir === 'down') ? 'across' : 'down';
    var out = [];

    // MAIN word: any new tile lands on the same maximal run (they are collinear).
    var p0 = placements[0];
    var main = collectWord(view, p0.row, p0.col, dir);
    if (main) out.push(main);

    // CROSS words: one per new tile, perpendicular to the main direction.
    // collectWord returns null when there is no perpendicular neighbour, so only
    // genuine >=2-letter cross-words are emitted.
    for (var i = 0; i < placements.length; i++) {
      var w = collectWord(view, placements[i].row, placements[i].col, cross);
      if (w) out.push(w);
    }
    return out;
  }

  // ===========================================================================
  // 4. scorePlay — total points (premiums + bingo), no validity checks
  // ===========================================================================

  /*
   * scoreWord(word) — score one word object from wordsFormed.
   *
   * SCRABBLE_RULES.md §6: letter premiums (DLS/TLS) apply FIRST to each NEW
   * tile's value, then word premiums (DWS/TWS) multiply the whole word total,
   * MULTIPLYING together when more than one (DWS+DWS=x4, DWS+TWS=x6, TWS+TWS=x9).
   * Premiums apply ONLY under newly placed tiles; existing tiles count at face
   * value. Blanks contribute 0 letter value (tile.points==0) yet a blank on a
   * word-premium square still triggers that word multiplier — handled for free.
   */
  function scoreWord(word) {
    var Data = data();
    var letterSum = 0;
    var wordMult = 1;
    for (var i = 0; i < word.cells.length; i++) {
      var cell = word.cells[i];
      var base = cell.points;                        // 0 for a blank
      if (cell.fromBoard) {
        letterSum += base;                           // existing tile: no premium
      } else {
        var prem = Data.premiumAt(cell.row, cell.col);  // descriptor or null
        var lMult = prem ? prem.letter : 1;
        var wMult = prem ? prem.word : 1;
        letterSum += base * lMult;                   // letter premium first
        wordMult *= wMult;                           // accumulate word premiums
      }
    }
    return letterSum * wordMult;
  }

  /*
   * scoreWordList(words, tileCount) — score an already-assembled list of words.
   *
   * Shared by scorePlay and evaluatePlay so the per-word `breakdown` is ALWAYS
   * index-aligned with whatever word list the caller built (e.g. one ordered by a
   * caller-supplied single-tile direction). Adds +50 iff EXACTLY `tileCount`
   * (the number of tiles placed this turn) is 7 — a bingo, not merely "emptied
   * the rack". The total is independent of word order, so reusing this is safe.
   */
  function scoreWordList(words, tileCount) {
    var total = 0;
    var breakdown = [];
    for (var i = 0; i < words.length; i++) {
      var s = scoreWord(words[i]);
      total += s;
      breakdown.push({ word: words[i].word, score: s });
    }
    var isBingo = (tileCount === 7);
    if (isBingo) total += 50;
    return { score: total, words: breakdown, isBingo: isBingo };
  }

  /*
   * scorePlay(board, placements) -> {score, words:[{word,score}], isBingo}
   *
   * Sums every word the play forms, then adds +50 for a 7-tile bingo. Assumes a
   * legal placement — does NOT check placement or dictionary validity
   * (evaluatePlay gates those), keeping this a fast, pure primitive the AI calls
   * many times. See SPEC-scoring.md §4.2.
   */
  function scorePlay(board, placements) {
    var words = wordsFormed(board, placements);
    return scoreWordList(words, placements ? placements.length : 0);
  }

  // ===========================================================================
  // 5. evaluatePlay — the convenience Move builder (validate + score + dictionary)
  // ===========================================================================

  // Strip tagged cells down to the {row,col} shape used by Move.mainWord.cells /
  // Move.crossWords[].cells (ARCHITECTURE.md §2). The full tagged cells remain
  // available via wordsFormed for new-vs-old / blank narration.
  function cellsXY(cells) {
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      out.push({ row: cells[i].row, col: cells[i].col });
    }
    return out;
  }

  /*
   * evaluatePlay(board, placements, isFirstMove, dir) -> Move
   *
   * The entry used by the Composer preview and tile-by-tile "verify (Y)". Builds
   * the full Move shape (ARCHITECTURE.md §2) by combining placement validation,
   * word assembly, scoring, and DICTIONARY validity.
   *
   * `dir` is OPTIONAL ('across'|'down'), per ARCHITECTURE.md §7.2: with 2+
   * collinear tiles it is inferred; for a SINGLE tile the caller may pass it to
   * choose which axis is the "main" word (default inference prefers 'across').
   * The set of words scored is identical either way, so the TOTAL is unaffected.
   *
   * Per ARCHITECTURE.md §7.3 / SPEC-scoring.md §5: when a formed word is not in
   * the dictionary, the would-be `score` is still reported (so the UI can say
   * "would score N, but FOO isn't a word") with valid:false and `reason` naming
   * the offending word. The controller blocks commit on valid:false.
   */
  function evaluatePlay(board, placements, isFirstMove, dir) {
    var Dict = SC.Dict;                              // lazy: only evaluatePlay uses it
    var view = buildView(board, placements || []);

    // Resolve direction: honour a caller-supplied single-tile direction; else
    // infer. (With 2+ collinear tiles `dir` is ignored — the axis is forced.)
    var resolvedDir;
    if (placements && placements.length === 1 &&
        (dir === 'across' || dir === 'down')) {
      resolvedDir = dir;
    } else {
      resolvedDir = inferDirection(view, placements || []);
    }

    // Baseline Move skeleton so callers always get a consistent shape. The AI
    // fills leave/equity later; we leave them at neutral defaults here.
    var move = {
      row: null, col: null, dir: resolvedDir,
      word: '', placements: placements || [],
      mainWord: null, crossWords: [],
      score: 0, isBingo: false,
      valid: false, reason: null,
      leave: null, equity: 0
    };

    // 1) PLACEMENT legality (geometry only — not the dictionary).
    var v = validatePlacement(board, placements, isFirstMove);
    if (!v.valid) {
      move.reason = v.reason;
      return move;
    }

    // 2) WORDS + SCORE. Assemble the formed words using the SAME main direction
    //    we resolved (so a caller-supplied single-tile `dir` is reflected in
    //    mainWord vs crossWords), then score that exact list so the per-word
    //    breakdown stays index-aligned. Done BEFORE the dictionary check so an
    //    invalid play can still report its would-be score (friendly a11y UX).
    var words = wordsFormedFor(view, placements, resolvedDir);
    var sc = scoreWordList(words, placements ? placements.length : 0);
    move.score = sc.score;
    move.isBingo = sc.isBingo;
    if (words.length > 0) {
      var m = words[0];
      move.mainWord = { word: m.word, score: sc.words[0].score, cells: cellsXY(m.cells) };
      move.word = m.word;
      move.row = m.cells[0].row;                     // top/left-most cell of main word
      move.col = m.cells[0].col;
      for (var i = 1; i < words.length; i++) {
        move.crossWords.push({
          word: words[i].word,
          score: sc.words[i].score,
          cells: cellsXY(words[i].cells)
        });
      }
    }

    // 3) DICTIONARY validity — EVERY formed word must be a dictionary word.
    var bad = null;
    for (var j = 0; j < words.length; j++) {
      if (!Dict.isWord(words[j].word)) { bad = words[j].word; break; }
    }
    if (bad !== null) {
      move.valid = false;
      move.reason = '"' + bad + '" is not a valid word.';
      return move;
    }

    // 4) All words legal.
    move.valid = true;
    move.reason = null;
    return move;
  }

  /*
   * wordsFormedFor(view, placements, dir) — wordsFormed with an EXPLICIT main
   * direction. Shares all logic with wordsFormed (DRY) but lets evaluatePlay
   * honour a caller-supplied single-tile direction. The scored word SET is the
   * same regardless of which axis is "main", so scorePlay's per-word breakdown
   * stays index-aligned with this list: main word first, then cross-words in
   * placement order — identical ordering to wordsFormed/scorePlay.
   */
  function wordsFormedFor(view, placements, dir) {
    if (!placements || placements.length === 0) return [];
    var cross = (dir === 'down') ? 'across' : 'down';
    var out = [];
    var p0 = placements[0];
    var main = collectWord(view, p0.row, p0.col, dir);
    if (main) out.push(main);
    for (var i = 0; i < placements.length; i++) {
      var w = collectWord(view, placements[i].row, placements[i].col, cross);
      if (w) out.push(w);
    }
    return out;
  }

  // ===========================================================================
  // Public API (exactly ARCHITECTURE.md §3 SC.Rules + §7.2 optional `dir`).
  // ===========================================================================
  SC.Rules = {
    validatePlacement: validatePlacement,
    wordsFormed: wordsFormed,
    scorePlay: scorePlay,
    evaluatePlay: evaluatePlay
  };
})();
