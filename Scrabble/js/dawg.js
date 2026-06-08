/*
 * dawg.js — Minimal DAWG (Directed Acyclic Word Graph) for Accessible Scrabble.
 *
 * Exposes the SC.Dawg namespace. Builds a minimal acyclic finite-state automaton
 * from the already-sorted ENABLE word list (window.SCRABBLE_WORDS) using Daciuk
 * et al.'s INCREMENTAL minimization — the sorted-input specialization, which is
 * single-pass and O(total input letters). The result is serialized into a packed
 * Int32Array of edge records (one Int32 per edge); the mutable object graph used
 * during construction is discarded so the live structure is tiny (~0.46 MB).
 *
 * This module is self-contained: it references NO other SC.* module (it only
 * consumes the plain array passed to build()), so script load order is not
 * fragile. It also runs under Node with no DOM (the verifier requires this).
 *
 * Plain ES5-ish JS (var + IIFE), no ES modules / import / fetch — the game runs
 * from file:// with no server. See research/SPEC-dawg.md for the full rationale,
 * the measured sizes/timings, and the exact bit layout reproduced below.
 */
(function () {
  // Shared global namespace, created by whichever SC module loads first.
  window.SC = window.SC || {};

  // ===========================================================================
  // Packed edge-record bit layout (one Int32 per edge). Defined once so the
  // format is documented in a single place (SPEC-dawg.md §3.2/§3.4).
  //
  //   bit  31 30 ............... 7 | 6   | 5    | 4 3 2 1 0
  //         \___ firstChild (24b)__/  WORD  LAST    letter (5b)
  //
  //   letter     (bits 0..4)  : 0..25  (a=0 ... z=25)        — 5 bits hold a..z
  //   LAST       (bit  5)     : 1 if this is the LAST edge in its node's run
  //   WORD       (bit  6)     : 1 if the node this edge LEADS INTO is terminal
  //   firstChild (bits 7..30) : index of the FIRST edge of the child node's run;
  //                             0 means "no children" (a leaf / null sentinel)
  //   bit 31                  : unused / 0 (values stay non-negative; we still
  //                             read firstChild with >>> to be safe)
  // ===========================================================================
  var LETTER_MASK = 0x1F;       // bits 0..4  — the 5-bit letter index
  var LAST_BIT    = 1 << 5;     // 0x20       — end-of-child-run flag
  var WORD_BIT    = 1 << 6;     // 0x40       — end-of-word flag (on incoming edge)
  var CHILD_SHIFT = 7;          // firstChild occupies bits 7..30
  var CHILD_MASK  = 0xFFFFFF;   // 24 bits    — addresses up to 16,777,215 edges

  var CODE_A = 97;              // 'a'.charCodeAt(0); letters map a..z -> 0..25

  // ===========================================================================
  // SECTION 1 — Build-time helpers: mutable Node, prefix length, signature.
  // These objects exist only during construction and are dropped after pack().
  // ===========================================================================

  /*
   * A build-time node: a monotonic id (used in signatures), the node-terminal
   * `final` flag, and an `edges` map of single-char letter -> child Node.
   * `final` is the end-of-word marker; the packed form moves it onto the edge
   * that leads INTO the node (the WORD bit) so traversal needs no per-node store.
   */
  function makeNode(id) {
    return { id: id, final: false, edges: {} };
  }

  /*
   * Length of the common prefix of two strings, comparing by char code. Used to
   * decide how much of the active path the next (sorted) word shares with the
   * previous word — everything past it can be minimized immediately.
   */
  function commonPrefixLength(a, b) {
    var n = a.length < b.length ? a.length : b.length;
    var i = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) {
      i++;
    }
    return i;
  }

  /*
   * Canonical equivalence key for a node. Two nodes are equivalent iff they have
   * the same finality AND the same set of (letter -> already-minimized-child)
   * transitions. Children referenced here are already minimal, so a child's id
   * uniquely identifies its equivalence class. Sorting the letters makes the key
   * order-independent (so equivalent nodes always collide). Example: "0_a:42_t:7".
   */
  function signature(node) {
    var s = node.final ? '1' : '0';
    // Collect this node's edge letters and sort them for a deterministic key.
    var keys = [];
    for (var k in node.edges) {
      if (node.edges.hasOwnProperty(k)) {
        keys.push(k);
      }
    }
    keys.sort();
    for (var i = 0; i < keys.length; i++) {
      var letter = keys[i];
      s += '_' + letter + ':' + node.edges[letter].id;
    }
    return s;
  }

  // ===========================================================================
  // SECTION 2 — Daciuk sorted-input construction (insert / minimize / finish).
  // Mirrors Steve Hanov's public-domain reference (SPEC-dawg.md §2).
  // ===========================================================================

  /*
   * Run the full construction over a sorted, lowercase word array and return the
   * root of the minimal OBJECT graph. State (root, the active-path stack, the
   * register, the previous word, the id counter) is local to this call so build
   * is re-entrant and leaks nothing.
   */
  function construct(words) {
    var nextId = 0;                       // monotonic node id, for signatures
    var root = makeNode(nextId++);        // the start node

    // The "active path": a STACK of the edges from the end of the current common
    // prefix down to the most recently added leaf. Each entry is the parent node,
    // the letter on the edge, and the child node it points to.
    var uncheckedNodes = [];

    // The Register: signature(string) -> canonical Node. Dedupes equivalent
    // (already-minimized) nodes during build. Dropped after packing.
    var minimizedNodes = {};

    var previousWord = '';                // last word inserted ("" initially)

    /*
     * Pop the active-path stack down to depth `downTo`, registering or replacing
     * each popped node leaf-ward first (so a node's children are already minimal
     * before the node itself is hashed). REPLACE redirects the parent edge at the
     * canonical node and drops the duplicate; REGISTER records a new canonical.
     */
    function minimize(downTo) {
      for (var i = uncheckedNodes.length - 1; i >= downTo; i--) {
        var u = uncheckedNodes[i];           // { parent, letter, child }
        var sig = signature(u.child);
        var existing = minimizedNodes[sig];
        if (existing !== undefined) {
          // REPLACE: an equivalent node already exists; point the parent at it.
          u.parent.edges[u.letter] = existing;
        } else {
          // REGISTER: this node is the canonical representative of its class.
          minimizedNodes[sig] = u.child;
        }
        uncheckedNodes.pop();
      }
    }

    /*
     * Insert one word. Assumes word >= previousWord (sorted input). Freezes the
     * suffix past the shared prefix, then grows new nodes for the unshared tail
     * and marks the final node terminal.
     */
    function insert(word) {
      var cp = commonPrefixLength(word, previousWord);
      // Everything beyond the shared prefix can never be touched again — minimize.
      minimize(cp);

      // The node at the end of the shared prefix is the top of the remaining
      // stack, or the root if the stack is now empty.
      var node = uncheckedNodes.length === 0
        ? root
        : uncheckedNodes[uncheckedNodes.length - 1].child;

      // Append a fresh node for each letter of the word past the shared prefix.
      for (var i = cp; i < word.length; i++) {
        var letter = word.charAt(i);
        var next = makeNode(nextId++);
        node.edges[letter] = next;
        uncheckedNodes.push({ parent: node, letter: letter, child: next });
        node = next;
      }
      node.final = true;                  // mark end-of-word on the NODE
      previousWord = word;
    }

    // Insert every word in order. (Input is pre-sorted; see build()'s guard.)
    for (var w = 0; w < words.length; w++) {
      insert(words[w]);
    }
    // Flush: collapse the entire remaining active path so the whole graph is
    // minimal. After this, every node reachable from root is canonical.
    minimize(0);

    return root;
  }

  // ===========================================================================
  // SECTION 3 — Serialize the object graph into a packed Int32Array (two passes,
  // both O(nodes + edges)). See SPEC-dawg.md §3.5.
  // ===========================================================================

  /*
   * Pack the minimal object graph rooted at `root` into an Int32Array of edge
   * records and return { arr: Int32Array, root: 0 }. Index 0 is reserved: it is
   * BOTH the synthetic root edge AND the null/leaf sentinel (firstChild === 0
   * means "no children"), so real child runs start at index >= 1.
   */
  function pack(root) {
    // --- Pass A: gather every unique node reachable from root (iterative DFS to
    // avoid any engine recursion-limit risk), and assign each its firstChild
    // slot. Leaves (degree 0) map to slot 0 (the sentinel). ---
    var nodeList = [];                     // unique nodes, in discovery order
    var seen = {};                         // node.id -> true (visited guard)
    var stack = [root];
    seen[root.id] = true;
    while (stack.length > 0) {
      var node = stack.pop();
      nodeList.push(node);
      // Push not-yet-seen children so each node is listed exactly once.
      for (var key in node.edges) {
        if (node.edges.hasOwnProperty(key)) {
          var child = node.edges[key];
          if (!seen[child.id]) {
            seen[child.id] = true;
            stack.push(child);
          }
        }
      }
    }

    // Assign each node the base index of its contiguous child run.
    var firstChildOf = {};                 // node.id -> int (0 for leaves)
    var cursor = 1;                         // index 0 reserved (root edge + sentinel)
    for (var n = 0; n < nodeList.length; n++) {
      var nd = nodeList[n];
      var deg = 0;
      for (var ek in nd.edges) {
        if (nd.edges.hasOwnProperty(ek)) {
          deg++;
        }
      }
      if (deg === 0) {
        firstChildOf[nd.id] = 0;           // leaf -> sentinel slot
      } else {
        firstChildOf[nd.id] = cursor;
        cursor += deg;                     // reserve `deg` consecutive slots
      }
    }

    var arr = new Int32Array(cursor);

    // The synthetic root edge at index 0: letter/LAST/WORD all 0 (empty string is
    // not a word); firstChild points at root's child run.
    arr[0] = (firstChildOf[root.id] & CHILD_MASK) << CHILD_SHIFT;

    // --- Pass B: emit each node's child run, letters ascending, the last record
    // flagged LAST and any record whose child is `final` flagged WORD. ---
    for (var m = 0; m < nodeList.length; m++) {
      var src = nodeList[m];
      // Collect and sort this node's edge letters (ascending order is required:
      // it keeps runs canonical AND lets letters()/edge() rely on the order).
      var letters = [];
      for (var lk in src.edges) {
        if (src.edges.hasOwnProperty(lk)) {
          letters.push(lk);
        }
      }
      if (letters.length === 0) {
        continue;                          // leaf: nothing to emit
      }
      letters.sort();
      var base = firstChildOf[src.id];
      var lastIdx = letters.length - 1;
      for (var c = 0; c < letters.length; c++) {
        var lt = letters[c];
        var ch = src.edges[lt];
        var rec = (lt.charCodeAt(0) - CODE_A) & LETTER_MASK;   // 5-bit letter
        if (c === lastIdx) { rec |= LAST_BIT; }                // end of this run
        if (ch.final)      { rec |= WORD_BIT; }                // child is terminal
        rec |= (firstChildOf[ch.id] & CHILD_MASK) << CHILD_SHIFT;  // child run ptr
        arr[base + c] = rec;
      }
    }

    return { arr: arr, root: 0 };
  }

  // ===========================================================================
  // SECTION 4 — The D facade: representation-independent traversal over `arr`.
  // A "node handle" is OPAQUE: the integer index of the edge leading INTO the
  // node (root = synthetic edge 0). See ARCHITECTURE.md §7.1 and SPEC-dawg.md §4.
  // ===========================================================================

  function makeDawg(arr) {
    // Decode a handle's firstChild field: the index where its child run begins
    // (0 ⇒ leaf). Always read with >>> so bit 31 can never make it negative.
    function firstChild(handle) {
      return (arr[handle] >>> CHILD_SHIFT) & CHILD_MASK;
    }

    var D = {
      // The packed array and root handle are exposed for tests/inspection only
      // (treat as read-only). root is the synthetic edge at index 0.
      arr: arr,
      root: 0,

      /*
       * edge(node, letter) -> child handle | -1. `letter` is a lowercase 'a'..'z'
       * string. Scans the node's contiguous child run for a matching letter and
       * returns THAT EDGE'S index as the child handle (so the WORD/run bits read
       * from arr[handle] describe the child). Returns -1 if absent or a leaf.
       */
      edge: function (node, letter) {
        var fc = firstChild(node);
        if (fc === 0) {
          return -1;                       // leaf: no children
        }
        var li = letter.charCodeAt(0) - CODE_A;   // target letter index 0..25
        var i = fc;
        for (;;) {                         // walk the ascending child run
          var rec = arr[i];
          if ((rec & LETTER_MASK) === li) {
            return i;                      // found: the handle is this edge index
          }
          if (rec & LAST_BIT) {
            return -1;                     // ran off the end of the run: absent
          }
          i++;
        }
      },

      /*
       * isWordNode(node) -> bool. Does the path that reaches this node spell a
       * complete word? Reads the WORD bit carried on the incoming edge.
       */
      isWordNode: function (node) {
        return (arr[node] & WORD_BIT) !== 0;
      },

      /*
       * letters(node) -> ['a','c',...]: the node's outgoing edge letters in
       * ASCENDING order (the move generator relies on this ordering). Empty for a
       * leaf.
       */
      letters: function (node) {
        var out = [];
        var fc = firstChild(node);
        if (fc === 0) {
          return out;                      // leaf: no outgoing letters
        }
        var i = fc;
        for (;;) {                         // walk the ascending child run
          var rec = arr[i];
          out.push(String.fromCharCode(CODE_A + (rec & LETTER_MASK)));
          if (rec & LAST_BIT) {
            break;                         // last edge of the run
          }
          i++;
        }
        return out;
      },

      /*
       * isWord(str) -> bool. Convenience: walk from the root following each
       * letter; the word is valid iff the walk completes AND the final node is a
       * word node. `str` must be lowercase a..z (callers normalize case). The
       * empty string walks to root, whose WORD bit is 0, so it is never a word.
       */
      isWord: function (str) {
        var h = 0;                         // start at the root handle
        for (var i = 0; i < str.length; i++) {
          h = this.edge(h, str.charAt(i));
          if (h === -1) {
            return false;                  // no such edge: not a word
          }
        }
        return (arr[h] & WORD_BIT) !== 0;
      },

      /*
       * selfTest(sampleWords) -> { ok, failures, checked }. Pure, DOM-free
       * verifier (does NOT throw — the caller asserts on .ok). Checks that isWord
       * agrees with a membership Set, that mutated negatives are rejected, that
       * proper prefixes are walkable via edge(), and a few structural invariants.
       * Uses a deterministic LCG/xorshift so any failure reproduces.
       * (SPEC-dawg.md §5.)
       */
      selfTest: function (sampleWords) {
        // Build a membership set once (plain object as a hash set).
        var set = {};
        var i;
        var n = sampleWords.length;
        for (i = 0; i < n; i++) {
          set[sampleWords[i]] = true;
        }
        var fails = [];

        // (a) Every dictionary word must be found AND flagged as a word node.
        for (i = 0; i < n; i++) {
          if (!this.isWord(sampleWords[i])) {
            fails.push(['missing', sampleWords[i]]);
          }
        }

        // Deterministic xorshift PRNG in [0,1) so failures are reproducible.
        var seed = 0x2545F491;
        var rnd = function () {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          return (seed >>> 0) / 4294967296;
        };

        // (b) Random NEGATIVES: append unlikely suffixes; compare against the set
        // (a mutation could coincidentally be a real word, hence the set check).
        var trials = Math.min(200000, n);
        for (i = 0; i < trials; i++) {
          var w = sampleWords[(rnd() * n) | 0];
          var cand = w + (rnd() < 0.5 ? 'q' : 'zz');
          var expect = !!set[cand];
          if (this.isWord(cand) !== expect) {
            fails.push(['neg', cand, expect]);
          }
        }

        // (c) Prefix/edge invariants: every letter of a sampled word must be
        // walkable via edge(), and the final node must be a word node.
        var prefixTrials = Math.min(2000, n);
        for (i = 0; i < prefixTrials; i++) {
          var w2 = sampleWords[(rnd() * n) | 0];
          var h = this.root;
          var ok = true;
          for (var j = 0; j < w2.length; j++) {
            h = this.edge(h, w2.charAt(j));
            if (h === -1) {
              ok = false;
              break;
            }
          }
          if (!ok || !this.isWordNode(h)) {
            fails.push(['prefix', w2]);
          }
        }

        // (d) Structural invariants: the empty string is not a word, and the root
        // has outgoing letters (every initial letter occurs in ENABLE).
        if (this.isWord('')) {
          fails.push(['emptyIsWord']);
        }
        if (this.letters(this.root).length === 0) {
          fails.push(['rootNoLetters']);
        }

        return { ok: fails.length === 0, failures: fails.slice(0, 20), checked: n };
      }
    };

    return D;
  }

  // ===========================================================================
  // SECTION 5 — Public entry point.
  // ===========================================================================

  /*
   * build(sortedLowercaseWords) -> D. Constructs the minimal DAWG from an array
   * of lowercase a..z words that is ALREADY sorted (the sorted-input algorithm
   * depends on this). The object graph is built, packed into an Int32Array, then
   * discarded; only the small packed array survives in the returned D.
   *
   * Defensive but cheap: an empty input yields an empty DAWG (arr = [0], a root
   * edge with no children) so isWord returns false for everything. Sortedness is
   * NOT re-sorted blindly (re-sorting 168k items would waste the build budget);
   * we scan once for an out-of-order pair and only sort a copy if one is found,
   * so a correctly-sorted list pays just the O(n) scan.
   */
  function build(words) {
    // Empty input: a one-element array holding only the root/sentinel edge.
    if (!words || words.length === 0) {
      return makeDawg(new Int32Array([0]));
    }

    // Cheap sortedness guard: detect any descending adjacent pair.
    var sorted = true;
    for (var i = 1; i < words.length; i++) {
      if (words[i - 1] > words[i]) {
        sorted = false;
        break;
      }
    }
    // Only on violation do we sort a COPY (never mutate the caller's array).
    var input = sorted ? words : words.slice().sort();

    // Construct the minimal object graph, then pack and drop the objects.
    var root = construct(input);
    var packed = pack(root);
    // `root` (and the register, already local to construct) become unreachable
    // here and are reclaimed by GC; only `packed.arr` is retained by the facade.
    return makeDawg(packed.arr);
  }

  // Expose exactly the documented API (ARCHITECTURE.md §3). makeDawg/construct/
  // pack stay private to the module.
  SC.Dawg = { build: build };
})();
