/*
 * ai.js — SC.AI: move generation, leave evaluation, and difficulty tiers.
 *
 * Implements two specs:
 *   research/SPEC-movegen.md  — Appel-Jacobson move generation over SC.Dawg
 *                               (anchors + per-square cross-check sets, LeftPart /
 *                               ExtendRight, blanks as wildcards, down-plays via a
 *                               transposed board view, special-cased first move).
 *   research/SPEC-leaves.md   — the verified heuristic leaveValue(), the
 *                               easy/medium/hard/expert chooseMove() tiers, the
 *                               expert Monte-Carlo rollout with kill-switch +
 *                               hard fallback, recommendExchange(), findHints().
 *
 * Contract (ARCHITECTURE.md §3 / §7):
 *   SC.AI.generateMoves(board, rack, isFirstMove) -> Move[]
 *   SC.AI.chooseMove(board, rack, difficulty, isFirstMove) -> Move | null
 *   SC.AI.leaveValue(leaveStr) -> Number          (blank = '?')
 *   SC.AI.recommendExchange(board, rack) -> Tile[] | null   (tiles to TOSS)
 *   SC.AI.findHints(board, rack, isFirstMove, n) -> Move[]
 *   SC.AI.allowSimulation                          (bool kill-switch for expert)
 *   SC.AI._rng                                     (injectable RNG for tests)
 *   SC.AI.LEAVE                                    (tunable heuristic constants)
 *
 * Hard constraints honored: plain ES5-ish JS (var + IIFE), no ES modules, no
 * fetch, no async, runs from file://, attaches to window.SC, references other
 * SC.* modules ONLY inside functions (load-order independent), pure logic with no
 * DOM access (Node-testable with a `global.window = global` shim).
 *
 * Scoring is NOT duplicated here: every candidate's authoritative score / words /
 * validity come from SC.Rules.evaluatePlay (DRY, single source). The generator
 * only does geometry + DAWG walking + leave/equity bookkeeping.
 */
