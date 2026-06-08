/*
 * state.js — Game state and the primitive operations that mutate it.
 *
 * Exposes SC.State. Holds the single source of truth (SC.State.G) for the board,
 * players, bag, and the in-progress play. Higher-level turn flow (scoring,
 * drawing after a play, advancing turns, end-of-game) is orchestrated by
 * SC.Game; this module only provides the low-level data + primitives.
 *
 * Depends on: SC.Data. No DOM. No other SC modules.
 */
(function () {
  window.SC = window.SC || {};
  var D = null; // lazily grab SC.Data on first use (load-order independence)

  function data() { return D || (D = SC.Data); }

  // Monotonic id source so every tile is uniquely identifiable (DOM, rack, undo).
  var nextTileId = 1;

  // The single shared game-state object. See ARCHITECTURE.md §2 for the shape.
  var G = {
    board: null,                   // (Tile|null)[15][15]
    players: [],                   // [Player]
    currentPlayer: 0,              // index into players
    bag: [],                       // [Tile] remaining, shuffled
    pending: [],                   // [Placement] in-progress placements this turn
    direction: 'across',           // current play direction
    turnNumber: 1,
    phase: 'setup',                // 'setup' | 'playing' | 'gameover'
    consecutiveScorelessTurns: 0,
    lastMove: null,                // Move | null
    moveLog: [],                   // [{playerName, move, turn}]
    startTime: null,
    endTime: null,
    config: {}
  };

  // ---- Construction helpers ------------------------------------------------

  // Build an empty 15x15 board.
  function emptyBoard() {
    var size = data().BOARD_SIZE;
    var b = new Array(size);
    for (var r = 0; r < size; r++) {
      b[r] = new Array(size);
      for (var c = 0; c < size; c++) b[r][c] = null;
    }
    return b;
  }

  // Make a single Tile object. letter '_' (or null) => an unassigned blank.
  function makeTile(letter) {
    var isBlank = (letter === '_' || letter === null);
    return {
      id: nextTileId++,
      letter: isBlank ? null : letter,
      isBlank: isBlank,
      points: isBlank ? 0 : data().pointsFor(letter)
    };
  }

  // Fill the bag from the standard distribution.
  function fillBag() {
    G.bag = [];
    var dist = data().TILE_DISTRIBUTION;
    for (var letter in dist) {
      if (!dist.hasOwnProperty(letter)) continue;
      for (var i = 0; i < dist[letter]; i++) G.bag.push(makeTile(letter));
    }
    shuffleBag();
  }

  // Fisher-Yates shuffle of the bag.
  function shuffleBag() {
    for (var i = G.bag.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = G.bag[i]; G.bag[i] = G.bag[j]; G.bag[j] = tmp;
    }
  }

  // ---- Public lifecycle ----------------------------------------------------

  // Reset to a pristine setup state.
  function reset() {
    nextTileId = 1;
    G.board = emptyBoard();
    G.players = [];
    G.currentPlayer = 0;
    G.bag = [];
    G.pending = [];
    G.direction = 'across';
    G.turnNumber = 1;
    G.phase = 'setup';
    G.consecutiveScorelessTurns = 0;
    G.lastMove = null;
    G.moveLog = [];
    G.startTime = null;
    G.endTime = null;
    G.config = {};
  }

  /*
   * Start a new game.
   * config.players: optional ordered [{name, isComputer, difficulty}]. If absent,
   * a sensible default is built from config.playerName / opponents / difficulty.
   */
  function newGame(config) {
    reset();
    G.config = config || {};

    var descriptors = (config && config.players) ? config.players : defaultPlayers(config);
    G.players = descriptors.map(function (p, idx) {
      return {
        id: idx,
        name: p.name,
        isHuman: !p.isComputer,
        isComputer: !!p.isComputer,
        difficulty: p.difficulty || 'medium',
        rack: [],
        score: 0
      };
    });

    assignComputerNames(G.players);

    fillBag();
    for (var i = 0; i < G.players.length; i++) drawTiles(G.players[i], 7);

    G.currentPlayer = 0;
    G.turnNumber = 1;
    G.phase = 'playing';
    G.startTime = Date.now();
  }

  // Replace each computer player's name with a fresh, unique themed name from the
  // data.js generator (the adjective hints at difficulty). Humans keep their names.
  function assignComputerNames(players) {
    if (!data().generateComputerNames) return;
    var comps = [];
    for (var i = 0; i < players.length; i++) if (players[i].isComputer) comps.push(players[i]);
    if (!comps.length) return;
    var modes = comps.map(function (p) { return p.difficulty; });
    var names = data().generateComputerNames(modes);
    for (var j = 0; j < comps.length; j++) if (names[j]) comps[j].name = names[j];
  }

  // Default player roster when the caller didn't supply an explicit list.
  function defaultPlayers(config) {
    config = config || {};
    var list = [{ name: config.playerName || 'You', isComputer: false }];
    var opponents = (config.opponents != null) ? config.opponents : 1;
    for (var i = 0; i < opponents; i++) {
      list.push({
        name: opponents > 1 ? ('Computer ' + (i + 1)) : 'Computer',
        isComputer: true,
        difficulty: config.difficulty || 'medium'
      });
    }
    return list;
  }

  // ---- Bag / rack primitives ----------------------------------------------

  // Draw up to n tiles from the bag into player's rack; returns the drawn tiles.
  function drawTiles(player, n) {
    var drawn = [];
    for (var i = 0; i < n && G.bag.length > 0; i++) {
      var t = G.bag.pop();
      player.rack.push(t);
      drawn.push(t);
    }
    return drawn;
  }

  // Return tiles to the bag (e.g. after an exchange) and reshuffle. Blanks are
  // reset to unassigned so they can be redrawn cleanly.
  function returnTiles(tiles) {
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (t.isBlank) { t.letter = null; t.points = 0; }
      G.bag.push(t);
    }
    shuffleBag();
  }

  function currentPlayer() { return G.players[G.currentPlayer]; }
  function bagCount() { return G.bag.length; }

  /*
   * Count of every tile NOT visible to `player`: everything in the bag plus all
   * opponents' racks, keyed by letter ('_' for blanks). Powers the "T" key
   * (unseen-tile tracking), a core strategic aid.
   */
  function unseenTiles(player) {
    var counts = {};
    var letters = data().LETTERS + '_';
    for (var k = 0; k < letters.length; k++) counts[letters[k]] = 0;

    function tally(t) {
      var key = t.isBlank ? '_' : t.letter;
      if (counts[key] != null) counts[key]++;
    }
    for (var i = 0; i < G.bag.length; i++) tally(G.bag[i]);
    for (var p = 0; p < G.players.length; p++) {
      if (G.players[p] === player) continue;
      var rack = G.players[p].rack;
      for (var r = 0; r < rack.length; r++) tally(rack[r]);
    }
    return counts;
  }

  // ---- Pending (in-progress) placements -----------------------------------

  function addPending(row, col, tile) { G.pending.push({ row: row, col: col, tile: tile }); }

  // Remove and return the most recently staged placement (for tile-by-tile undo).
  function removePendingLast() {
    return G.pending.length ? G.pending.pop() : null;
  }

  // Clear all pending placements; returns the tiles so the caller can restore the rack.
  function clearPending() {
    var tiles = G.pending.map(function (p) { return p.tile; });
    G.pending = [];
    return tiles;
  }

  function getPending() { return G.pending; }

  // ---- Persistence (autosave/resume) --------------------------------------

  function serialize() {
    return { state: JSON.parse(JSON.stringify(G)), nextTileId: nextTileId };
  }
  function restore(data) {
    if (!data) return;
    if (data.state) {
      // Replace G's contents in place so existing references stay valid.
      for (var k in G) { if (G.hasOwnProperty(k)) delete G[k]; }
      var s = data.state;
      for (var key in s) { if (s.hasOwnProperty(key)) G[key] = s[key]; }
    }
    if (data.nextTileId) nextTileId = data.nextTileId;
  }

  SC.State = {
    G: G,
    reset: reset,
    newGame: newGame,
    fillBag: fillBag,
    shuffleBag: shuffleBag,
    makeTile: makeTile,
    drawTiles: drawTiles,
    returnTiles: returnTiles,
    currentPlayer: currentPlayer,
    bagCount: bagCount,
    unseenTiles: unseenTiles,
    addPending: addPending,
    removePendingLast: removePendingLast,
    clearPending: clearPending,
    getPending: getPending,
    serialize: serialize,
    restore: restore
  };
})();
