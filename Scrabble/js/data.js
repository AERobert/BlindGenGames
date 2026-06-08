/*
 * data.js — Static game data and constants for Accessible Scrabble.
 *
 * Exposes the SC.Data namespace. Pure data + tiny helpers: no DOM access and no
 * dependencies on other SC modules, so this loads first (after the dictionary
 * data) via a plain <script> tag. No ES modules — the game runs from file://
 * with no server, so everything attaches to the global SC namespace.
 */
(function () {
  // Shared global namespace, created by whichever module loads first.
  window.SC = window.SC || {};

  // The board is 15x15. Rows are indexed 0..14 (spoken A..O); columns are
  // indexed 0..14 (spoken 1..15). So index (7,7) is spoken "H8".
  var BOARD_SIZE = 15;

  // Center square (H8). The first word of the game must cover it.
  var CENTER = { row: 7, col: 7 };

  // Point value of every tile. The blank is represented internally by '_'.
  var TILE_POINTS = {
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
    N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
    _: 0
  };

  // Full-bag composition: 98 lettered tiles + 2 blanks = 100 tiles, 187 points.
  var TILE_DISTRIBUTION = {
    A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
    N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
    _: 2
  };

  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /*
   * Premium-square layout, top row (A) to bottom row (O), left (col 1) to
   * right (col 15).
   *   T = triple word    D = double word
   *   t = triple letter  d = double letter
   *   * = center square (a double word that also anchors the first move)
   *   . = plain square
   * Verified counts: 8 TW, 16 DW + center, 12 TL, 24 DL = 61 premium squares.
   */
  var PREMIUM_LAYOUT = [
    'T..d...T...d..T',
    '.D...t...t...D.',
    '..D...d.d...D..',
    'd..D...d...D..d',
    '....D.....D....',
    '.t...t...t...t.',
    '..d...d.d...d..',
    'T..d...*...d..T',
    '..d...d.d...d..',
    '.t...t...t...t.',
    '....D.....D....',
    'd..D...d...D..d',
    '..D...d.d...D..',
    '.D...t...t...D.',
    'T..d...T...d..T'
  ];

  /*
   * Each layout character maps to a premium descriptor:
   *   word   = word-score multiplier (1 = none)
   *   letter = letter-score multiplier (1 = none)
   *   name   = spoken description
   *   code   = short label ('TW','DW','TL','DL')
   *   center = true only for the center square
   */
  var PREMIUM_CHAR = {
    'T': { word: 3, letter: 1, name: 'triple word score', code: 'TW' },
    'D': { word: 2, letter: 1, name: 'double word score', code: 'DW' },
    't': { word: 1, letter: 3, name: 'triple letter score', code: 'TL' },
    'd': { word: 1, letter: 2, name: 'double letter score', code: 'DL' },
    '*': { word: 2, letter: 1, name: 'center, double word score', code: 'DW', center: true },
    '.': null
  };

  // 15x15 grid of premium descriptors (null on plain squares).
  var PREMIUM = PREMIUM_LAYOUT.map(function (rowStr) {
    return rowStr.split('').map(function (ch) { return PREMIUM_CHAR[ch]; });
  });

  // ---- Coordinate & lookup helpers ----------------------------------------

  // (row,col) -> spoken coordinate string, e.g. (7,7) -> "H8".
  function coordToString(row, col) {
    return LETTERS[row] + (col + 1);
  }

  // "H8" -> {row:7, col:7}. Returns null if malformed or out of range.
  function stringToCoord(str) {
    if (!str) return null;
    var m = String(str).trim().toUpperCase().match(/^([A-O])\s*([0-9]{1,2})$/);
    if (!m) return null;
    var row = LETTERS.indexOf(m[1]);
    var col = parseInt(m[2], 10) - 1;
    if (row < 0 || col < 0 || col >= BOARD_SIZE) return null;
    return { row: row, col: col };
  }

  // Point value for a letter (case-insensitive). Blank '_' or unknown -> 0.
  function pointsFor(letter) {
    if (!letter) return 0;
    return TILE_POINTS[String(letter).toUpperCase()] || 0;
  }

  // Premium descriptor at a square, or null.
  function premiumAt(row, col) {
    return PREMIUM[row] ? PREMIUM[row][col] : null;
  }

  // Is (row,col) on the board?
  function inBounds(row, col) {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
  }

  // ---- Computer-player names (themed; the adjective hints at difficulty) -----
  // A name is "<mode adjective> <Scrabble/spelling noun>", e.g. "Cunning Lexicon".
  // Reading the adjective lets a player infer the opponent's challenge level.

  // Shared noun pool (spelling / Scrabble themed).
  var NAME_NOUNS = [
    'Anagram', 'Lexicon', 'Bingo', 'Blank', 'Rack', 'Triple', 'Vowel', 'Digraph',
    'Syllable', 'Phoneme', 'Grapheme', 'Glyph', 'Bigram', 'Lexeme', 'Cipher',
    'Speller', 'Wordsmith', 'Scrabbler', 'Hook', 'Coinage', 'Etymon', 'Morpheme',
    'Diphthong', 'Lemma', 'Ligature'
  ];

  // Per-difficulty adjective pools — each subtly signals the challenge level.
  var NAME_ADJECTIVES = {
    easy: ['Budding', 'Casual', 'Gentle', 'Mellow', 'Drowsy', 'Amiable', 'Carefree',
      'Genial', 'Tame', 'Placid', 'Easygoing', 'Untrained', 'Novice', 'Dawdling',
      'Mild', 'Sleepy', 'Idle', 'Breezy', 'Cozy', 'Plodding'],
    medium: ['Steady', 'Capable', 'Seasoned', 'Astute', 'Diligent', 'Measured',
      'Poised', 'Tidy', 'Earnest', 'Methodical', 'Spry', 'Nimble', 'Crafty', 'Brisk',
      'Studious', 'Composed', 'Adept', 'Canny', 'Tactful', 'Levelheaded'],
    hard: ['Cunning', 'Formidable', 'Relentless', 'Vexing', 'Shrewd', 'Tenacious',
      'Dogged', 'Severe', 'Incisive', 'Ruthless', 'Calculating', 'Merciless',
      'Daunting', 'Pitiless', 'Exacting', 'Fierce', 'Wily', 'Hardnosed', 'Unyielding',
      'Cutthroat'],
    expert: ['Masterful', 'Peerless', 'Implacable', 'Inexorable', 'Consummate',
      'Sovereign', 'Unerring', 'Devastating', 'Surgical', 'Indomitable', 'Virtuosic',
      'Flawless', 'Ironclad', 'Preeminent', 'Vaunted', 'Crushing', 'Magisterial',
      'Unassailable', 'Prodigious', 'Supreme']
  };

  // Pick a random entry from `pool` not already in the `used` map; falls back to a
  // random entry if all are taken (cannot happen for <= pool.length picks).
  function pickUnused(pool, used) {
    var start = Math.floor(Math.random() * pool.length);
    for (var k = 0; k < pool.length; k++) {
      var cand = pool[(start + k) % pool.length];
      if (!used[cand]) return cand;
    }
    return pool[start];
  }

  // Generate one themed name per entry in `modes` (array of difficulty strings).
  // No two names share an adjective OR a noun (rerolled until unique).
  function generateComputerNames(modes) {
    var usedAdj = {}, usedNoun = {}, names = [];
    for (var i = 0; i < modes.length; i++) {
      var pool = NAME_ADJECTIVES[modes[i]] || NAME_ADJECTIVES.medium;
      var adj = pickUnused(pool, usedAdj);
      var noun = pickUnused(NAME_NOUNS, usedNoun);
      usedAdj[adj] = 1; usedNoun[noun] = 1;
      names.push(adj + ' ' + noun);
    }
    return names;
  }

  SC.Data = {
    BOARD_SIZE: BOARD_SIZE,
    CENTER: CENTER,
    TILE_POINTS: TILE_POINTS,
    TILE_DISTRIBUTION: TILE_DISTRIBUTION,
    LETTERS: LETTERS,
    PREMIUM_LAYOUT: PREMIUM_LAYOUT,
    PREMIUM: PREMIUM,
    coordToString: coordToString,
    stringToCoord: stringToCoord,
    pointsFor: pointsFor,
    premiumAt: premiumAt,
    inBounds: inBounds,
    NAME_NOUNS: NAME_NOUNS,
    NAME_ADJECTIVES: NAME_ADJECTIVES,
    generateComputerNames: generateComputerNames
  };
})();