(function () {
  // Shared global namespace, created by whichever module loads first.
  window.SC = window.SC || {};

  // Lazily-grabbed module handles (resolved on first use, never at load time, so
  // script order in index.html is not fragile — ARCHITECTURE.md §0).
  var _Data = null, _Dict = null, _Rules = null, _State = null;
  function Data()  { return _Data  || (_Data  = SC.Data); }
  function Dict()  { return _Dict  || (_Dict  = SC.Dict); }
  function Rules() { return _Rules || (_Rules = SC.Rules); }
  function State() { return _State || (_State = SC.State); }

  // The DAWG facade lives on SC.Dict.dawg (ARCHITECTURE.md §3). Grab per call.
  function dawg() { return Dict().dawg; }

  var BOARD = 15;                 // board edge length (== SC.Data.BOARD_SIZE)
  var ALL_BITS = (1 << 26) - 1;   // "any letter allowed" cross-check mask
  var A_CODE = 65;                // 'A'.charCodeAt(0)

  // =========================================================================
  // SECTION 1 — LEAVE VALUE (verified heuristic, SPEC-leaves §3-§4)
  // =========================================================================
  //
  // A "leave" is the rack remainder after a play, as an UPPERCASE string with an
  // unused blank written '?'. leaveValue() returns its estimated future-equity in
  // points (same unit as score), so equity = score + leaveValue(leave).
  //
  // Every constant lives in the LEAVE config so it is auditable and test-tunable
  // (SPEC-leaves §5). The exact numbers below are the ones the spec validated
  // against published Quackle/Valett anchors (§4, §8).

  var LEAVE = {
    // §4.1 base single-tile values (expected future-equity, NOT face score).
    BASE: {
      A: 1.5, B: -3.5, C: -0.5, D: 0.0, E: 2.5, F: -3.5, G: -3.0, H: -1.0,
      I: -1.0, J: -3.0, K: -1.5, L: 0.5, M: -0.5, N: 1.5, O: -1.0, P: -2.0,
      Q: -6.0, R: 1.5, S: 7.0, T: 1.0, U: -3.5, V: -5.5, W: -4.5, X: 1.5,
      Y: -2.5, Z: 1.0
    },
    BASE_BLANK: 25.0,           // a blank is the single most valuable tile

    // §4.3 duplicate penalty (super-linear).
    DUP_STEP_COMMON: 3.0,       // penalty for the 2nd copy of a "common" letter
    DUP_STEP_OTHER: 6.0,        // ... for any other letter
    DUP_GROWTH: 1.6,            // each further copy costs GROWTH x the previous
    COMMON: { E: 1, A: 1, I: 1, O: 1, U: 1, S: 1, R: 1, T: 1, N: 1, L: 1 },

    // §4.4 vowel/consonant balance (ideal consonant share 60%).
    VOWELS: { A: 1, E: 1, I: 1, O: 1, U: 1 },   // Y treated as a consonant here
    BALANCE_PER_TILE: 5.0,      // points per tile off the ideal mix
    VOWEL_GLUT_EXTRA: 2.5,      // extra per surplus vowel (gluts hurt most)
    BALANCE_MIN_TILES: 3,       // balance only applies to 3+ non-blank tiles

    // §4.5 special interactions.
    Q_NO_U_PENALTY: 6.0,        // a Q with no U and no blank to play it
    SECOND_BLANK: 3.0,          // tiny extra for holding both blanks
    BLANK_S_BONUS: 1.5,         // blank + S synergy (bingo-prone)

    // §4.6 bingo-stem synergy (lifts the AERST/SATINE family to table values).
    STEM: {
      E: 1, A: 1, I: 1, N: 1, R: 1, T: 1, S: 1, L: 1, O: 1, D: 1, U: 1, G: 1,
      C: 1, P: 1, M: 1, H: 1, B: 1
    },
    STEM_BONUS_PER_TILE: 3.4,

    // §4.2(f) clamp so a pathological leave can't dominate.
    CLAMP_HI: 60,
    CLAMP_LO: -40
  };

  // Pre-build a 26-element BASE array indexed by (charCode-65) for fast lookup,
  // derived once from the readable BASE map above (SPEC-leaves §4.1 note).
  var BASE_ARR = (function () {
    var arr = new Array(26), i;
    var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (i = 0; i < 26; i++) arr[i] = LEAVE.BASE[letters.charAt(i)] || 0;
    return arr;
  })();

  // Memoization cache keyed by the canonical (sorted) leave string (SPEC §3).
  var LEAVE_CACHE = {};

  // Build {counts:[26], blanks, len} from a leave string (SPEC-leaves §3).
  // `len` counts ONLY valid tiles (A-Z letters + blanks); stray non-A-Z/non-'?'
  // characters are ignored entirely so they cannot inflate the tile count and
  // corrupt the balance/stem gating (defensive input handling, SPEC §7.9).
  function tallyLeave(leaveStr) {
    var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var blanks = 0, len = 0, i, ch, code;
    for (i = 0; i < leaveStr.length; i++) {
      ch = leaveStr.charAt(i);
      if (ch === '?') { blanks++; len++; continue; }   // blank glyph
      code = leaveStr.charCodeAt(i) - A_CODE;          // 'A' -> 0
      if (code >= 0 && code < 26) { counts[code]++; len++; }  // ignore non-A-Z
    }
    return { counts: counts, blanks: blanks, len: len };
  }

  // §4.3 duplicate penalty: charge a growing penalty for the 2nd, 3rd, ... copy.
  function duplicatePenalty(t) {
    var pen = 0, i, n, isCommon, step, extra, k, letter;
    for (i = 0; i < 26; i++) {
      n = t.counts[i];
      if (n < 2) continue;
      letter = String.fromCharCode(A_CODE + i);
      isCommon = LEAVE.COMMON[letter] ? true : false;
      step = isCommon ? LEAVE.DUP_STEP_COMMON : LEAVE.DUP_STEP_OTHER;
      // copy #2 costs `step`, #3 costs step*GROWTH, #4 costs step*GROWTH^2, ...
      extra = step;
      for (k = 2; k <= n; k++) { pen -= extra; extra *= LEAVE.DUP_GROWTH; }
    }
    // Two blanks is a dream leave; only a tiny anti-greed nudge (SPEC §4.3).
    if (t.blanks >= 2) pen -= 2.0 * (t.blanks - 1);
    return pen;
  }

  // Ideal vowel count for an n-tile leave (complement of the 60% consonant ideal).
  function idealVowels(n) { return n - Math.round(0.6 * n); }

  // §4.4 vowel/consonant balance. Only meaningful for 3+ non-blank tiles (gating
  // a single vowel as "imbalanced" was a real bug — see SPEC-leaves §4.4).
  function balanceAdjustment(t) {
    var nonBlank = t.len - t.blanks;
    if (nonBlank < LEAVE.BALANCE_MIN_TILES) return 0;
    var vowels = 0, consonants = 0, i, letter;
    for (i = 0; i < 26; i++) {
      if (!t.counts[i]) continue;
      letter = String.fromCharCode(A_CODE + i);
      if (LEAVE.VOWELS[letter]) vowels += t.counts[i];
      else consonants += t.counts[i];
    }
    var idealC = Math.round(0.6 * nonBlank);
    var gap = Math.abs(consonants - idealC);
    gap = Math.max(0, gap - t.blanks);          // blanks absorb imbalance (wild)
    var adj = -LEAVE.BALANCE_PER_TILE * gap;
    // Vowel-heavy is worse than consonant-heavy.
    if (vowels - (nonBlank - vowels) >= 2) {
      adj -= LEAVE.VOWEL_GLUT_EXTRA * (vowels - idealVowels(nonBlank));
    }
    return adj;
  }

  // §4.5 a naked Q (no U and no blank to enable it) is a heavy liability in ENABLE.
  function qWithoutUPenalty(t) {
    var q = t.counts['Q'.charCodeAt(0) - A_CODE];
    if (!q) return 0;
    var u = t.counts['U'.charCodeAt(0) - A_CODE];
    if (u > 0 || t.blanks > 0) return 0;        // a U or blank rescues the Q
    return -LEAVE.Q_NO_U_PENALTY * q;
  }

  // §4.5 small blank-synergy bonuses (2nd blank, blank+S).
  function blankSynergyBonus(t) {
    var bonus = 0;
    if (t.blanks >= 2) bonus += LEAVE.SECOND_BLANK;
    if (t.blanks >= 1 && t.counts['S'.charCodeAt(0) - A_CODE] >= 1) {
      bonus += LEAVE.BLANK_S_BONUS;
    }
    return bonus;
  }

  // §4.6 bingo-stem synergy: a tightly-gated bonus for a balanced, dup-free set of
  // common "stem" letters (the AERST/SATINE family). Each gate prevents a known
  // false positive (see SPEC-leaves §4.6).
  function stemSynergyBonus(t) {
    var nonBlank = t.len - t.blanks;
    if (nonBlank < 3 || nonBlank > 6) return 0;     // stems are 3-6 tiles
    var vowels = 0, consonants = 0, allStem = true, hasDup = false, i, letter;
    for (i = 0; i < 26; i++) {
      if (!t.counts[i]) continue;
      if (t.counts[i] > 1) hasDup = true;           // dups kill stem-ness
      letter = String.fromCharCode(A_CODE + i);
      if (!LEAVE.STEM[letter]) allStem = false;     // any heavy/odd tile disqualifies
      if (LEAVE.VOWELS[letter]) vowels += t.counts[i];
      else consonants += t.counts[i];
    }
    if (!allStem || hasDup) return 0;
    if (consonants < vowels) return 0;              // must NOT be vowel-heavy
    var idealC = Math.round(0.6 * nonBlank);
    if (Math.abs(consonants - idealC) > 1) return 0; // must be near 60:40
    return LEAVE.STEM_BONUS_PER_TILE * nonBlank;
  }

  // §4.2 accumulation skeleton: sum base values + structured corrections, clamp.
  // `key` is the canonical (sorted) uppercase leave string.
  function computeLeaveValue(key) {
    var t = tallyLeave(key);
    var v = 0, i;

    // (a) base per-tile values
    for (i = 0; i < 26; i++) {
      if (t.counts[i]) v += t.counts[i] * BASE_ARR[i];
    }
    v += t.blanks * LEAVE.BASE_BLANK;

    // (b)-(e) structured corrections
    v += duplicatePenalty(t);
    v += balanceAdjustment(t);
    v += qWithoutUPenalty(t);
    v += blankSynergyBonus(t);
    v += stemSynergyBonus(t);

    // (f) clamp to the real-table range
    if (v > LEAVE.CLAMP_HI) v = LEAVE.CLAMP_HI;
    if (v < LEAVE.CLAMP_LO) v = LEAVE.CLAMP_LO;
    return v;
  }

  /*
   * Public leaveValue (SPEC-leaves §5). Pure, DOM-free, cached.
   *   input : uppercase leave string, blanks as '?', length 0..7 (defensive
   *           toUpperCase; order-insensitive via canonical sort; non-A-Z/? ignored).
   *   output: Number in points, clamped to [CLAMP_LO, CLAMP_HI].
   * Empty leave -> 0 (a rack-emptying play's value is its +50 bingo, not here).
   */
  function leaveValue(leaveStr) {
    if (leaveStr == null || leaveStr.length === 0) return 0;
    // Canonical key: uppercase + sort. '?' sorts after 'Z' naturally, grouping blanks.
    var key = String(leaveStr).toUpperCase().split('').sort().join('');
    var hit = LEAVE_CACHE[key];
    if (hit !== undefined) return hit;
    var v = computeLeaveValue(key);
    LEAVE_CACHE[key] = v;
    return v;
  }

  // =========================================================================
  // SECTION 2 — SHARED MOVE-GEN HELPERS (SPEC-movegen §1)
  // =========================================================================

  // Flatten a rack into a fast availability tally plus the original Tile objects
  // (kept so emitted placements carry real ids the UI/state need).
  //   rackTally['A'..'Z'] : count of each plain letter
  //   rackTally.blank     : number of unassigned blanks
  //   rackTiles['A'..'Z'] : [Tile, ...]   pools to draw real ids from
  //   rackTiles.blank     : [Tile, ...]
  function tally(rack) {
    var rackTally = { blank: 0 };
    var rackTiles = { blank: [] };
    var i, k, t, ch;
    var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (k = 0; k < 26; k++) {
      rackTally[letters.charAt(k)] = 0;
      rackTiles[letters.charAt(k)] = [];
    }
    for (i = 0; i < rack.length; i++) {
      t = rack[i];
      if (t.isBlank) { rackTally.blank++; rackTiles.blank.push(t); }
      else {
        ch = t.letter;                  // uppercase 'A'..'Z'
        if (rackTally[ch] != null) { rackTally[ch]++; rackTiles[ch].push(t); }
      }
    }
    return { rackTally: rackTally, rackTiles: rackTiles };
  }

  // letterGrid[r][c] = uppercase letter of a committed tile, else null
  // (SPEC-movegen §1 — a played blank uses its assigned letter; its blankness
  //  does NOT matter to generation, only to scoring which SC.Rules owns).
  function deriveLetters(grid) {
    var lg = new Array(BOARD), r, c, cell;
    for (r = 0; r < BOARD; r++) {
      lg[r] = new Array(BOARD);
      for (c = 0; c < BOARD; c++) {
        cell = grid[r][c];
        lg[r][c] = cell ? cell.letter : null;
      }
    }
    return lg;
  }

  // Transposed VIEW of the board (board[r][c] -> view[c][r]); cells are the same
  // Tile refs (read-only). Used to run the identical across-generator on the
  // "down" orientation without writing the geometry twice (SPEC-movegen §0/§5).
  function transpose(board) {
    var t = new Array(BOARD), r, c;
    for (r = 0; r < BOARD; r++) t[r] = new Array(BOARD);
    for (r = 0; r < BOARD; r++) {
      for (c = 0; c < BOARD; c++) t[c][r] = board[r][c];
    }
    return t;
  }

  // Map a generation coordinate (always in the across-oriented working grid) back
  // to a REAL board coordinate. For 'across' it's identity; for 'down' the working
  // grid is the transpose, so (r,c) -> (c,r).
  function realRow(r, c, dir) { return dir === 'down' ? c : r; }
  function realCol(r, c, dir) { return dir === 'down' ? r : c; }

  // Is the board entirely empty? (opening detection, SPEC-movegen §5 top level)
  function boardIsEmpty(board) {
    for (var r = 0; r < BOARD; r++) {
      for (var c = 0; c < BOARD; c++) if (board[r][c]) return false;
    }
    return true;
  }

  // Anchor test (SPEC-movegen §2): an empty square orthogonally adjacent to an
  // occupied one. New non-opening words must touch the board, so every legal play
  // covers an anchor.
  function isAnchor(lg, r, c) {
    if (lg[r][c] != null) return false;
    return (r > 0        && lg[r - 1][c] != null) ||
           (r < BOARD - 1 && lg[r + 1][c] != null) ||
           (c > 0        && lg[r][c - 1] != null) ||
           (c < BOARD - 1 && lg[r][c + 1] != null);
  }

  // Walk the DAWG from root through a lowercase string; return the node handle or
  // -1 if the path leaves the DAWG (SPEC-movegen §5 `walk`).
  function walk(D, fromNode, lowerStr) {
    var h = fromNode, i;
    for (i = 0; i < lowerStr.length; i++) {
      h = D.edge(h, lowerStr.charAt(i));
      if (h === -1) return -1;
    }
    return h;
  }

  // =========================================================================
  // SECTION 3 — CROSS-CHECK SETS (SPEC-movegen §3)
  // =========================================================================
  //
  // For each empty square, in the across pass the perpendicular word runs
  // vertically. crossBits[r][c] is a 26-bit mask of letters that form a valid
  // vertical word there; crossScore[r][c] is the summed face value of the existing
  // vertical neighbours (the fixed part of that cross word's score, used only by
  // the optional fast internal score — authoritative scoring is SC.Rules').

  // Build crossBits/crossScore for the whole working grid (perpendicular = vertical
  // in the across-oriented grid). Returns {bits, score} as 15x15 arrays.
  function computeCrossSets(D, lg) {
    var bits = new Array(BOARD), score = new Array(BOARD), r, c;
    for (r = 0; r < BOARD; r++) { bits[r] = new Array(BOARD); score[r] = new Array(BOARD); }
    for (r = 0; r < BOARD; r++) {
      for (c = 0; c < BOARD; c++) {
        if (lg[r][c] != null) { bits[r][c] = 0; score[r][c] = 0; continue; }

        // Collect the contiguous vertical neighbours above and below (r,c).
        var up = '', down = '', rr, sc = 0;
        for (rr = r - 1; rr >= 0 && lg[rr][c] != null; rr--) {
          up = lg[rr][c] + up;                 // prepend to keep reading order
          sc += Data().pointsFor(lg[rr][c]);
        }
        for (rr = r + 1; rr < BOARD && lg[rr][c] != null; rr++) {
          down = down + lg[rr][c];
          sc += Data().pointsFor(lg[rr][c]);
        }

        if (up === '' && down === '') {        // no vertical neighbour -> unconstrained
          bits[r][c] = ALL_BITS; score[r][c] = 0;
          continue;
        }
        score[r][c] = sc;

        // Probe each candidate letter: up + X + down must be a dictionary word.
        // 26 isWord walks per constrained square is trivial at this scale
        // (SPEC-movegen §3 cost note) and reuses D.isWord (DRY).
        var mask = 0, i, X;
        var upLower = up.toLowerCase(), downLower = down.toLowerCase();
        for (i = 0; i < 26; i++) {
          X = String.fromCharCode(97 + i);     // lowercase a..z
          if (D.isWord(upLower + X + downLower)) mask |= (1 << i);
        }
        bits[r][c] = mask;
      }
    }
    return { bits: bits, score: score };
  }

  // =========================================================================
  // SECTION 4 — THE FORWARD-DAWG GENERATOR (SPEC-movegen §5)
  // =========================================================================
  //
  // A `state` object threads the per-direction context through the recursion so we
  // never rebuild it. `rack` (the original Tile array) and the real board are kept
  // for emitMove (placement assembly + SC.Rules.evaluatePlay).

  // Top-level for one orientation. Iterates anchors and dispatches LeftPart /
  // forced-prefix ExtendRight (SPEC-movegen §5 runDirection).
  function runDirection(workGrid, realBoard, rack, dir, results, seen, rackInfo) {
    var D = dawg();
    var lg = deriveLetters(workGrid);
    var cross = computeCrossSets(D, lg);

    var state = {
      D: D,
      lg: lg,
      crossBits: cross.bits,
      crossScore: cross.score,
      rackTally: rackInfo.rackTally,
      rackTiles: rackInfo.rackTiles,
      rack: rack,
      realBoard: realBoard,
      dir: dir,
      results: results,
      seen: seen
    };

    var r, c;
    for (r = 0; r < BOARD; r++) {
      for (c = 0; c < BOARD; c++) {
        if (!isAnchor(lg, r, c)) continue;

        if (c > 0 && lg[r][c - 1] != null) {
          // A fixed on-board prefix sits to our left: read it, walk the DAWG
          // through it, then ExtendRight from the anchor square.
          var prefix = '', cc = c - 1;
          while (cc >= 0 && lg[r][cc] != null) { prefix = lg[r][cc] + prefix; cc--; }
          var node = walk(D, D.root, prefix.toLowerCase());
          if (node !== -1) {
            // placedCount starts at 0: the fixed prefix is all existing tiles.
            // The mask MUST stay index-aligned with `partial` (which already holds
            // the prefix), so seed it with one '.' per prefix char — those squares
            // are existing tiles (emitMove skips them) but the indices must line up,
            // otherwise a rightward extension that uses a blank reads the wrong mask
            // slot and mis-assigns/crashes (mask is per-position, NOT per-new-tile).
            var prefMask = new Array(prefix.length + 1).join('.');
            extendRight(state, prefix, prefMask, node, r, c, 0);
          }
        } else {
          // No fixed prefix. k = how many empty, non-anchor squares lie to the
          // left (max length of a rack-built prefix here) — SPEC-movegen §2/§5.
          var k = 0, lc = c - 1;
          while (lc >= 0 && lg[r][lc] == null && !isAnchor(lg, r, lc)) { k++; lc--; }
          leftPart(state, '', '', D.root, k, r, c);
        }
      }
    }
  }

  /*
   * LeftPart (SPEC-movegen §5): build the rack-only prefix that ends just before
   * the anchor, then ExtendRight from the current node. `partial`/`mask` carry the
   * letters placed so far and which were blanks ('?' vs '.'). Left-part squares are
   * empty AND non-anchor, so they have no perpendicular neighbours (no cross-check)
   * — we only need the tile to be available.
   */
  function leftPart(state, partial, mask, node, limit, r, anchorC) {
    var D = state.D;

    // Try ExtendRight from here: the prefix occupies partial.length squares
    // immediately left of the anchor; ExtendRight begins at the anchor column.
    extendRight(state, partial, mask, node, r, anchorC, partial.length);

    if (limit === 0) return;

    // Extend the prefix one square further left with each viable DAWG child.
    var ls = D.letters(node), i, L, Lu, child;
    for (i = 0; i < ls.length; i++) {
      L = ls[i];                                  // lowercase
      Lu = L.toUpperCase();
      child = D.edge(node, L);
      // Use a plain letter tile if we have one.
      if (state.rackTally[Lu] > 0) {
        state.rackTally[Lu]--;
        leftPart(state, partial + Lu, mask + '.', child, limit - 1, r, anchorC);
        state.rackTally[Lu]++;
      }
      // Or a blank assigned as this letter.
      if (state.rackTally.blank > 0) {
        state.rackTally.blank--;
        leftPart(state, partial + Lu, mask + '?', child, limit - 1, r, anchorC);
        state.rackTally.blank++;
      }
    }
  }

  /*
   * ExtendRight (SPEC-movegen §5): place across the anchor and beyond. `col` is the
   * column we are about to fill. Through-tiles (occupied squares) are forced and
   * cost no rack tile; empty squares draw from the rack subject to cross-checks.
   * `placedCount` counts NEW tiles placed so far (prefix tiles included).
   */
  function extendRight(state, partial, mask, node, r, col, placedCount) {
    var D = state.D;

    if (col > BOARD - 1) {                        // ran off the right edge
      tryRecord(state, partial, mask, node, r, col, placedCount);
      return;
    }

    var sq = state.lg[r][col];
    if (sq != null) {
      // Occupied: we MUST consume this board letter (no tile placed, no cross-check
      // — its cross word, if any, already exists and is valid).
      var next = D.edge(node, sq.toLowerCase());
      if (next !== -1) {
        // Through-tile letter is appended as-is; mask gets '.' (not a new tile, but
        // emitMove skips existing cells so the mask value there is unused).
        extendRight(state, partial + sq, mask + '.', next, r, col + 1, placedCount);
      }
      return;  // recording only happens at empty/edge squares (tryRecord gate)
    }

    // Empty square: first see if `partial` already spells a word that legally ends
    // here (placedCount>=1, isWordNode, next square not a letter).
    tryRecord(state, partial, mask, node, r, col, placedCount);

    // Then try each rack letter allowed by both the DAWG and the cross-check.
    var bits = state.crossBits[r][col];          // perpendicular constraint at this square
    var ls = D.letters(node), i, L, Lu, bit, child;
    for (i = 0; i < ls.length; i++) {
      L = ls[i];                                  // lowercase child edge
      Lu = L.toUpperCase();
      bit = 1 << (Lu.charCodeAt(0) - A_CODE);
      if ((bits & bit) === 0) continue;           // fails cross-check -> skip
      child = D.edge(node, L);
      if (state.rackTally[Lu] > 0) {
        state.rackTally[Lu]--;
        extendRight(state, partial + Lu, mask + '.', child, r, col + 1, placedCount + 1);
        state.rackTally[Lu]++;
      }
      if (state.rackTally.blank > 0) {
        state.rackTally.blank--;
        extendRight(state, partial + Lu, mask + '?', child, r, col + 1, placedCount + 1);
        state.rackTally.blank++;
      }
    }
  }

  // Record a completed candidate if it is a legal terminal (SPEC-movegen §5).
  function tryRecord(state, partial, mask, node, r, col, placedCount) {
    if (placedCount === 0) return;                       // must place >= 1 new tile
    if (!state.D.isWordNode(node)) return;              // partial must be a word
    if (col <= BOARD - 1 && state.lg[r][col] != null) return; // a letter follows -> not terminal
    emitMove(state, partial, mask, r, col, placedCount);
  }

  // =========================================================================
  // SECTION 5 — EMITTING A MOVE (SPEC-movegen §6)
  // =========================================================================
  //
  // Assemble real Placement objects (with real Tile ids + blank assignment),
  // translate transposed coords back to real coords for 'down', then delegate
  // authoritative scoring/validation to SC.Rules.evaluatePlay (single source).

  // Clone a blank Tile assigned a concrete letter (never mutate the rack's Tile;
  // the controller owns commit-time mutation) — SPEC-movegen §6.
  function assignBlank(tile, letter) {
    return { id: tile.id, letter: letter, isBlank: true, points: 0 };
  }

  function emitMove(state, word, mask, r, endCol, placedCount) {
    var startCol = endCol - word.length;        // leftmost col of the main word
    var placements = [];
    // Local cursors into the rack pools so distinct placements get distinct ids.
    var perLetterIdx = {}, blankIdx = 0, i, col, ch, pool, tile;

    for (i = 0; i < word.length; i++) {
      col = startCol + i;
      if (state.lg[r][col] != null) continue;   // existing tile, not a new placement
      ch = word.charAt(i);                       // uppercase
      if (mask.charAt(i) === '?') {
        pool = state.rackTiles.blank;
        tile = assignBlank(pool[blankIdx++], ch);
      } else {
        if (perLetterIdx[ch] === undefined) perLetterIdx[ch] = 0;
        pool = state.rackTiles[ch];
        tile = pool[perLetterIdx[ch]++];
      }
      placements.push({
        row: realRow(r, col, state.dir),
        col: realCol(r, col, state.dir),
        tile: tile
      });
    }

    // Authoritative scoring/validation (DRY). Pass dir (ARCHITECTURE §7.2: optional
    // 4th arg; matters only for single-tile plays, where we also pin dir below).
    var move = Rules().evaluatePlay(state.realBoard, placements, false, state.dir);
    if (!move || !move.valid) return;            // belt-and-suspenders; should be valid

    // For a single-tile play, the same physical tile can form an across word and a
    // down word; we generate it once per direction and force move.dir so the
    // dedupe key (which includes dir) keeps both legitimately (SPEC-movegen §7.2/§8).
    if (placements.length === 1) move.dir = state.dir;

    var key = dedupeKey(move);
    if (state.seen[key]) return;
    state.seen[key] = true;

    move.leave = computeLeaveFor(move, state.rack);
    move.equity = move.score + leaveValue(move.leave);
    state.results.push(move);
  }

  // De-dup key (SPEC-movegen §8): same direction, same start, same set of (square,
  // letter, blank-ness) placements -> identical play.
  function dedupeKey(move) {
    var ps = move.placements.slice();
    ps.sort(function (a, b) {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });
    var parts = [], i, p;
    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      parts.push(p.row + ',' + p.col + ':' + p.tile.letter + (p.tile.isBlank ? '?' : ''));
    }
    return move.dir + '|' + move.row + ',' + move.col + '|' + parts.join(';');
  }

  // =========================================================================
  // SECTION 6 — LEAVE COMPUTATION FOR A MOVE (SPEC-leaves §6.1)
  // =========================================================================
  //
  // Derive Move.leave by subtracting the move's NEW placements from the rack
  // multiset. A placement whose tile.isBlank consumes a '?', regardless of the
  // letter it was assigned (a blank played as E still came from a blank).

  function computeLeaveFor(move, rack) {
    var pool = {}, i, t, ch;
    for (i = 0; i < rack.length; i++) {
      t = rack[i];
      ch = t.isBlank ? '?' : t.letter;          // rack letters uppercase; blank -> '?'
      pool[ch] = (pool[ch] || 0) + 1;
    }
    for (i = 0; i < move.placements.length; i++) {
      t = move.placements[i].tile;
      ch = t.isBlank ? '?' : t.letter;
      pool[ch] = (pool[ch] || 0) - 1;
    }
    var out = [], k;
    for (ch in pool) {
      if (!pool.hasOwnProperty(ch)) continue;
      for (k = 0; k < pool[ch]; k++) out.push(ch);
    }
    return out.sort().join('');                  // canonical (e.g. "EIO", blanks -> trailing "?")
  }

  // =========================================================================
  // SECTION 7 — FIRST MOVE (SPEC-movegen §7)
  // =========================================================================
  //
  // No anchors on an empty board. The opening must place >=2 tiles, form a word
  // >=2 letters, and cover H8. We enumerate all rack words then all center-covering
  // offsets in both orientations.

  // DFS over the DAWG constrained by the rack tally; collect every {word, mask}
  // (mask marks blank positions). Blanks substitute for any child edge.
  function collectRackWords(D, node, partial, mask, rackTally, out) {
    if (partial.length >= 2 && D.isWordNode(node)) {
      out.push({ word: partial, mask: mask });
    }
    if (partial.length >= 7) return;             // rack is at most 7 tiles
    var ls = D.letters(node), i, L, Lu, child;
    for (i = 0; i < ls.length; i++) {
      L = ls[i];
      Lu = L.toUpperCase();
      child = D.edge(node, L);
      if (rackTally[Lu] > 0) {
        rackTally[Lu]--;
        collectRackWords(D, child, partial + Lu, mask + '.', rackTally, out);
        rackTally[Lu]++;
      }
      if (rackTally.blank > 0) {
        rackTally.blank--;
        collectRackWords(D, child, partial + Lu, mask + '?', rackTally, out);
        rackTally.blank++;
      }
    }
  }

  function generateFirstMove(board, rack) {
    var results = [], seen = {};
    var D = dawg();
    var info = tally(rack);
    var center = Data().CENTER;                   // {row:7, col:7}

    var words = [];
    collectRackWords(D, D.root, '', '', info.rackTally, words);

    var w, word, mask, L, start, i, dir;
    for (w = 0; w < words.length; w++) {
      word = words[w].word;
      mask = words[w].mask;
      L = word.length;
      if (L < 2) continue;                        // first word must be >= 2 letters

      // ACROSS: row = center.row, columns start..start+L-1, must cover center.col.
      for (start = center.col - L + 1; start <= center.col; start++) {
        if (start < 0 || start + L - 1 > BOARD - 1) continue;
        emitFirstMove(results, seen, rack, info, board, word, mask,
                      center.row, start, 'across');
      }
      // DOWN: col = center.col, rows start..start+L-1, must cover center.row.
      for (start = center.row - L + 1; start <= center.row; start++) {
        if (start < 0 || start + L - 1 > BOARD - 1) continue;
        emitFirstMove(results, seen, rack, info, board, word, mask,
                      start, center.col, 'down');
      }
    }
    return results;
  }

  // Build placements for a first-move word laid out from (startRow,startCol) along
  // dir, then evaluate/score/dedupe like emitMove (SPEC-movegen §7 emitFirstMove).
  function emitFirstMove(results, seen, rack, info, board, word, mask,
                         startRow, startCol, dir) {
    var placements = [], perLetterIdx = {}, blankIdx = 0;
    var i, r, c, ch, tile;
    for (i = 0; i < word.length; i++) {
      r = dir === 'down' ? startRow + i : startRow;
      c = dir === 'down' ? startCol : startCol + i;
      ch = word.charAt(i);
      if (mask.charAt(i) === '?') {
        tile = assignBlank(info.rackTiles.blank[blankIdx++], ch);
      } else {
        if (perLetterIdx[ch] === undefined) perLetterIdx[ch] = 0;
        tile = info.rackTiles[ch][perLetterIdx[ch]++];
      }
      placements.push({ row: r, col: c, tile: tile });
    }

    var move = Rules().evaluatePlay(board, placements, true, dir);
    if (!move || !move.valid) return;
    move.dir = dir;                               // pin orientation for the dedupe key
    var key = dedupeKey(move);
    if (seen[key]) return;
    seen[key] = true;
    move.leave = computeLeaveFor(move, rack);
    move.equity = move.score + leaveValue(move.leave);
    results.push(move);
  }

  // =========================================================================
  // SECTION 8 — generateMoves (PUBLIC, SPEC-movegen §5 top level)
  // =========================================================================

  function generateMoves(board, rack, isFirstMove) {
    // No dictionary -> no moves (defensive; caller normally ensures Dict.ready).
    if (!Dict() || !dawg()) return [];

    if (isFirstMove || boardIsEmpty(board)) {
      return generateFirstMove(board, rack);
    }

    var results = [], seen = {};
    var info = tally(rack);

    // ACROSS on the real board; DOWN on a transposed view (same code, swapped
    // geometry — SPEC-movegen §0/§5). For DOWN the real board is still passed to
    // emitMove so SC.Rules scores against true coordinates.
    runDirection(board, board, rack, 'across', results, seen, info);
    runDirection(transpose(board), board, rack, 'down', results, seen, info);

    return results;
  }

  // =========================================================================
  // SECTION 9 — DIFFICULTY: chooseMove + helpers (SPEC-leaves §6)
  // =========================================================================

  // Injectable RNG for deterministic tests (SPEC-leaves §6.5 / §7); default Math.random.
  function rng() {
    return (typeof SC.AI !== 'undefined' && SC.AI._rng) ? SC.AI._rng() : Math.random();
  }
  function randInt(n) { return Math.floor(rng() * n); }

  // Ensure leave + equity are set on every move (idempotent). generateMoves
  // already sets them, but this guards externally-built move lists too.
  function annotate(moves, rack) {
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (m.equity === undefined || m.leave == null) {
        m.leave = (m.leave != null) ? m.leave : computeLeaveFor(m, rack);
        m.equity = m.score + leaveValue(m.leave);
      }
    }
    return moves;
  }

  // Sum of the face-value points of the tiles a leave string represents (used by
  // the endgame switch — leftover tiles are subtracted from your score; blanks 0).
  function leaveTilePoints(leaveStr) {
    if (!leaveStr) return 0;
    var sum = 0, i, ch;
    for (i = 0; i < leaveStr.length; i++) {
      ch = leaveStr.charAt(i);
      if (ch === '?') continue;                  // blank = 0
      sum += Data().pointsFor(ch);
    }
    return sum;
  }

  // argmax over moves by a scalar key function; deterministic tie handling via an
  // optional tiebreak comparator (returns >0 if `a` should win a tie).
  function argmax(moves, keyFn, tiebreak) {
    var best = null, bestKey = -Infinity, i, k;
    for (i = 0; i < moves.length; i++) {
      k = keyFn(moves[i]);
      if (k > bestKey) { best = moves[i]; bestKey = k; }
      else if (k === bestKey && best && tiebreak && tiebreak(moves[i], best) > 0) {
        best = moves[i];
      }
    }
    return best;
  }

  // A move's "flexibility" for tie-breaking: blanks and S in the leave are good.
  function leaveFlex(m) {
    var leave = m.leave || '', i, ch, n = 0;
    for (i = 0; i < leave.length; i++) {
      ch = leave.charAt(i);
      if (ch === '?') n += 2;                     // a kept blank is worth most
      else if (ch === 'S') n += 1;
    }
    return n;
  }

  // Endgame objective when the bag is empty (SPEC-leaves §6.4): leaves no longer
  // matter (no draws). Prefer going out (empty leave) and otherwise hoard fewer
  // leftover points. Value = score - leftoverTilePoints; emptying the rack adds a
  // small go-out preference so a play that goes out beats an equal-score hoard.
  function endgameValue(m) {
    var leftover = leaveTilePoints(m.leave);
    var goOutBonus = (m.leave === '' || m.leave == null) ? 1 : 0; // tiny tempo nudge
    return m.score - leftover + goOutBonus;
  }

  // ---- easy: plausible but sub-optimal (SPEC-leaves §6.2) -----------------
  function chooseEasy(moves) {
    var N = moves.length;
    if (N === 0) return null;
    // Sort by score descending.
    var sorted = moves.slice().sort(function (a, b) { return b.score - a.score; });
    if (N < 3) {
      // Tiny set: take the lowest non-zero-scoring move; else the single best.
      for (var j = sorted.length - 1; j >= 0; j--) {
        if (sorted[j].score > 0) return sorted[j];
      }
      return sorted[0];
    }
    // Candidate window = ranks [floor(0.40*N) .. floor(0.85*N)] (skip best & dregs).
    var lo = Math.floor(0.40 * N);
    var hi = Math.floor(0.85 * N) + 1;
    if (hi <= lo) hi = lo + 1;
    var window = sorted.slice(lo, hi);
    if (window.length === 0) window = [sorted[lo] || sorted[0]];
    return window[randInt(window.length)];
  }

  // ---- medium: greedy max score, tie-break by leave (SPEC-leaves §6.3) -----
  function chooseMedium(moves, rack) {
    if (moves.length === 0) return null;
    annotate(moves, rack);
    return argmax(moves, function (m) { return m.score; }, function (a, b) {
      // tie: richer leave, then fewer tiles placed.
      if (a.equity !== b.equity) return a.equity - b.equity;
      return b.placements.length - a.placements.length;
    });
  }

  // ---- hard: max equity (score + leave) with endgame switch (SPEC §6.4) ----
  function chooseHard(moves, rack) {
    if (moves.length === 0) return null;
    annotate(moves, rack);
    // Endgame: when the bag is empty, leaves are worthless — switch objective.
    if (State() && State().bagCount && State().bagCount() === 0) {
      return argmax(moves, endgameValue, function (a, b) { return a.score - b.score; });
    }
    return argmax(moves, function (m) { return m.equity; }, function (a, b) {
      // tie: higher raw score (tempo), then more flexible leave, then fewer tiles.
      if (a.score !== b.score) return a.score - b.score;
      if (leaveFlex(a) !== leaveFlex(b)) return leaveFlex(a) - leaveFlex(b);
      return b.placements.length - a.placements.length;
    });
  }

  // ---- expert: shallow Monte-Carlo over the top-K static plays (SPEC §6.5) -
  // Clone the board (row arrays; cells are Tile refs we only read) so simulation
  // never mutates SC.State.G.board.
  function cloneBoard(board) {
    var b = new Array(BOARD), r;
    for (r = 0; r < BOARD; r++) b[r] = board[r].slice();
    return b;
  }

  // Apply a move's placements onto a board copy (cells become the placed Tiles).
  function applyMove(board, move) {
    var b = cloneBoard(board), i, p;
    for (i = 0; i < move.placements.length; i++) {
      p = move.placements[i];
      b[p.row][p.col] = p.tile;
    }
    return b;
  }

  // Sample n tiles without replacement from an unseen-tile multiset
  // (SC.State.unseenTiles keys: 'A'..'Z' and '_' for blanks). Returns Tile-likes
  // suitable for generateMoves (id is irrelevant for opponent simulation).
  function drawRandom(unseen, n) {
    // Flatten the multiset into a pool of letter keys.
    var pool = [], key, c;
    for (key in unseen) {
      if (!unseen.hasOwnProperty(key)) continue;
      for (c = 0; c < unseen[key]; c++) pool.push(key);
    }
    // Partial Fisher-Yates: draw up to n.
    var drawn = [], i, j, tmp, take = Math.min(n, pool.length);
    for (i = 0; i < take; i++) {
      j = i + randInt(pool.length - i);
      tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      var k = pool[i];
      drawn.push(k === '_'
        ? { id: -1, letter: null, isBlank: true, points: 0 }
        : { id: -1, letter: k, isBlank: false, points: Data().pointsFor(k) });
    }
    return drawn;
  }

  // Expert config (SPEC-leaves §6.5). Dials shrunk for single-threaded JS.
  var EXPERT = {
    topK: 8,            // candidates kept from static
    iterations: 40,     // rollouts per candidate
    pruneAfter: 20,     // after this many iters, drop candidates clearly behind
    timeBudgetMs: 350   // hard wall; if exceeded, return best-so-far
  };

  function chooseExpert(board, rack, isFirstMove) {
    var moves = annotate(generateMoves(board, rack, isFirstMove), rack);
    if (moves.length === 0) return null;

    // Shortlist top-K by static equity (cheap).
    var sorted = moves.slice().sort(function (a, b) { return b.equity - a.equity; });
    var cand = sorted.slice(0, EXPERT.topK);
    if (cand.length === 1) return cand[0];

    // Bag empty -> simulation has no future value; defer to hard's endgame logic.
    if (State() && State().bagCount && State().bagCount() === 0) {
      return chooseHard(moves, rack);
    }

    // Unseen tiles to model the opponent's possible racks (excludes our rack + board).
    var me = State() ? State().currentPlayer() : null;
    var unseen = (State() && State().unseenTiles) ? State().unseenTiles(me) : {};

    // Per-candidate running mean of "value to us after one full round".
    var i, c;
    for (i = 0; i < cand.length; i++) { cand[i]._sum = 0; cand[i]._cnt = 0; cand[i]._alive = true; }

    var start = (typeof Date !== 'undefined') ? Date.now() : 0;
    var it, aliveCount = cand.length;
    for (it = 1; it <= EXPERT.iterations; it++) {
      var oppRack = drawRandom(unseen, 7);
      for (i = 0; i < cand.length; i++) {
        c = cand[i];
        if (!c._alive) continue;
        var b2 = applyMove(board, c);
        // Opponent replies with their best static (hard) play — reuse our evaluator (DRY).
        var opp = chooseMove(b2, oppRack, 'hard', false);
        var val = c.score - (opp ? opp.score : 0) + leaveValue(c.leave);
        c._sum += val; c._cnt++;
      }
      // Prune candidates clearly behind, once, to spend budget on contenders.
      if (it === EXPERT.pruneAfter && aliveCount > 4) {
        var means = cand.filter(function (m) { return m._alive; })
                        .map(function (m) { return m._sum / m._cnt; })
                        .sort(function (a, b) { return b - a; });
        var cutoff = means[Math.min(3, means.length - 1)]; // keep ~top 4
        for (i = 0; i < cand.length; i++) {
          c = cand[i];
          if (c._alive && (c._sum / c._cnt) < cutoff) { c._alive = false; aliveCount--; }
        }
      }
      if (start && (Date.now() - start) > EXPERT.timeBudgetMs) break;
    }

    // Pick the highest mean value; if no iteration completed, fall back to top static.
    var best = null, bestMean = -Infinity;
    for (i = 0; i < cand.length; i++) {
      c = cand[i];
      if (c._cnt === 0) continue;
      var mean = c._sum / c._cnt;
      if (mean > bestMean) { bestMean = mean; best = c; }
    }
    return best || cand[0];
  }

  /*
   * chooseMove (PUBLIC, ARCHITECTURE §3 / SPEC-leaves §6). Returns a Move or null
   * (null => no legal placement; the controller then exchanges/passes).
   *   easy   — random from a lower-scoring window
   *   medium — max raw score
   *   hard   — max equity (score + leave), endgame switch when bag empty
   *   expert — hard + shallow Monte-Carlo (kill-switch + fallback to hard)
   */
  function chooseMove(board, rack, difficulty, isFirstMove) {
    if (difficulty === 'expert') {
      // Honor the global kill-switch and fall back to hard on any failure/timeout
      // (ARCHITECTURE §3 "fall back to hard"; SPEC-leaves §6.5).
      if (SC.AI && SC.AI.allowSimulation === false) {
        return chooseMove(board, rack, 'hard', isFirstMove);
      }
      try {
        var pick = chooseExpert(board, rack, isFirstMove);
        if (pick) return pick;
        // chooseExpert returns null only when there are no moves at all.
        return null;
      } catch (e) {
        return chooseMove(board, rack, 'hard', isFirstMove);
      }
    }

    var moves = generateMoves(board, rack, isFirstMove);
    if (moves.length === 0) return null;

    if (difficulty === 'easy')   return chooseEasy(moves);
    if (difficulty === 'medium') return chooseMedium(moves, rack);
    // default + 'hard'
    return chooseHard(moves, rack);
  }

  // =========================================================================
  // SECTION 10 — recommendExchange (PUBLIC, ARCHITECTURE §7.5 / SPEC §6.6)
  // =========================================================================
  //
  // Returns the Tile[] to TOSS (exchange), or null if no exchange is worthwhile or
  // legal. SCRABBLE_RULES §8: an exchange is only legal when the bag has >= 7 tiles.
  // We search the (<=2^7) keep-subsets for the one with the highest leaveValue and
  // toss the complement; null if the best keep is the whole rack (nothing to gain)
  // or an exchange is illegal.

  function recommendExchange(board, rack) {
    // Exchange requires a full bag of replacements (>= 7 tiles).
    if (!State() || !State().bagCount || State().bagCount() < 7) return null;
    var n = rack.length;
    if (n === 0) return null;

    // Enumerate every subset of the rack as a bitmask; subset = tiles to KEEP.
    // We want the keep-subset maximizing leaveValue(keptLetters). The best toss is
    // the complement. Keeping all tiles (mask = full) is the "don't exchange" case.
    var fullMask = (1 << n) - 1;
    var bestMask = fullMask, bestVal = -Infinity;
    var mask, i, keepStr, v;
    for (mask = 0; mask <= fullMask; mask++) {
      keepStr = '';
      for (i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          keepStr += rack[i].isBlank ? '?' : rack[i].letter;
        }
      }
      v = leaveValue(keepStr);
      // Prefer a higher leave value; on ties prefer keeping MORE tiles (toss less,
      // a smaller information loss). Sorting keepStr is handled inside leaveValue.
      if (v > bestVal || (v === bestVal && countBits(mask) > countBits(bestMask))) {
        bestVal = v; bestMask = mask;
      }
    }

    // If the best plan is to keep everything, there is nothing to exchange.
    if (bestMask === fullMask) return null;

    // Toss the complement of the best keep-subset.
    var toss = [];
    for (i = 0; i < n; i++) { if (!(bestMask & (1 << i))) toss.push(rack[i]); }
    return toss.length ? toss : null;
  }

  // Count set bits in a small integer (subset size).
  function countBits(x) {
    var c = 0;
    while (x) { c += x & 1; x >>>= 1; }
    return c;
  }

  // =========================================================================
  // SECTION 11 — findHints (PUBLIC, ARCHITECTURE §3 / SPEC §6.7)
  // =========================================================================
  //
  // Top-n legal plays by equity (for the F key). Same pipeline as hard.

  function findHints(board, rack, isFirstMove, n) {
    var moves = annotate(generateMoves(board, rack, isFirstMove), rack);
    moves.sort(function (a, b) {
      if (b.equity !== a.equity) return b.equity - a.equity;
      return b.score - a.score;                  // tie: higher raw score first
    });
    if (n == null) return moves;
    return moves.slice(0, n);
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================
  SC.AI = {
    // move generation + difficulty + evaluation
    generateMoves: generateMoves,
    chooseMove: chooseMove,
    leaveValue: leaveValue,
    recommendExchange: recommendExchange,
    findHints: findHints,

    // configuration / test hooks
    LEAVE: LEAVE,             // tunable heuristic constants (SPEC-leaves §5)
    allowSimulation: true,    // expert kill-switch (ARCHITECTURE §7.5)
    _rng: null               // injectable RNG for deterministic tests (default Math.random)
  };
})();
