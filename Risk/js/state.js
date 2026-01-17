// state.js - Game state management

(() => {
  const { TERRITORIES, CARD_TYPES, CONTINENTS, TRADE_VALUES, findTerritory } = window.RiskData;

  // Game state object - single source of truth
  const G = {
    phase: 'setup',
    players: [],
    currentPlayer: 0,
    humanPlayerId: 0,
    territories: {},
    deck: [],
    discardPile: [],
    tradeCount: 0,
    turnNumber: 1,
    armiesToPlace: 0,
    conqueredThisTurn: false,
    attackFrom: null,
    fortifyFrom: null,
    setupArmies: {},
    currentTerritoryIdx: 0,
    startTime: null,
    endTime: null,
    aiDelay: 2000,
    gameMode: 'manual',
    spectatorMode: false,
    paused: false,
    stats: {}
  };

  // Game log
  const gameLog = [];

  // Reset for new game
  function reset() {
    G.phase = 'setup';
    G.players = [];
    G.currentPlayer = 0;
    G.humanPlayerId = 0;
    G.territories = {};
    G.deck = [];
    G.discardPile = [];
    G.tradeCount = 0;
    G.turnNumber = 1;
    G.armiesToPlace = 0;
    G.conqueredThisTurn = false;
    G.attackFrom = null;
    G.fortifyFrom = null;
    G.setupArmies = {};
    G.currentTerritoryIdx = 0;
    G.startTime = null;
    G.endTime = null;
    G.gameMode = 'manual';
    G.spectatorMode = false;
    G.paused = false;
    G.stats = {};
    gameLog.length = 0;
  }

  // Initialize territories
  function initTerritories() {
    G.territories = {};
    for (const t of TERRITORIES) {
      G.territories[t.name] = { owner: null, troops: 0 };
    }
  }

  // Initialize deck
  function initDeck() {
    G.deck = [];
    for (const name in CARD_TYPES) {
      G.deck.push({ territory: name, type: CARD_TYPES[name] });
    }
    G.deck.push({ territory: null, type: 'Wild' });
    G.deck.push({ territory: null, type: 'Wild' });
    shuffleDeck();
  }

  // Shuffle deck
  function shuffleDeck() {
    for (let i = G.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [G.deck[i], G.deck[j]] = [G.deck[j], G.deck[i]];
    }
  }

  // Initialize stats
  function initStats() {
    G.stats = {
      troopsPlaced: {}, conquered: {}, lost: {},
      won: {}, failed: {}, cards: {},
      continents: {}, eliminated: {},
      peakTerritories: {}, peakTroops: {},
      attacks: {}, successfulAttacks: {}
    };
    for (const p of G.players) {
      G.stats.troopsPlaced[p.id] = 0;
      G.stats.conquered[p.id] = 0;
      G.stats.lost[p.id] = 0;
      G.stats.won[p.id] = 0;
      G.stats.failed[p.id] = 0;
      G.stats.cards[p.id] = 0;
      G.stats.continents[p.id] = [];
      G.stats.peakTerritories[p.id] = 0;
      G.stats.peakTroops[p.id] = 0;
      G.stats.attacks[p.id] = 0;
      G.stats.successfulAttacks[p.id] = 0;
    }
  }

  // Add log entry
  function log(msg, important = false, victory = false) {
    gameLog.push({
      turn: G.turnNumber,
      time: new Date().toLocaleTimeString(),
      player: G.players[G.currentPlayer]?.name || 'System',
      phase: G.phase, msg, important, victory
    });

    const el = document.getElementById('message-log');
    if (el) {
      const item = document.createElement('li');
      item.textContent = msg;
      if (important) item.classList.add('important');
      if (victory) item.classList.add('victory');
      el.insertBefore(item, el.firstChild);
      while (el.children.length > 100) el.removeChild(el.lastChild);
    }
  }

  // Get trade value
  function getTradeValue() {
    if (G.tradeCount < TRADE_VALUES.length) return TRADE_VALUES[G.tradeCount];
    return TRADE_VALUES[TRADE_VALUES.length - 1] + (G.tradeCount - TRADE_VALUES.length + 1) * 5;
  }

  // Get player territories
  function getPlayerTerritories(playerId) {
    return TERRITORIES.filter(t => G.territories[t.name].owner === playerId);
  }

  // Get enemy neighbors
  function getEnemyNeighbors(name, playerId) {
    const t = findTerritory(name);
    if (!t) return [];
    return t.borders
      .filter(b => G.territories[b]?.owner !== null && G.territories[b]?.owner !== playerId)
      .map(b => ({ name: b, troops: G.territories[b].troops, owner: G.territories[b].owner }));
  }

  // Check if connected through owned territory
  function areConnected(from, to, playerId) {
    const visited = new Set();
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === to) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const t = findTerritory(current);
      if (!t) continue;
      for (const neighbor of t.borders) {
        if (G.territories[neighbor]?.owner === playerId && !visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
    return false;
  }

  // Check continent control
  function controlsContinent(playerId, continent) {
    const contT = TERRITORIES.filter(t => t.continent === continent);
    return contT.every(t => G.territories[t.name].owner === playerId);
  }

  // Get controlled continents
  function getControlledContinents(playerId) {
    return Object.keys(CONTINENTS).filter(c => controlsContinent(playerId, c));
  }

  // Calculate reinforcements
  function calcReinforcements(playerId) {
    const owned = Object.values(G.territories).filter(t => t.owner === playerId).length;
    let armies = Math.max(3, Math.floor(owned / 3));
    for (const c in CONTINENTS) {
      if (controlsContinent(playerId, c)) armies += CONTINENTS[c].bonus;
    }
    return armies;
  }

  // Update peak stats
  function updatePeakStats() {
    for (const p of G.players) {
      const territories = getPlayerTerritories(p.id);
      const troops = territories.reduce((sum, t) => sum + G.territories[t.name].troops, 0);
      if (territories.length > G.stats.peakTerritories[p.id]) G.stats.peakTerritories[p.id] = territories.length;
      if (troops > G.stats.peakTroops[p.id]) G.stats.peakTroops[p.id] = troops;
    }
  }

  // Current territory
  function currentTerritory() { return TERRITORIES[G.currentTerritoryIdx]; }

  // Current player
  function currentPlayer() { return G.players[G.currentPlayer]; }

  // Serialize/restore
  function serialize() { return { state: JSON.parse(JSON.stringify(G)), log: [...gameLog] }; }
  function restore(data) {
    if (data.state) Object.assign(G, data.state);
    if (data.log) { gameLog.length = 0; gameLog.push(...data.log); }
  }

  window.RiskState = {
    G,
    gameLog,
    reset,
    initTerritories,
    initDeck,
    initStats,
    log,
    getTradeValue,
    getPlayerTerritories,
    getEnemyNeighbors,
    areConnected,
    controlsContinent,
    getControlledContinents,
    calcReinforcements,
    updatePeakStats,
    currentTerritory,
    currentPlayer,
    serialize,
    restore
  };
})();
