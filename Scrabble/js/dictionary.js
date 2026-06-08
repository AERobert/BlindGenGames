/*
 * dictionary.js — Word validity + DAWG wiring.
 *
 * Exposes SC.Dict. Two complementary lookup structures are built from the same
 * authoritative word list (window.SCRABBLE_WORDS, set by dictionary-data.js):
 *
 *   1. A Set of every word            -> O(1) membership for isWord() (UI/Rules).
 *   2. A DAWG (via SC.Dawg.build)     -> prefix/edge traversal for move-gen (SC.AI).
 *
 * The Set and the DAWG answer the SAME question (is this a word?) but serve
 * different callers: the Set is the fast, simple validity oracle; the DAWG is the
 * structure the move generator walks letter-by-letter. Keeping both is deliberate.
 *
 * Per ARCHITECTURE.md §0/§3, window.SCRABBLE_WORDS is ALREADY an Array of sorted
 * lowercase words (dictionary-data.js does the .split itself), so we consume it
 * directly — no parsing, no split, no fetch.
 *
 * init() is SYNCHRONOUS: SC.Game shows a "Loading dictionary…" message and calls
 * this inside a setTimeout so that message paints before the (heavy) build runs.
 *
 * Depends on: SC.Dawg (only inside init(), i.e. at runtime — load order is safe),
 * window.SCRABBLE_WORDS, window.SCRABBLE_DICT_META. No DOM. Runs under Node with
 * the `global.window = global` shim (see ARCHITECTURE.md §6).
 */
(function () {
  window.SC = window.SC || {};

  // Internal validity Set, populated by init(). Keys are lowercase words so that
  // isWord() can normalise its argument once and look up directly.
  var wordSet = null;

  /*
   * init — build both lookup structures from window.SCRABBLE_WORDS.
   *
   * Idempotent: a second call (e.g. after a navigation that re-inits) rebuilds
   * cleanly rather than double-counting or throwing.
   */
  function init() {
    // Pull the authoritative list once. It is guaranteed to be a sorted Array of
    // lowercase words; we never mutate it (Set/DAWG only read from it).
    var words = window.SCRABBLE_WORDS;

    // Fast O(1) membership oracle for isWord(). Constructing a Set straight from
    // the array is the simplest correct form (DRY: one source list, two views).
    wordSet = new Set(words);

    // Build the move-generation DAWG from the SAME sorted list. SC.Dawg.build is
    // SC.Dawg's documented §3 entry point and expects sorted lowercase words —
    // exactly what we have — so we hand the array straight through.
    SC.Dict.dawg = SC.Dawg.build(words);

    // Signal readiness so the controller can leave the loading state.
    SC.Dict.ready = true;
  }

  /*
   * isWord — case-insensitive validity check.
   *
   * Returns false (rather than throwing) for non-strings or before init(), so
   * callers can probe safely. Words are stored lowercase, so we lowercase once.
   */
  function isWord(word) {
    if (!wordSet || typeof word !== 'string') { return false; }
    return wordSet.has(word.toLowerCase());
  }

  /*
   * size — number of words in the dictionary, or 0 before init().
   * Derived from the live Set so it can never drift from what isWord() accepts.
   */
  function size() {
    return wordSet ? wordSet.size : 0;
  }

  // Public API (ARCHITECTURE.md §3). `dawg` and `ready` are filled in by init();
  // we declare them here so the shape is stable and self-documenting before then.
  SC.Dict = {
    init: init,
    isWord: isWord,
    size: size,
    dawg: null,                          // set by init() -> SC.Dawg.build(words)
    meta: window.SCRABBLE_DICT_META,     // pass-through metadata object
    ready: false                         // flipped true at the end of init()
  };
})();
