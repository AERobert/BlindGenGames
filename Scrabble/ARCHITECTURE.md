# Accessible Scrabble — Code Architecture & Module Contract

This is the **authoritative implementation contract**. Every module is written to
the signatures and data shapes defined here so the separately-developed files
integrate cleanly. Behaviour/UX details live in `INTERFACE_DESIGN.md`; rules live
in `SCRABBLE_RULES.md`; algorithm specifics are refined in `research/SPEC-*.md`.

---

## 0. Hard Constraints

- **No server, runs from `file://`.** Therefore: **no ES modules**, no
  `import/export`, **no `fetch()`**. Every file is a classic `<script>`.
- **Word list** is loaded via `js/dictionary-data.js` (a `<script>` that sets
  `window.SCRABBLE_WORDS` — a sorted array of lowercase words — and
  `window.SCRABBLE_DICT_META`). Never read `dictionary.json` at runtime.
- **Separate files** (HTML / CSS / per-concern JS) like the Risk codebase, glued
  with `<script>` tags — no build step.
- **One global namespace: `window.SC`.** Each file does
  `window.SC = window.SC || {}; SC.X = (function(){ ... })();`.
- Modules reference other `SC.*` modules **only inside functions** (called at/after
  init), never at load time, so script order is not fragile.
- **Comment thoroughly**, clean and DRY (per repo style). Plain ES5-ish JS (the
  other games use `var`/IIFE); avoid bleeding-edge syntax for max browser support.

---

## 1. File Layout & Script Load Order

```
Scrabble/
  index.html            DOM skeleton + <script> tags + <link> to css
  css/styles.css        all styling (sighted-assist visuals + a11y focus styles)
  js/dictionary-data.js  [generated] window.SCRABBLE_WORDS + _META
  js/data.js             SC.Data   — constants, tiles, premium layout, coord helpers
  js/dawg.js             SC.Dawg   — minimal DAWG build + traversal (move-gen core)
  js/dictionary.js       SC.Dict   — validity Set + DAWG wiring
  js/state.js            SC.State  — game state + bag/rack/board primitives
  js/rules.js            SC.Rules  — placement validation + scoring (pure)
  js/ai.js               SC.AI     — move generation + evaluation + difficulty
  js/speech.js           SC.Speech — dual TTS + ARIA (port of Risk speech.js)
  js/sounds.js           SC.Sounds — Web Audio cues incl. spatial
  js/board.js            SC.Board  — board DOM, cursor, review, square announcements
  js/ui.js               SC.UI     — rack, composer, preview, exchange, settings, help
  js/game.js             SC.Game   — controller: turn flow + keyboard dispatch + init
```

`<script>` order in `index.html`: dictionary-data → data → dawg → dictionary →
state → rules → ai → speech → sounds → board → ui → game. (game.js wires & inits
on load.)

---

## 2. Core Data Shapes (shared vocabulary — do not deviate)

### Tile
A physical tile.
```js
{ id: 17,          // unique within a game (for DOM/rack tracking)
  letter: 'A',     // 'A'..'Z' uppercase; null for an UNASSIGNED blank in the rack
  isBlank: false,  // true for the two blank tiles
  points: 1 }      // face value; a blank is ALWAYS 0, even once assigned a letter
```
- Unassigned blank in rack: `{id, letter:null, isBlank:true, points:0}`.
- Blank played as E: `{id, letter:'E', isBlank:true, points:0}`.

### Board
`SC.State.G.board` = 15×15 array. `board[row][col]` is a committed **Tile** or
`null`. Indices: row 0..14 = A..O, col 0..14 = 1..15.

### Placement (a staged, not-yet-committed tile during the current turn)
```js
{ row, col, tile }   // tile is the Tile being placed (blank already assigned)
```
`SC.State.G.pending` is the array of placements for the in-progress play. The
board cell stays `null` until commit; the Board renders pending tiles as an
overlay.

### Move (output of validation/scoring and of the AI)
```js
{ row, col,                 // start (top/left-most) cell of the main word
  dir: 'across'|'down',
  word: 'BARN',             // main word, uppercase, includes existing board letters
  placements: [Placement],  // NEW tiles only
  mainWord:   { word, score, cells:[{row,col}] },
  crossWords: [ { word, score, cells } ],
  score: 0,                 // total incl. premiums + 50 bingo bonus
  isBingo: false,
  valid: true,
  reason: null,             // string if !valid
  leave: 'EIO',             // AI: rack remaining after the play (uppercase letters)
  equity: 0 }               // AI: score + leaveValue(leave)
```

### Player
```js
{ id, name, isHuman:true, isComputer:false,
  difficulty:'medium', rack:[Tile], score:0 }
```

### GameState — `SC.State.G`
```js
{ board: (Tile|null)[15][15],
  players: [Player],
  currentPlayer: 0,           // index into players
  bag: [Tile],                // remaining tiles (shuffled)
  pending: [Placement],       // in-progress placements this turn
  direction: 'across',        // current play direction (shared by composer + tile-by-tile)
  turnNumber: 1,
  phase: 'setup'|'playing'|'gameover',
  consecutiveScorelessTurns: 0,
  lastMove: Move|null,
  moveLog: [ {playerName, move, turn} ],
  startTime, endTime,
  config: {...} }             // snapshot of chosen settings for this game
```
(The board-review **cursor** lives in `SC.Board`, not here.)

---

## 3. Module Public APIs

### SC.Data  (data.js — DONE)
`BOARD_SIZE`, `CENTER {row,col}`, `TILE_POINTS{}`, `TILE_DISTRIBUTION{}`,
`LETTERS`, `PREMIUM_LAYOUT[]`, `PREMIUM[15][15]` (descriptor `{word,letter,name,code,center?}` or null),
`coordToString(r,c)`, `stringToCoord("H8")`, `pointsFor(letter)`,
`premiumAt(r,c)`, `inBounds(r,c)`.

### SC.Dawg  (dawg.js)
Minimal DAWG built from the sorted word list (Daciuk incremental construction —
input is already sorted, so this is O(total letters)). Node-terminal model.
Expose a representation-independent traversal API:
- `build(sortedLowercaseWords) -> D`
- `D.root -> node` (opaque handle)
- `D.edge(node, letter) -> node | -1`   // letter is lowercase 'a'..'z'
- `D.isWordNode(node) -> bool`          // path to node spells a complete word
- `D.letters(node) -> ['a','c',...]`    // outgoing edge letters (for move-gen)
- `D.isWord(str) -> bool`               // convenience (walk from root)
Recommend a compact representation (packed `Int32Array`) if object nodes use too
much memory for ~168k words; see `research/SPEC-dawg.md`. Must include a self-test
helper `D.selfTest(sampleWords)` used by the verifier.

### SC.Dict  (dictionary.js)
- `init() -> void`  — builds `Set` of all words (for `isWord`) from
  `window.SCRABBLE_WORDS`, and `SC.Dict.dawg = SC.Dawg.build(words)`. Sets
  `SC.Dict.ready = true`. Synchronous; the caller shows a "Loading dictionary…"
  message and calls this inside a `setTimeout` so the message renders first.
- `isWord(word) -> bool`  (case-insensitive)
- `dawg -> D`            (the DAWG, for SC.AI)
- `meta -> window.SCRABBLE_DICT_META`
- `size() -> number`, `ready -> bool`

### SC.State  (state.js)
- `G` (the GameState above)
- `newGame(config) -> void`   — build players, fill+shuffle bag, deal 7 each,
  empty board, set currentPlayer/turn/phase='playing'.
- `reset()`
- `drawTiles(player, n) -> Tile[]`   — move up to n bag→rack; returns drawn.
- `returnTiles(tiles) -> void`       — tiles→bag, then shuffle (exchange).
- `currentPlayer() -> Player`
- `bagCount() -> number`
- `unseenTiles(player) -> {A:count,...,'_':count}`  — bag + opponents' racks (for the T key)
- `addPending(row,col,tile)`, `removePendingLast() -> Placement|null`,
  `clearPending() -> Tile[]` (returns tiles for the rack), `getPending() -> Placement[]`
- `serialize() -> obj`, `restore(obj)`

### SC.Rules  (rules.js — pure, no DOM)
- `validatePlacement(board, placements, isFirstMove) -> {valid, reason}`
  Checks: ≥1 placed; all in one line; contiguous incl. existing tiles (no gaps);
  connected to existing tiles (or, first move, covers CENTER and ≥2 tiles);
  every placed cell currently empty; in bounds.
- `wordsFormed(board, placements) -> [ {word, dir, cells:[{row,col,letter,isBlank,fromBoard}]} ]`
  main word first, then cross words (only words ≥2 letters that include a new tile).
- `scorePlay(board, placements) -> {score, words:[{word,score}], isBingo}`
  Premiums apply ONLY under newly placed tiles; letter premiums first, then word
  multipliers (multiplied together across the word); sum all words; +50 if exactly
  7 tiles placed. Blanks contribute 0 letter value but still trigger word premiums.
- `evaluatePlay(board, placements, isFirstMove) -> Move`
  Convenience: validate + wordsFormed + score + word validity (via SC.Dict).
  Sets `valid/reason/word/mainWord/crossWords/score/isBingo`. Used by the
  Composer preview AND tile-by-tile "verify (Y)".

### SC.AI  (ai.js)
- `generateMoves(board, rack, isFirstMove) -> Move[]`  — ALL legal plays
  (Appel–Jacobson DAWG generator with cross-check sets, anchors). See
  `research/SPEC-movegen.md`.
- `chooseMove(board, rack, difficulty, isFirstMove) -> Move | null`
  null ⇒ no play found (caller exchanges/passes). Difficulty:
  - `easy`   — random from lower-scoring legal moves
  - `medium` — max raw score
  - `hard`   — max (score + leaveValue(leave))
  - `expert` — hard + shallow Monte-Carlo (optional; fall back to hard)
- `leaveValue(leaveStr) -> number`  (table or heuristic; see research/SPEC-leaves.md)
- `findHints(board, rack, isFirstMove, n) -> Move[]`  — top n by equity (for the F key)

### SC.Speech  (speech.js — port Risk/js/speech.js, namespaced)
`init()`, `speak(text, interrupt=true)`, `repeat()`, `spell(text)` (letter-by-letter,
NATO per setting), `setVoice(name)`, `setRate(r)`, `getRate()`, `toggleVoice()`,
`toggleAria()`, `isVoiceEnabled()`, `isAriaEnabled()`, `populateVoiceSelect(id)`,
`getSettings()`, `restoreSettings(s)`. Dual output: Web Speech **and** ARIA live
regions `#sc-live` (polite) + `#sc-live-assertive` (assertive). Keep Risk's Chrome
hardening (voice-by-name, warm-up, cancel→delay→speak, periodic resume).

### SC.Sounds  (sounds.js — port Risk/js/sounds.js + spatial)
`init()`, `play(type, opts)`, `toggle()`, `setEnabled(b)`, `setVolume(0..1)`,
`getSettings()`, `restoreSettings(s)`. Implement the event→cue map in
INTERFACE_DESIGN §8. `opts` may include `{col,row}`; when spatial audio is on, pan
by column (StereoPanner) and shift pitch by row. Types include: `move, edge,
onTile, premiumDL, premiumTL, premiumDW, premiumTW, stage, invalid, validWord,
commit, bingo, scoreTick, draw, blank, exchange, pass, yourTurn, oppThinking,
oppPlayed, win, lose, ui`.

### SC.Board  (board.js)
- `render()` — (re)build the 15×15 grid: `role="grid"` > `role="row"` >
  `role="gridcell"`, each with `aria-label` from `squareLabel`. Wrap container in
  `role="application"`. Reflect committed board + pending overlay + premiums.
- cursor: `getCursor()`, `setCursor(r,c)`, `moveCursor(dir)` (dir in
  `'up'|'down'|'left'|'right'`; edge → `Sounds.play('edge')`). Track via
  `aria-activedescendant` on the grid.
- announce: `announceSquare(r,c)` (contents-first then premium, honoring verbosity
  & toggles), `readRow()`, `readColumn()`, `readBoard()` (occupied only),
  `readWordsThrough(r,c)`.
- jump: `jumpToCoord("H8")`, `jumpToCenter()`, `nextAnchor(+1|-1)`,
  `nextPremium(+1|-1)`.
- `squareLabel(r,c) -> string` (also used for cell aria-label).
- Reads SC.State (board/pending), SC.Data, speaks via SC.Speech, cues via SC.Sounds.

### SC.UI  (ui.js)
- `init()`, `renderRack()`, `announceRack()`, `announceSlot(n)`,
  `rackValueSummary()`, `shuffleRack()`.
- Composer: `openComposer()`, `closeComposer()`, `onComposerInput(value)`
  (live preview text via `aria-describedby`), `toggleComposerDirection()`,
  `composerToPreview()`. Blank syntax `C(A)T`; auto-blank fallback w/ announce.
- Preview: `showPreview(move)`, `commitFromPreview()`, `toggleBlankInPreview()`,
  `cancelPreview()`.
- Exchange: `openExchange()`, `toggleExchangeTile(n)`, `confirmExchange()`,
  `cancelExchange()`.
- Settings: `openSettings()` / `closeSettings()` — controls bound to SC.Speech /
  SC.Sounds / `G.config`; **persist to localStorage on every change**, restore on load.
- Help: `showHelp()`, `hideHelp()`.
- Status: `announceStatus()`, `announceScores()`, `announceBag()`,
  `announceUnseen()`, `updateInfoPanel()`, `announceMoveLog()`.
- `showGameOver(result)`, `findHint()`.
- Overlays are `role="dialog" aria-modal="true"`, focus-trapped, `Esc` closes,
  focus restored on close.

### SC.Game  (game.js — controller)
- `init()` — init Speech/Sounds; show "Loading dictionary…" then `SC.Dict.init()`
  in a `setTimeout`; restore settings; wire setup screen; attach the single global
  `keydown` handler.
- `startGame(config)`, `newGame()`.
- `handleKey(e)` — central dispatch. Respect MODE: if an overlay/composer/exchange
  is open, route there; else Navigation-mode keymap (see INTERFACE_DESIGN §5).
  Let Ctrl/Cmd/Alt pass through to the browser.
- turn flow: `commitPlay(move)`, `placeTileFromSlot(n)`, `undoLastPending()`,
  `recallAllPending()`, `verifyPending()`, `pass()`, `exchange(tiles)`,
  `endTurn()`, `nextPlayer()`, `aiTurn()`, `checkGameEnd()`, `endGame()`.

---

## 4. Algorithm Plan (refined by research/SPEC-*.md)

- **DAWG build:** Daciuk incremental minimization over the already-sorted list.
- **Move generation:** Appel–Jacobson — find anchor squares, compute per-square
  cross-check letter sets (which letters form valid perpendicular words), then for
  each anchor generate the left part and extend right through the DAWG, drawing
  from the rack (blanks = wildcard) and respecting cross-checks. (GADDAG is the
  faster alternative; DAWG+cross-checks is simpler and ample for one move/turn.)
- **Scoring:** as SCRABBLE_RULES.md §6 — premiums only under new tiles, letter
  premiums before word multipliers, word multipliers multiply, all words summed,
  +50 for a 7-tile bingo, blanks 0 but still trigger word premiums.
- **Evaluation / difficulty:** score + leave equity; leave table sourced from a
  permissively-licensed set (Quackle "superleaves" BSD, or Andy Kurnia KLV MIT) or
  a documented heuristic fallback. See research/SPEC-leaves.md.

---

## 5. Accessibility & Keys

Follow `INTERFACE_DESIGN.md` exactly for keys, announcement wording, verbosity,
sounds, and ARIA. Key dispatch is owned by `SC.Game.handleKey`. Reuse the proven
patterns in `Risk/js/speech.js`, `Risk/js/sounds.js`, and the keyboard handling in
`Risk/index.html` / `2048/2048-accessible.html`.

---

## 6. Testing Plan (DOM-free modules tested in Node)

`dawg.js`, `dictionary.js`, `data.js`, `rules.js`, `ai.js` must run under Node with
only a window shim — use **`global.window = global;`** before `require()` (in a
browser `window` *is* the global, so modules that do `window.SC = ...` then
reference bare `SC` work; the shim reproduces that in Node). No DOM. The verifier
writes Node tests asserting:
- DAWG `isWord` agrees with a Set for a large random sample; prefix/edge behavior.
- Scoring matches hand-computed vectors (opening double, DLS+DWS, triple-triple,
  cross-words, bingo +50, blank = 0 but word premium applies).
- `generateMoves` returns only legal plays (each re-validated) and finds known
  plays on small fixtures.
UI/board/game are syntax-checked (`node --check`) and reviewed; runtime-verified in
a browser later.

---

## 7. Contract Refinements (post-research — AUTHORITATIVE; override anything above)

Resolutions to ambiguities the research agents surfaced. Implementers MUST follow
these and consult the matching `research/SPEC-*.md`.

### 7.0 Files already written — DO NOT MODIFY
`js/dictionary-data.js`, `js/data.js`, `js/state.js`, `index.html`,
`ARCHITECTURE.md`, and every `research/SPEC-*.md` are authoritative and complete.
Read them; never overwrite them. `index.html` is the SOURCE OF TRUTH for element
IDs/roles and `<script>` load order — use those exact IDs; if one seems missing,
flag it, do not invent it.

### 7.1 SC.Dawg handles (see SPEC-dawg.md)
- A "node handle" is an OPAQUE integer. In the recommended packed `Int32Array`
  DAWG it is the index of the edge leading INTO the node (root = synthetic edge 0).
  `edge(node, letter)` returns a handle to pass back into `edge/letters/isWordNode`;
  `isWordNode(node)` reads the end-of-word bit on that incoming edge. Do not assume
  node≠edge or build a `$`-sentinel design.
- `SC.Dawg` consumes **lowercase a–z only**. Tiles, board, and `Move.word` are
  UPPERCASE (§2). Any DAWG walk MUST lowercase before `edge()` and uppercase when
  emitting Move/Tile data.

### 7.2 Move direction & single-tile plays (see SPEC-movegen.md)
- `generateMoves` emits placement plays only (never pass/exchange). A single-tile
  play is emitted once per direction in which it forms a ≥2-letter word, keyed by
  `dir` for de-dup. `chooseMove` returns `null` when no placement play exists.
- `SC.Rules.evaluatePlay(board, placements, isFirstMove, dir)` — `dir` is OPTIONAL
  ('across'|'down'). With ≥2 collinear tiles dir is inferred; for a single tile the
  caller passes `dir` (default 'across'). The set of words scored is the same either
  way, so the total is direction-independent.

### 7.3 evaluatePlay on invalid words (see SPEC-scoring.md)
- If a formed word is not in the dictionary, `evaluatePlay` still returns the
  would-be `score` (for the "would be N points, but FOO isn't a word" message),
  with `valid:false` and `reason` naming the offending word(s). The controller
  blocks commit on `valid:false`.

### 7.4 Leave values — heuristic, NOT a table (see SPEC-leaves.md)
- CORRECTION: Quackle superleaves are GPLv3 (not BSD) and ~7.6 MB — unusable here;
  wolges KLV2 (MIT) is permissive but TWL/CSW-tuned, not ENABLE. So
  `SC.AI.leaveValue(leaveStr)` is the **verified heuristic in SPEC-leaves.md**
  (base tile values + duplicate penalty + vowel/consonant balance + Q-without-U,
  blank, and bingo-stem terms; reproduces published Quackle/Valett anchors).
- `Move.leave` = rack remainder as UPPERCASE letters, an unused blank written `?`
  (e.g. "AEI?"); `leaveValue` treats `?` as the blank.

### 7.5 AI exchange/pass + endgame (see SPEC-leaves.md)
- Add `SC.AI.recommendExchange(board, rack) -> Tile[] | null`. When `chooseMove`
  returns null the controller calls `recommendExchange`; if that is null it passes.
  SC.Game owns pass/exchange and the six-scoreless-turn rule and may override the AI
  to avoid ending the game when a scoring play exists.
- `expert` = shallow (~2-ply) Monte-Carlo, ~350 ms budget + `allowSimulation`
  kill-switch, falling back to `hard` on timeout/disable.

### 7.6 SC.Speech additions (see SPEC-housestyle.md)
- `setRate(r)` clamps to **0.5–6.0** (default 2.5). Add `alert(text)` → assertive
  region `#sc-live-assertive` (illegal move / your turn / game over); `speak(text)`
  → polite `#sc-live` + TTS. Keep `getVoiceName()`, `isSupported()`. Add
  `spell(text, forceNato?)` + `setNatoMode('off'|'demand'|'always')`.
- ECHO DISCIPLINE: the cursor uses `aria-activedescendant` for focus/visual
  tracking; square content is spoken via SC.Speech (TTS + ONE live region), never
  also re-read from a separate activedescendant label — no double-speaking.
