// bundle.js - Combined Risk modules for file:// usage

(() => {
  const TERRITORIES = [
    {"name":"Alaska","borders":["Northwest Territory","Alberta","Kamchatka"],"continent":"North America","directions":{"north":"ocean","northeast":"ocean","east":"Northwest Territory","southeast":"Alberta","south":"ocean","southwest":"ocean","west":"Kamchatka","northwest":"ocean"}},
    {"name":"Alberta","borders":["Alaska","Northwest Territory","Ontario","Western US"],"continent":"North America","directions":{"north":"Northwest Territory","northeast":"ocean","east":"Ontario","southeast":"ocean","south":"Western US","southwest":"ocean","west":"ocean","northwest":"Alaska"}},
    {"name":"Central America","borders":["Western US","Eastern US","Venezuela"],"continent":"North America","directions":{"north":"ocean","northeast":"Eastern US","east":"Venezuela","southeast":"ocean","south":"ocean","southwest":"ocean","west":"ocean","northwest":"Western US"}},
    {"name":"Eastern Canada","borders":["Ontario","Greenland","Eastern US"],"continent":"North America","directions":{"north":"Greenland","northeast":"ocean","east":"ocean","southeast":"ocean","south":"ocean","southwest":"Eastern US","west":"Ontario","northwest":"ocean"}},
    {"name":"Eastern US","borders":["Ontario","Eastern Canada","Western US","Central America"],"continent":"North America","directions":{"north":"Ontario","northeast":"Eastern Canada","east":"ocean","southeast":"ocean","south":"ocean","southwest":"Central America","west":"Western US","northwest":"ocean"}},
    {"name":"Greenland","borders":["Northwest Territory","Ontario","Eastern Canada","Iceland"],"continent":"North America","directions":{"north":"ocean","northeast":"ocean","east":"Iceland","southeast":"ocean","south":"Eastern Canada","southwest":"Ontario","west":"Northwest Territory","northwest":"ocean"}},
    {"name":"Northwest Territory","borders":["Alaska","Alberta","Ontario","Greenland"],"continent":"North America","directions":{"north":"ocean","northeast":"ocean","east":"Greenland","southeast":"Ontario","south":"Alberta","southwest":"ocean","west":"Alaska","northwest":"ocean"}},
    {"name":"Ontario","borders":["Northwest Territory","Alberta","Greenland","Eastern Canada","Western US","Eastern US"],"continent":"North America","directions":{"north":"ocean","northeast":"Greenland","east":"Eastern Canada","southeast":"ocean","south":"Eastern US","southwest":"Western US","west":"Alberta","northwest":"Northwest Territory"}},
    {"name":"Western US","borders":["Alberta","Ontario","Eastern US","Central America"],"continent":"North America","directions":{"north":"Alberta","northeast":"Ontario","east":"Eastern US","southeast":"Central America","south":"ocean","southwest":"ocean","west":"ocean","northwest":"ocean"}},
    {"name":"Argentina","borders":["Peru","Brazil"],"continent":"South America","directions":{"north":"Peru","northeast":"Brazil","east":"ocean","southeast":"ocean","south":"ocean","southwest":"ocean","west":"ocean","northwest":"ocean"}},
    {"name":"Brazil","borders":["Venezuela","Peru","Argentina","North Africa"],"continent":"South America","directions":{"north":"ocean","northeast":"ocean","east":"North Africa","southeast":"ocean","south":"ocean","southwest":"Argentina","west":"Peru","northwest":"Venezuela"}},
    {"name":"Peru","borders":["Venezuela","Brazil","Argentina"],"continent":"South America","directions":{"north":"ocean","northeast":"Venezuela","east":"Brazil","southeast":"ocean","south":"Argentina","southwest":"ocean","west":"ocean","northwest":"ocean"}},
    {"name":"Venezuela","borders":["Central America","Peru","Brazil"],"continent":"South America","directions":{"north":"ocean","northeast":"ocean","east":"ocean","southeast":"Brazil","south":"ocean","southwest":"Peru","west":"Central America","northwest":"ocean"}},
    {"name":"Great Britain","borders":["Iceland","Northern Europe","Scandinavia","Western Europe"],"continent":"Europe","directions":{"north":"ocean","northeast":"Scandinavia","east":"Northern Europe","southeast":"ocean","south":"Western Europe","southwest":"ocean","west":"ocean","northwest":"Iceland"}},
    {"name":"Iceland","borders":["Greenland","Great Britain","Scandinavia"],"continent":"Europe","directions":{"north":"ocean","northeast":"ocean","east":"Scandinavia","southeast":"Great Britain","south":"ocean","southwest":"ocean","west":"Greenland","northwest":"ocean"}},
    {"name":"Northern Europe","borders":["Great Britain","Scandinavia","Russia","Southern Europe","Western Europe"],"continent":"Europe","directions":{"north":"Scandinavia","northeast":"ocean","east":"Russia","southeast":"ocean","south":"Southern Europe","southwest":"Western Europe","west":"Great Britain","northwest":"ocean"}},
    {"name":"Russia","borders":["Scandinavia","Northern Europe","Southern Europe","Middle East","Afghanistan","Ural"],"continent":"Europe","directions":{"north":"ocean","northeast":"Ural","east":"ocean","southeast":"Afghanistan","south":"Middle East","southwest":"Southern Europe","west":"Northern Europe","northwest":"Scandinavia"}},
    {"name":"Scandinavia","borders":["Iceland","Great Britain","Northern Europe","Russia"],"continent":"Europe","directions":{"north":"ocean","northeast":"ocean","east":"ocean","southeast":"Russia","south":"Northern Europe","southwest":"Great Britain","west":"Iceland","northwest":"ocean"}},
    {"name":"Southern Europe","borders":["Western Europe","Northern Europe","Russia","Middle East","Egypt","North Africa"],"continent":"Europe","directions":{"north":"Northern Europe","northeast":"Russia","east":"ocean","southeast":"Middle East","south":"Egypt","southwest":"North Africa","west":"Western Europe","northwest":"ocean"}},
    {"name":"Western Europe","borders":["Great Britain","Northern Europe","Southern Europe","North Africa"],"continent":"Europe","directions":{"north":"Great Britain","northeast":"Northern Europe","east":"Southern Europe","southeast":"ocean","south":"North Africa","southwest":"ocean","west":"ocean","northwest":"ocean"}},
    {"name":"Central Africa","borders":["North Africa","East Africa","South Africa"],"continent":"Africa","directions":{"north":"North Africa","northeast":"ocean","east":"East Africa","southeast":"ocean","south":"South Africa","southwest":"ocean","west":"ocean","northwest":"ocean"}},
    {"name":"East Africa","borders":["Egypt","North Africa","Central Africa","South Africa","Madagascar","Middle East"],"continent":"Africa","directions":{"north":"Egypt","northeast":"Middle East","east":"ocean","southeast":"Madagascar","south":"ocean","southwest":"South Africa","west":"Central Africa","northwest":"North Africa"}},
    {"name":"Egypt","borders":["Southern Europe","North Africa","East Africa","Middle East"],"continent":"Africa","directions":{"north":"Southern Europe","northeast":"ocean","east":"Middle East","southeast":"ocean","south":"East Africa","southwest":"ocean","west":"North Africa","northwest":"ocean"}},
    {"name":"Madagascar","borders":["East Africa","South Africa"],"continent":"Africa","directions":{"north":"ocean","northeast":"ocean","east":"ocean","southeast":"ocean","south":"ocean","southwest":"ocean","west":"South Africa","northwest":"East Africa"}},
    {"name":"North Africa","borders":["Western Europe","Southern Europe","Egypt","East Africa","Central Africa","Brazil"],"continent":"Africa","directions":{"north":"Western Europe","northeast":"Southern Europe","east":"Egypt","southeast":"East Africa","south":"Central Africa","southwest":"ocean","west":"Brazil","northwest":"ocean"}},
    {"name":"South Africa","borders":["Central Africa","East Africa","Madagascar"],"continent":"Africa","directions":{"north":"Central Africa","northeast":"East Africa","east":"Madagascar","southeast":"ocean","south":"ocean","southwest":"ocean","west":"ocean","northwest":"ocean"}},
    {"name":"Afghanistan","borders":["Russia","Ural","China","India","Middle East"],"continent":"Asia","directions":{"north":"Ural","northeast":"ocean","east":"China","southeast":"India","south":"ocean","southwest":"Middle East","west":"ocean","northwest":"Russia"}},
    {"name":"China","borders":["Siberia","Mongolia","Siam","India","Afghanistan","Ural"],"continent":"Asia","directions":{"north":"Mongolia","northeast":"Siberia","east":"ocean","southeast":"ocean","south":"Siam","southwest":"India","west":"Afghanistan","northwest":"Ural"}},
    {"name":"India","borders":["Middle East","Afghanistan","China","Siam"],"continent":"Asia","directions":{"north":"ocean","northeast":"China","east":"ocean","southeast":"Siam","south":"ocean","southwest":"ocean","west":"Middle East","northwest":"Afghanistan"}},
    {"name":"Irkutsk","borders":["Siberia","Yakutsk","Mongolia","Kamchatka"],"continent":"Asia","directions":{"north":"Siberia","northeast":"Yakutsk","east":"Kamchatka","southeast":"ocean","south":"Mongolia","southwest":"ocean","west":"ocean","northwest":"ocean"}},
    {"name":"Japan","borders":["Mongolia","Kamchatka"],"continent":"Asia","directions":{"north":"Kamchatka","northeast":"ocean","east":"ocean","southeast":"ocean","south":"ocean","southwest":"ocean","west":"Mongolia","northwest":"ocean"}},
    {"name":"Kamchatka","borders":["Alaska","Yakutsk","Irkutsk","Mongolia","Japan"],"continent":"Asia","directions":{"north":"ocean","northeast":"ocean","east":"Alaska","southeast":"ocean","south":"Japan","southwest":"Mongolia","west":"Irkutsk","northwest":"Yakutsk"}},
    {"name":"Middle East","borders":["Egypt","East Africa","Russia","Southern Europe","Afghanistan","India"],"continent":"Asia","directions":{"north":"Russia","northeast":"Afghanistan","east":"India","southeast":"ocean","south":"ocean","southwest":"East Africa","west":"Egypt","northwest":"Southern Europe"}},
    {"name":"Mongolia","borders":["Siberia","Irkutsk","Kamchatka","Japan","China"],"continent":"Asia","directions":{"north":"Irkutsk","northeast":"Kamchatka","east":"Japan","southeast":"ocean","south":"China","southwest":"ocean","west":"ocean","northwest":"Siberia"}},
    {"name":"Siam","borders":["China","India","Indonesia"],"continent":"Asia","directions":{"north":"China","northeast":"ocean","east":"ocean","southeast":"Indonesia","south":"ocean","southwest":"ocean","west":"ocean","northwest":"India"}},
    {"name":"Siberia","borders":["Ural","Yakutsk","Irkutsk","Mongolia","China"],"continent":"Asia","directions":{"north":"ocean","northeast":"ocean","east":"Yakutsk","southeast":"Mongolia","south":"Irkutsk","southwest":"China","west":"Ural","northwest":"ocean"}},
    {"name":"Ural","borders":["Russia","Afghanistan","Siberia","China"],"continent":"Asia","directions":{"north":"ocean","northeast":"ocean","east":"Siberia","southeast":"China","south":"Afghanistan","southwest":"Russia","west":"ocean","northwest":"ocean"}},
    {"name":"Yakutsk","borders":["Siberia","Irkutsk","Kamchatka"],"continent":"Asia","directions":{"north":"ocean","northeast":"ocean","east":"ocean","southeast":"Kamchatka","south":"ocean","southwest":"Irkutsk","west":"Siberia","northwest":"ocean"}},
    {"name":"Eastern Australia","borders":["Indonesia","New Guinea","Western Australia"],"continent":"Australia","directions":{"north":"New Guinea","northeast":"ocean","east":"ocean","southeast":"ocean","south":"ocean","southwest":"ocean","west":"Western Australia","northwest":"Indonesia"}},
    {"name":"Indonesia","borders":["Siam","New Guinea","Eastern Australia"],"continent":"Australia","directions":{"north":"ocean","northeast":"ocean","east":"New Guinea","southeast":"Eastern Australia","south":"ocean","southwest":"ocean","west":"ocean","northwest":"Siam"}},
    {"name":"New Guinea","borders":["Indonesia","Western Australia","Eastern Australia"],"continent":"Australia","directions":{"north":"ocean","northeast":"ocean","east":"ocean","southeast":"ocean","south":"Eastern Australia","southwest":"Western Australia","west":"Indonesia","northwest":"ocean"}},
    {"name":"Western Australia","borders":["New Guinea","Eastern Australia"],"continent":"Australia","directions":{"north":"ocean","northeast":"New Guinea","east":"Eastern Australia","southeast":"ocean","south":"ocean","southwest":"ocean","west":"ocean","northwest":"ocean"}}
  ];

  const CARD_TYPES = {
    "Alaska":"Infantry","Alberta":"Cavalry","Central America":"Artillery","Eastern US":"Artillery",
    "Greenland":"Cavalry","Northwest Territory":"Artillery","Ontario":"Cavalry","Eastern Canada":"Cavalry",
    "Western US":"Artillery","Argentina":"Infantry","Brazil":"Artillery","Peru":"Infantry","Venezuela":"Infantry",
    "Great Britain":"Artillery","Iceland":"Infantry","Northern Europe":"Artillery","Scandinavia":"Cavalry",
    "Southern Europe":"Artillery","Russia":"Cavalry","Western Europe":"Artillery","Central Africa":"Infantry",
    "East Africa":"Infantry","Egypt":"Infantry","Madagascar":"Cavalry","North Africa":"Cavalry",
    "South Africa":"Artillery","Afghanistan":"Cavalry","China":"Infantry","India":"Cavalry","Irkutsk":"Cavalry",
    "Japan":"Artillery","Kamchatka":"Infantry","Middle East":"Infantry","Mongolia":"Infantry","Siam":"Infantry",
    "Siberia":"Cavalry","Ural":"Cavalry","Yakutsk":"Cavalry","Eastern Australia":"Artillery",
    "Indonesia":"Artillery","New Guinea":"Infantry","Western Australia":"Artillery"
  };

  const CONTINENTS = {
    "North America": { count: 9, bonus: 5 },
    "South America": { count: 4, bonus: 2 },
    "Europe": { count: 7, bonus: 5 },
    "Africa": { count: 6, bonus: 3 },
    "Asia": { count: 12, bonus: 7 },
    "Australia": { count: 4, bonus: 2 }
  };

  const PLAYER_COLORS = [
    { hex: '#e94560', name: 'Red' },
    { hex: '#4ecca3', name: 'Green' },
    { hex: '#3498db', name: 'Blue' },
    { hex: '#f39c12', name: 'Orange' },
    { hex: '#9b59b6', name: 'Purple' },
    { hex: '#1abc9c', name: 'Teal' }
  ];

  const STARTING_ARMIES = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };
  const TRADE_VALUES = [4, 6, 8, 10, 12, 15];
  const NAV_KEYS = { 'u':'northwest','i':'north','o':'northeast','j':'west','l':'east','n':'southwest','m':'south',',':'southeast' };

  function findTerritory(name) { return TERRITORIES.find(t => t.name === name); }

  window.RiskData = {
    TERRITORIES,
    CARD_TYPES,
    CONTINENTS,
    PLAYER_COLORS,
    STARTING_ARMIES,
    TRADE_VALUES,
    NAV_KEYS,
    findTerritory
  };
})();

(() => {
  const { TERRITORIES, CARD_TYPES, CONTINENTS, TRADE_VALUES, findTerritory } = window.RiskData;

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
    stats: {}
  };

  const gameLog = [];

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
    G.stats = {};
    gameLog.length = 0;
  }

  function initTerritories() {
    G.territories = {};
    for (const t of TERRITORIES) {
      G.territories[t.name] = { owner: null, troops: 0 };
    }
  }

  function initDeck() {
    G.deck = [];
    for (const name in CARD_TYPES) {
      G.deck.push({ territory: name, type: CARD_TYPES[name] });
    }
    G.deck.push({ territory: null, type: 'Wild' });
    G.deck.push({ territory: null, type: 'Wild' });
    shuffleDeck();
  }

  function shuffleDeck() {
    for (let i = G.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [G.deck[i], G.deck[j]] = [G.deck[j], G.deck[i]];
    }
  }

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

  function log(msg, important = false, victory = false) {
    gameLog.push({
      turn: G.turnNumber,
      time: new Date().toLocaleTimeString(),
      player: G.players[G.currentPlayer]?.name || 'System',
      phase: G.phase, msg, important, victory
    });

    const el = document.getElementById('message-log');
    if (el) {
      const p = document.createElement('p');
      p.textContent = msg;
      if (important) p.classList.add('important');
      if (victory) p.classList.add('victory');
      el.insertBefore(p, el.firstChild);
      while (el.children.length > 100) el.removeChild(el.lastChild);
    }
  }

  function getTradeValue() {
    if (G.tradeCount < TRADE_VALUES.length) return TRADE_VALUES[G.tradeCount];
    return TRADE_VALUES[TRADE_VALUES.length - 1] + (G.tradeCount - TRADE_VALUES.length + 1) * 5;
  }

  function getPlayerTerritories(playerId) {
    return TERRITORIES.filter(t => G.territories[t.name].owner === playerId);
  }

  function getEnemyNeighbors(name, playerId) {
    const t = findTerritory(name);
    if (!t) return [];
    return t.borders
      .filter(b => G.territories[b]?.owner !== null && G.territories[b]?.owner !== playerId)
      .map(b => ({ name: b, troops: G.territories[b].troops, owner: G.territories[b].owner }));
  }

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

  function controlsContinent(playerId, continent) {
    const contT = TERRITORIES.filter(t => t.continent === continent);
    return contT.every(t => G.territories[t.name].owner === playerId);
  }

  function getControlledContinents(playerId) {
    return Object.keys(CONTINENTS).filter(c => controlsContinent(playerId, c));
  }

  function calcReinforcements(playerId) {
    const owned = Object.values(G.territories).filter(t => t.owner === playerId).length;
    let armies = Math.max(3, Math.floor(owned / 3));
    for (const c in CONTINENTS) {
      if (controlsContinent(playerId, c)) armies += CONTINENTS[c].bonus;
    }
    return armies;
  }

  function updatePeakStats() {
    for (const p of G.players) {
      const territories = getPlayerTerritories(p.id);
      const troops = territories.reduce((sum, t) => sum + G.territories[t.name].troops, 0);
      if (territories.length > G.stats.peakTerritories[p.id]) G.stats.peakTerritories[p.id] = territories.length;
      if (troops > G.stats.peakTroops[p.id]) G.stats.peakTroops[p.id] = troops;
    }
  }

  function currentTerritory() { return TERRITORIES[G.currentTerritoryIdx]; }
  function currentPlayer() { return G.players[G.currentPlayer]; }
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

(() => {
  let synth = null;
  let voices = [];
  let voiceName = null;
  let rate = 1.2;
  let enabled = true;
  let lastText = '';

  function init() {
    if (!window.speechSynthesis) return false;
    synth = window.speechSynthesis;
    loadVoices();
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 100);
    setTimeout(loadVoices, 500);
    setInterval(checkHealth, 5000);
    return true;
  }

  function loadVoices() {
    if (!synth) return;
    const raw = synth.getVoices();
    if (raw.length === 0) return;
    voices = [...raw].sort((a, b) => {
      const aLang = a.lang.toLowerCase(), bLang = b.lang.toLowerCase();
      const aUSUK = aLang === 'en-us' || aLang === 'en-gb';
      const bUSUK = bLang === 'en-us' || bLang === 'en-gb';
      if (aUSUK && !bUSUK) return -1;
      if (!aUSUK && bUSUK) return 1;
      const aEn = aLang.startsWith('en'), bEn = bLang.startsWith('en');
      if (aEn && !bEn) return -1;
      if (!aEn && bEn) return 1;
      if (a.localService && !b.localService) return -1;
      if (!a.localService && b.localService) return 1;
      return a.name.localeCompare(b.name);
    });
    populateSelectors();
    if (!voiceName && voices.length > 0) voiceName = voices[0].name;
  }

  function populateSelectors() {
    for (const id of ['voice-select', 'game-voice-select']) {
      const sel = document.getElementById(id);
      if (!sel) continue;
      sel.innerHTML = '';
      for (const v of voices) {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = `${v.name} (${v.lang})`;
        if (v.name === voiceName) opt.selected = true;
        sel.appendChild(opt);
      }
    }
  }

  function getVoice(name) {
    return voices.find(v => v.name === name) || voices[0] || null;
  }

  function checkHealth() {
    if (synth?.paused) synth.resume();
  }

  function speak(text, interrupt = true) {
    if (!enabled || !text) return;
    lastText = text;

    const region = document.getElementById('live-region');
    if (region) { region.textContent = ''; setTimeout(() => { region.textContent = text; }, 50); }

    if (!synth) return;
    if (interrupt) try { synth.cancel(); } catch (e) {}

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getVoice(voiceName);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      setTimeout(() => { synth.cancel(); loadVoices(); }, 100);
    };

    try {
      synth.speak(utterance);
      if (synth.paused) synth.resume();
    } catch (e) {}
  }

  function repeat() { if (lastText) speak(lastText); }

  function setVoice(name) {
    if (name && voices.some(v => v.name === name)) {
      voiceName = name;
      for (const id of ['voice-select', 'game-voice-select']) {
        const sel = document.getElementById(id);
        if (sel) sel.value = name;
      }
    }
  }

  function updateVoiceFromUI(selectId) {
    const sel = document.getElementById(selectId);
    if (sel?.value) setVoice(sel.value);
  }

  function setRate(r) {
    rate = Math.max(0.5, Math.min(4, r));
    const display = document.getElementById('game-rate-value');
    if (display) display.textContent = rate.toFixed(1);
  }

  function toggle() {
    enabled = !enabled;
    const btn = document.getElementById('toggle-speech-btn');
    if (btn) btn.textContent = enabled ? 'Mute' : 'Unmute';
    if (enabled) speak('Speech enabled');
    return enabled;
  }

  function isEnabled() { return enabled; }
  function getRate() { return rate; }
  function getVoiceName() { return voiceName; }
  function getSettings() { return { voiceName, rate, enabled }; }
  function restoreSettings(s) {
    if (!s) return;
    if (s.voiceName) { voiceName = s.voiceName; populateSelectors(); }
    if (s.rate) setRate(s.rate);
    if (s.enabled !== undefined) enabled = s.enabled;
  }

  window.RiskSpeech = {
    init,
    speak,
    repeat,
    setVoice,
    updateVoiceFromUI,
    setRate,
    toggle,
    isEnabled,
    getRate,
    getVoiceName,
    getSettings,
    restoreSettings
  };
})();

(() => {
  let ctx = null;
  let enabled = true;

  function init() {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      return true;
    } catch (e) {
      enabled = false;
      return false;
    }
  }

  function resume() { if (ctx?.state === 'suspended') ctx.resume(); }

  function tone(freq, type, duration, gain = 0.1, delay = 0) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = type;
    gainNode.gain.value = gain;
    const start = ctx.currentTime + delay;
    osc.start(start);
    osc.stop(start + duration);
    return { osc, gainNode };
  }

  function play(type) {
    if (!enabled || !ctx) return;
    try {
      resume();
      switch (type) {
        case 'move': tone(440, 'sine', 0.05, 0.08); break;
        case 'select': tone(660, 'sine', 0.1, 0.12); break;
        case 'attack':
          const a = tone(220, 'sawtooth', 0.3, 0.08);
          if (a) a.gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
          break;
        case 'victory': [523, 659, 784, 1047].forEach((f, i) => tone(f, 'sine', 0.2, 0.12, i * 0.12)); break;
        case 'defeat': [523, 440, 349, 262].forEach((f, i) => tone(f, 'sine', 0.2, 0.08, i * 0.15)); break;
        case 'continent': [392, 494, 587, 784].forEach((f, i) => tone(f, 'triangle', 0.25, 0.15, i * 0.1)); break;
        case 'elimination': [587, 494, 392, 294, 196].forEach((f, i) => tone(f, 'sawtooth', 0.2, 0.06, i * 0.12)); break;
        case 'card': tone(880, 'sine', 0.15, 0.1); break;
        case 'error': tone(200, 'square', 0.12, 0.08); break;
        case 'turn':
          const t = tone(550, 'sine', 0.15, 0.1);
          if (t) t.osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.1);
          break;
        case 'dice': for (let i = 0; i < 5; i++) tone(300 + Math.random() * 200, 'square', 0.05, 0.05, i * 0.06); break;
        case 'place': tone(500, 'sine', 0.08, 0.1); break;
        case 'fortify': tone(400, 'sine', 0.1, 0.08); setTimeout(() => tone(500, 'sine', 0.1, 0.08), 100); break;
        case 'gameWin': [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 'triangle', 0.4, 0.1, i * 0.15)); break;
        case 'gameLose': [523, 392, 330, 262, 196].forEach((f, i) => tone(f, 'sawtooth', 0.3, 0.08, i * 0.2)); break;
      }
    } catch (e) {}
  }

  function toggle() {
    enabled = !enabled;
    const btn = document.getElementById('toggle-sound-btn');
    if (btn) btn.textContent = enabled ? 'Sound Off' : 'Sound On';
    return enabled;
  }

  function setEnabled(val) {
    enabled = val;
    const btn = document.getElementById('toggle-sound-btn');
    if (btn) btn.textContent = enabled ? 'Sound Off' : 'Sound On';
  }

  function isEnabled() { return enabled; }
  function getSettings() { return { enabled }; }
  function restoreSettings(s) { if (s?.enabled !== undefined) setEnabled(s.enabled); }

  window.RiskSounds = { init, play, toggle, setEnabled, isEnabled, getSettings, restoreSettings };
})();

(() => {
  const { TERRITORIES, CONTINENTS } = window.RiskData;
  const { G, gameLog, getPlayerTerritories, getEnemyNeighbors, getControlledContinents, currentTerritory, currentPlayer, areConnected } = window.RiskState;
  const speech = window.RiskSpeech;
  const sounds = window.RiskSounds;

  let quickJumpActive = false, troopInputActive = false, diceActive = false, reportActive = false;
  let troopCallback = null, diceCallback = null;

  function isQuickJumpActive() { return quickJumpActive; }
  function isTroopInputActive() { return troopInputActive; }
  function isDiceActive() { return diceActive; }
  function isReportActive() { return reportActive; }

  function updateUI() {
    updateTurnInfo(); updatePlayerList(); updateTerritoryDisplay(); updatePhaseActions(); updateContinentBonuses(); updateTimer();
  }

  function updateTurnInfo() {
    const player = currentPlayer();
    if (!player) return;
    const turnEl = document.getElementById('turn-number'), phaseEl = document.getElementById('current-phase'), playerEl = document.getElementById('current-player-name'), armiesEl = document.getElementById('armies-to-place');
    if (turnEl) turnEl.textContent = G.turnNumber;
    if (phaseEl) phaseEl.textContent = G.phase;
    if (playerEl) { playerEl.textContent = player.name; playerEl.style.color = player.color; }
    if (armiesEl) {
      if (G.phase === 'reinforce' && G.armiesToPlace > 0) { armiesEl.textContent = `${G.armiesToPlace} armies to place`; armiesEl.classList.remove('hidden'); }
      else if (G.phase === 'setup-reinforce') { armiesEl.textContent = `${G.setupArmies[player.id] || 0} armies remaining`; armiesEl.classList.remove('hidden'); }
      else armiesEl.classList.add('hidden');
    }
  }

  function updatePlayerList() {
    const list = document.getElementById('player-list');
    if (!list) return;
    list.innerHTML = '';
    for (const player of G.players) {
      const territories = getPlayerTerritories(player.id);
      const troops = territories.reduce((sum, t) => sum + G.territories[t.name].troops, 0);
      const li = document.createElement('li');
      li.innerHTML = `<span class="player-indicator" style="background:${player.color}"></span><span>${player.name}${player.isHuman ? '' : ` (${player.strategy})`}</span><span style="margin-left:auto">${territories.length}T/${troops}A</span>`;
      if (player.id === G.currentPlayer) li.classList.add('current');
      if (player.eliminated) li.classList.add('eliminated');
      list.appendChild(li);
    }
  }

  function updateTerritoryDisplay() {
    const t = currentTerritory();
    if (!t) return;
    const ter = G.territories[t.name];
    const owner = ter.owner !== null ? G.players[ter.owner] : null;
    const nameEl = document.getElementById('territory-name'), infoEl = document.getElementById('territory-info'), sourceEl = document.getElementById('source-indicator');
    if (nameEl) nameEl.textContent = t.name;
    if (infoEl) { infoEl.textContent = `${t.continent} | ${owner ? `${owner.colorName}: ${ter.troops} troops` : 'Unclaimed'}`; infoEl.style.color = owner ? owner.color : '#999'; }
    if (sourceEl) {
      if (G.attackFrom) { sourceEl.textContent = `Attacking from: ${G.attackFrom}`; sourceEl.classList.remove('hidden'); }
      else if (G.fortifyFrom) { sourceEl.textContent = `Moving from: ${G.fortifyFrom}`; sourceEl.classList.remove('hidden'); }
      else sourceEl.classList.add('hidden');
    }
    updateCompass(t);
  }

  function updateCompass(territory) {
    const dirs = ['northwest', 'north', 'northeast', 'west', 'east', 'southwest', 'south', 'southeast'];
    const keys = ['u', 'i', 'o', 'j', 'l', 'n', 'm', ','];
    dirs.forEach((dir, i) => {
      const btn = document.getElementById(`nav-${dir}`);
      if (!btn) return;
      const target = territory.directions[dir];
      if (target && target !== 'ocean') {
        const targetTer = G.territories[target];
        const owner = targetTer?.owner !== null ? G.players[targetTer.owner] : null;
        btn.innerHTML = `<span>${keys[i].toUpperCase()}</span>${target}`;
        btn.disabled = false;
        btn.style.borderColor = owner ? owner.color : '#666';
      } else { btn.innerHTML = `<span>${keys[i].toUpperCase()}</span>Ocean`; btn.disabled = true; btn.style.borderColor = '#333'; }
    });
  }

  function updatePhaseActions() {
    const el = document.getElementById('phase-actions');
    if (!el) return;
    el.innerHTML = '';
    const player = currentPlayer();
    if (!player?.isHuman && !G.spectatorMode) return;
    const btns = {
      'claim': '<button onclick="game.claimTerritory()">Claim (Space)</button>',
      'setup-reinforce': '<button onclick="game.placeArmy()">Place Army (Space)</button>',
      'reinforce': '<button onclick="game.placeArmy()">Place 1 (Space)</button><button onclick="game.placeAllArmies()">Place All (A)</button><button onclick="game.tradeCards()">Trade (T)</button><button onclick="game.endReinforce()">End (E)</button>',
      'attack': '<button onclick="game.selectAttackSource()">Select (Space)</button><button onclick="game.executeAttack()">Attack (Enter)</button><button onclick="game.cancelAttack()">Cancel (X)</button><button onclick="game.endAttack()">End (E)</button>',
      'fortify': '<button onclick="game.selectFortifySource()">Select (Space)</button><button onclick="game.executeFortify()">Move (Enter)</button><button onclick="game.cancelFortify()">Cancel (X)</button><button onclick="game.endTurn()">End (E)</button>'
    };
    el.innerHTML = btns[G.phase] || '';
  }

  function updateContinentBonuses() {
    const el = document.getElementById('continent-bonuses');
    if (!el) return;
    el.innerHTML = '';
    const player = G.humanPlayerId >= 0 ? G.players[G.humanPlayerId] : null;
    for (const c in CONTINENTS) {
      const contT = TERRITORIES.filter(t => t.continent === c);
      const owned = player ? contT.filter(t => G.territories[t.name].owner === player.id).length : 0;
      const div = document.createElement('div');
      div.className = 'continent-bonus' + (owned === contT.length ? ' controlled' : '');
      div.innerHTML = `<span>${c}</span><span>${owned}/${contT.length} (+${CONTINENTS[c].bonus})</span>`;
      el.appendChild(div);
    }
  }

  function updateTimer() {
    const el = document.getElementById('game-timer');
    if (!el || !G.startTime) return;
    const elapsed = Math.floor((Date.now() - G.startTime) / 1000);
    el.textContent = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;
  }

  function showQuickJump() {
    quickJumpActive = true;
    document.getElementById('quick-jump-overlay').classList.remove('hidden');
    const input = document.getElementById('quick-jump-input');
    input.value = ''; input.focus();
    updateQuickJumpMatches('');
  }

  function hideQuickJump() {
    quickJumpActive = false;
    document.getElementById('quick-jump-overlay').classList.add('hidden');
    document.getElementById('current-territory')?.focus();
  }

  function updateQuickJumpMatches(query) {
    const container = document.getElementById('quick-jump-matches');
    container.innerHTML = '';
    const matches = TERRITORIES.filter(t => t.name.toLowerCase().includes(query.toLowerCase())).slice(0, 10);
    for (const t of matches) {
      const ter = G.territories[t.name];
      const owner = ter.owner !== null ? G.players[ter.owner] : null;
      const div = document.createElement('div');
      div.className = 'quick-jump-match';
      div.textContent = `${t.name} (${t.continent}) - ${owner ? `${owner.colorName}, ${ter.troops}` : 'Unclaimed'}`;
      div.style.borderLeft = `4px solid ${owner ? owner.color : '#666'}`;
      div.onclick = () => { G.currentTerritoryIdx = TERRITORIES.findIndex(x => x.name === t.name); hideQuickJump(); updateUI(); announceTerritory(); };
      container.appendChild(div);
    }
  }

  function showTroopInput(title, desc, min, max, callback) {
    troopInputActive = true; troopCallback = callback;
    document.getElementById('troop-input-title').textContent = title;
    document.getElementById('troop-input-desc').textContent = desc;
    document.getElementById('troop-min').textContent = min;
    document.getElementById('troop-max').textContent = max;
    const input = document.getElementById('troop-input');
    input.min = min; input.max = max; input.value = min;
    document.getElementById('troop-input-overlay').classList.remove('hidden');
    input.focus(); input.select();
    speech.speak(`${title}. ${desc}. Min ${min}, max ${max}.`);
  }

  function confirmTroopInput() {
    const input = document.getElementById('troop-input');
    const value = parseInt(input.value), min = parseInt(input.min), max = parseInt(input.max);
    if (value >= min && value <= max) {
      document.getElementById('troop-input-overlay').classList.add('hidden');
      troopInputActive = false;
      if (troopCallback) { troopCallback(value); troopCallback = null; }
    } else { sounds.play('error'); speech.speak(`Enter between ${min} and ${max}.`); }
  }

  function cancelTroopInput() {
    document.getElementById('troop-input-overlay').classList.add('hidden');
    troopInputActive = false; troopCallback = null;
    speech.speak('Cancelled.');
  }

  function showDiceResult(result, callback) {
    diceActive = true; diceCallback = callback;
    let html = '<div class="dice-group"><h4>Attack</h4>';
    result.attackRolls.forEach((roll, i) => {
      const win = i < result.defendRolls.length && roll > result.defendRolls[i];
      const lose = i < result.defendRolls.length && roll <= result.defendRolls[i];
      html += `<span class="dice attack ${win ? 'winner' : ''} ${lose ? 'loser' : ''}">${roll}</span>`;
    });
    html += '</div><div class="dice-group"><h4>Defend</h4>';
    result.defendRolls.forEach((roll, i) => {
      const win = roll >= result.attackRolls[i], lose = roll < result.attackRolls[i];
      html += `<span class="dice defend ${win ? 'winner' : ''} ${lose ? 'loser' : ''}">${roll}</span>`;
    });
    html += '</div>';
    document.getElementById('dice-result').innerHTML = html;
    document.getElementById('dice-outcome').textContent = `Attacker: -${result.attackerLosses} | Defender: -${result.defenderLosses}`;
    document.getElementById('dice-overlay').classList.remove('hidden');
    speech.speak(`Attack: ${result.attackRolls.join(', ')}. Defense: ${result.defendRolls.join(', ')}.`);
  }

  function closeDiceOverlay() {
    diceActive = false;
    document.getElementById('dice-overlay').classList.add('hidden');
    if (diceCallback) { diceCallback(); diceCallback = null; }
  }

  function showAfterActionReport(winnerId) {
    reportActive = true;
    const winner = G.players[winnerId];
    const elapsed = Math.floor((G.endTime - G.startTime) / 1000);
    let html = `<div class="report-section"><h3>Winner: ${winner.name}</h3><div class="stat-row"><span>Turns</span><span>${G.turnNumber}</span></div><div class="stat-row"><span>Duration</span><span>${Math.floor(elapsed / 60)}m ${elapsed % 60}s</span></div></div>`;
    for (const p of G.players) {
      html += `<div class="report-section"><h3 style="color:${p.color}">${p.id === winnerId ? 'Winner: ' : ''}${p.name}</h3>
        <div class="stat-row"><span>Conquered</span><span>${G.stats.conquered[p.id] || 0}</span></div>
        <div class="stat-row"><span>Lost</span><span>${G.stats.lost[p.id] || 0}</span></div>
        <div class="stat-row"><span>Battles Won</span><span>${G.stats.won[p.id] || 0}</span></div>
        <div class="stat-row"><span>Battles Lost</span><span>${G.stats.failed[p.id] || 0}</span></div>
        <div class="stat-row"><span>Troops Placed</span><span>${G.stats.troopsPlaced[p.id] || 0}</span></div>
        <div class="stat-row"><span>Peak Territories</span><span>${G.stats.peakTerritories[p.id] || 0}</span></div>
        ${G.stats.eliminated[p.id] ? `<div class="stat-row"><span>Eliminated Turn</span><span>${G.stats.eliminated[p.id]}</span></div>` : ''}</div>`;
    }
    document.getElementById('report-title').textContent = `Game Over - ${winner.name} Wins!`;
    document.getElementById('report-content').innerHTML = html;
    document.getElementById('report-overlay').classList.remove('hidden');
  }

  function hideReport() { reportActive = false; document.getElementById('report-overlay').classList.add('hidden'); }
  function showHelp() { document.getElementById('help-overlay').classList.remove('hidden'); }
  function hideHelp() { document.getElementById('help-overlay').classList.add('hidden'); }

  function announceTerritory() {
    const t = currentTerritory();
    if (!t) return;
    const ter = G.territories[t.name];
    const owner = ter.owner !== null ? G.players[ter.owner] : null;
    let ann = `${t.name}, ${t.continent}. ${owner ? `${owner.colorName}, ${ter.troops} troops.` : 'Unclaimed.'}`;
    const dirs = [];
    for (const dir of ['north', 'east', 'south', 'west']) {
      const target = t.directions[dir];
      if (target && target !== 'ocean') dirs.push(`${target} to the ${dir}`);
    }
    if (dirs.length > 0) ann += ` ${dirs.join(', ')}.`;
    speech.speak(ann);
  }

  function announcePlayerStatus(idx) {
    if (idx < 0 || idx >= G.players.length) { speech.speak('Invalid player.'); return; }
    const p = G.players[idx];
    const territories = getPlayerTerritories(p.id);
    const troops = territories.reduce((sum, t) => sum + G.territories[t.name].troops, 0);
    if (p.eliminated) { speech.speak(`${p.name}, ${p.colorName}, eliminated.`); return; }
    let ann = `${p.name}, ${p.colorName}. ${territories.length} territories, ${troops} troops.`;
    const controlled = getControlledContinents(p.id);
    if (controlled.length > 0) ann += ` Controls: ${controlled.join(', ')}.`;
    speech.speak(ann);
  }

  function listUnclaimed() {
    const unclaimed = TERRITORIES.filter(t => G.territories[t.name].owner === null);
    if (unclaimed.length === 0) { speech.speak('All claimed.'); return; }
    const byC = {};
    for (const t of unclaimed) { if (!byC[t.continent]) byC[t.continent] = []; byC[t.continent].push(t.name); }
    let ann = `${unclaimed.length} unclaimed. `;
    for (const c in byC) ann += `${c}: ${byC[c].join(', ')}. `;
    speech.speak(ann);
  }

  function listCards() {
    if (G.humanPlayerId < 0) { speech.speak('Spectator mode.'); return; }
    const p = G.players[G.humanPlayerId];
    if (p.cards.length === 0) { speech.speak('No cards.'); return; }
    let ann = `${p.cards.length} cards. `;
    p.cards.forEach((c, i) => { ann += `${i + 1}: ${c.territory || 'Wild'}, ${c.type}. `; });
    speech.speak(ann);
  }

  function announcePhase() {
    const p = currentPlayer();
    let ann = `Turn ${G.turnNumber}. ${p.name}'s turn. Phase: ${G.phase}. `;
    if (G.phase === 'reinforce' && G.armiesToPlace > 0) ann += `${G.armiesToPlace} armies to place. `;
    if (G.attackFrom) ann += `Attacking from ${G.attackFrom}. `;
    if (G.fortifyFrom) ann += `Moving from ${G.fortifyFrom}. `;
    speech.speak(ann);
  }

  window.RiskUI = {
    isQuickJumpActive,
    isTroopInputActive,
    isDiceActive,
    isReportActive,
    updateUI,
    showQuickJump,
    hideQuickJump,
    updateQuickJumpMatches,
    showTroopInput,
    confirmTroopInput,
    cancelTroopInput,
    showDiceResult,
    closeDiceOverlay,
    showAfterActionReport,
    hideReport,
    showHelp,
    hideHelp,
    announceTerritory,
    announcePlayerStatus,
    listUnclaimed,
    listCards,
    announcePhase
  };
})();

(() => {
  const { CONTINENTS } = window.RiskData;

  function findContinentTarget(game, playerId) {
    let best = null, bestScore = -1;
    for (const c in CONTINENTS) {
      const all = game.allTerritories.filter(t => t.continent === c);
      const owned = all.filter(t => game.territories[t.name].owner === playerId);
      const missing = all.filter(t => game.territories[t.name].owner !== playerId);
      if (owned.length > 0 && missing.length > 0 && missing.length <= 4) {
        const score = (owned.length / all.length) * CONTINENTS[c].bonus * (5 - missing.length);
        if (score > bestScore) { bestScore = score; best = { continent: c, owned, missing }; }
      }
    }
    return best;
  }

  const STRATEGIES = {
    aggressive: {
      name: "Aggressive",
      placeArmies(game, player, armies) {
        const territories = game.getPlayerTerritories(player.id);
        let bestT = null, bestWeakness = Infinity;
        for (const t of territories) {
          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            if (e.troops < bestWeakness) { bestWeakness = e.troops; bestT = t; }
          }
        }
        return bestT ? [{ territory: bestT.name, amount: armies }] :
               territories.length > 0 ? [{ territory: territories[0].name, amount: armies }] : [];
      },
      attack(game, player) {
        const attacks = [];
        for (const t of game.getPlayerTerritories(player.id).sort((a, b) => game.territories[b.name].troops - game.territories[a.name].troops)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops <= 1) continue;
          for (const e of game.getEnemyNeighbors(t.name, player.id).sort((a, b) => a.troops - b.troops)) {
            if (myTroops >= 3 || myTroops > e.troops) attacks.push({ from: t.name, to: e.name, maxAttacks: 20 });
          }
        }
        return attacks.slice(0, 10);
      },
      fortify(game, player) {
        const territories = game.getPlayerTerritories(player.id);
        const interior = territories.filter(t => game.getEnemyNeighbors(t.name, player.id).length === 0 && game.territories[t.name].troops > 1).sort((a, b) => game.territories[b.name].troops - game.territories[a.name].troops);
        const borders = territories.filter(t => game.getEnemyNeighbors(t.name, player.id).length > 0).sort((a, b) => game.territories[a.name].troops - game.territories[b.name].troops);
        for (const from of interior) {
          for (const to of borders) {
            if (game.areConnected(from.name, to.name, player.id)) return { from: from.name, to: to.name, amount: game.territories[from.name].troops - 1 };
          }
        }
        return null;
      }
    },

    defensive: {
      name: "Defensive",
      placeArmies(game, player, armies) {
        const territories = game.getPlayerTerritories(player.id);
        const threats = territories.map(t => {
          const maxThreat = game.getEnemyNeighbors(t.name, player.id).reduce((max, e) => Math.max(max, e.troops), 0);
          return { territory: t, deficit: maxThreat - game.territories[t.name].troops };
        }).filter(t => t.deficit > -5).sort((a, b) => b.deficit - a.deficit);
        if (threats.length > 0) {
          const placements = []; let remaining = armies;
          for (const t of threats.slice(0, 3)) {
            if (remaining <= 0) break;
            const amt = Math.min(remaining, Math.max(1, t.deficit + 2));
            placements.push({ territory: t.territory.name, amount: amt });
            remaining -= amt;
          }
          if (remaining > 0 && placements.length > 0) placements[0].amount += remaining;
          return placements;
        }
        return territories.length > 0 ? [{ territory: territories[0].name, amount: armies }] : [];
      },
      attack(game, player) {
        const attacks = [];
        for (const t of game.getPlayerTerritories(player.id)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops <= 3) continue;
          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            if (myTroops >= e.troops * 2) attacks.push({ from: t.name, to: e.name, maxAttacks: 8 });
          }
        }
        return attacks.slice(0, 4);
      },
      fortify(game, player) {
        const territories = game.getPlayerTerritories(player.id);
        const borders = territories.filter(t => game.getEnemyNeighbors(t.name, player.id).length > 0).sort((a, b) => game.territories[a.name].troops - game.territories[b.name].troops);
        if (borders.length === 0) return null;
        const sources = territories.filter(t => t.name !== borders[0].name && game.territories[t.name].troops > 2 && game.areConnected(t.name, borders[0].name, player.id)).sort((a, b) => game.territories[b.name].troops - game.territories[a.name].troops);
        if (sources.length > 0) {
          const amt = Math.floor(game.territories[sources[0].name].troops / 2);
          if (amt > 0) return { from: sources[0].name, to: borders[0].name, amount: amt };
        }
        return null;
      }
    },

    continental: {
      name: "Continental",
      placeArmies(game, player, armies) {
        const target = findContinentTarget(game, player.id);
        if (target) {
          for (const owned of target.owned) {
            const tData = game.allTerritories.find(t => t.name === owned.name);
            if (tData) for (const m of target.missing) if (tData.borders.includes(m.name)) return [{ territory: owned.name, amount: armies }];
          }
        }
        return STRATEGIES.defensive.placeArmies(game, player, armies);
      },
      attack(game, player) {
        const attacks = [], target = findContinentTarget(game, player.id);
        if (target) {
          for (const t of game.getPlayerTerritories(player.id)) {
            const myTroops = game.territories[t.name].troops;
            if (myTroops <= 1) continue;
            const tData = game.allTerritories.find(x => x.name === t.name);
            if (tData) for (const m of target.missing) if (tData.borders.includes(m.name)) attacks.push({ from: t.name, to: m.name, maxAttacks: 15 });
          }
        }
        if (attacks.length < 3) attacks.push(...STRATEGIES.aggressive.attack(game, player).slice(0, 3));
        return attacks.slice(0, 8);
      },
      fortify(game, player) { return STRATEGIES.defensive.fortify(game, player); }
    },

    opportunist: {
      name: "Opportunist",
      placeArmies(game, player, armies) {
        const territories = game.getPlayerTerritories(player.id);
        let best = null, bestRatio = 0;
        for (const t of territories) {
          const myTroops = game.territories[t.name].troops + armies;
          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            const ratio = myTroops / (e.troops + 1);
            if (ratio > bestRatio) { bestRatio = ratio; best = t; }
          }
        }
        return best && bestRatio > 1.5 ? [{ territory: best.name, amount: armies }] : STRATEGIES.defensive.placeArmies(game, player, armies);
      },
      attack(game, player) {
        const attacks = [];
        for (const t of game.getPlayerTerritories(player.id)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops <= 1) continue;
          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            const ratio = myTroops / (e.troops + 1);
            if (ratio >= 1.5 || (myTroops >= 4 && e.troops <= 2)) attacks.push({ from: t.name, to: e.name, ratio, maxAttacks: 15 });
          }
        }
        return attacks.sort((a, b) => (b.ratio || 0) - (a.ratio || 0)).slice(0, 8);
      },
      fortify(game, player) { return STRATEGIES.defensive.fortify(game, player); }
    },

    eliminator: {
      name: "Eliminator",
      placeArmies(game, player, armies) {
        const territories = game.getPlayerTerritories(player.id);
        const weak = game.players.filter(p => !p.eliminated && p.id !== player.id && game.getPlayerTerritories(p.id).length <= 3);
        if (weak.length > 0) {
          for (const t of territories) {
            for (const e of game.getEnemyNeighbors(t.name, player.id)) {
              if (weak.some(w => w.id === e.owner)) return [{ territory: t.name, amount: armies }];
            }
          }
        }
        return STRATEGIES.aggressive.placeArmies(game, player, armies);
      },
      attack(game, player) {
        const attacks = [], counts = {};
        for (const p of game.players) if (!p.eliminated) counts[p.id] = game.getPlayerTerritories(p.id).length;
        for (const t of game.getPlayerTerritories(player.id)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops <= 1) continue;
          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            const priority = (counts[e.owner] || 99) <= 3 ? 100 - (counts[e.owner] || 99) : 0;
            attacks.push({ from: t.name, to: e.name, priority, maxAttacks: 20 });
          }
        }
        return attacks.sort((a, b) => (b.priority || 0) - (a.priority || 0)).slice(0, 10);
      },
      fortify(game, player) { return STRATEGIES.aggressive.fortify(game, player); }
    },

    turtle: {
      name: "Turtle",
      placeArmies(game, player, armies) { return STRATEGIES.defensive.placeArmies(game, player, armies); },
      attack(game, player) {
        for (const t of game.getPlayerTerritories(player.id)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops < 4) continue;
          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            if (e.troops <= 2 && myTroops >= e.troops * 3) return [{ from: t.name, to: e.name, maxAttacks: 5 }];
          }
        }
        return [];
      },
      fortify(game, player) { return STRATEGIES.defensive.fortify(game, player); }
    },

    random: {
      name: "Random",
      placeArmies(game, player, armies) {
        const territories = game.getPlayerTerritories(player.id);
        if (territories.length === 0) return [];
        const placements = []; let remaining = armies;
        while (remaining > 0) {
          const t = territories[Math.floor(Math.random() * territories.length)];
          const amt = Math.min(remaining, Math.ceil(Math.random() * 4));
          placements.push({ territory: t.name, amount: amt });
          remaining -= amt;
        }
        return placements;
      },
      attack(game, player) {
        const attacks = [];
        for (const t of game.getPlayerTerritories(player.id)) {
          if (game.territories[t.name].troops <= 1) continue;
          const enemies = game.getEnemyNeighbors(t.name, player.id);
          if (enemies.length > 0) attacks.push({ from: t.name, to: enemies[Math.floor(Math.random() * enemies.length)].name, maxAttacks: 5 });
        }
        return attacks;
      },
      fortify(game, player) {
        const territories = game.getPlayerTerritories(player.id);
        if (territories.length < 2) return null;
        const from = territories.find(t => game.territories[t.name].troops > 1);
        const to = territories[Math.floor(Math.random() * territories.length)];
        if (!from || from.name === to.name || !game.areConnected(from.name, to.name, player.id)) return null;
        return { from: from.name, to: to.name, amount: 1 };
      }
    }
  };

  const STRATEGY_NAMES = Object.keys(STRATEGIES);

  window.RiskAI = { STRATEGIES, STRATEGY_NAMES };
})();

(() => {
  const { TERRITORIES, CONTINENTS, STARTING_ARMIES, PLAYER_COLORS, CARD_TYPES, findTerritory } = window.RiskData;
  const {
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
    currentPlayer
  } = window.RiskState;
  const { STRATEGIES, STRATEGY_NAMES } = window.RiskAI;
  const speech = window.RiskSpeech;
  const sounds = window.RiskSounds;

  let updateUI = () => {};
  let showReport = () => {};
  let showTroopInput = () => {};
  let showDiceResult = () => {};

  function setCallbacks(ui, report, troop, dice) {
    updateUI = ui; showReport = report; showTroopInput = troop; showDiceResult = dice;
  }

  function initPlayers(name, count, spectator = false) {
    G.players = [];
    G.spectatorMode = spectator;
    if (spectator) {
      for (let i = 0; i < count; i++) {
        const strategy = STRATEGY_NAMES[Math.floor(Math.random() * STRATEGY_NAMES.length)];
        G.players.push({ id: i, name: `${STRATEGIES[strategy].name} AI`, color: PLAYER_COLORS[i].hex, colorName: PLAYER_COLORS[i].name, isHuman: false, strategy, cards: [], eliminated: false });
      }
      G.humanPlayerId = -1;
    } else {
      G.players.push({ id: 0, name, color: PLAYER_COLORS[0].hex, colorName: PLAYER_COLORS[0].name, isHuman: true, cards: [], eliminated: false });
      for (let i = 1; i < count; i++) {
        const strategy = STRATEGY_NAMES[Math.floor(Math.random() * STRATEGY_NAMES.length)];
        G.players.push({ id: i, name: `${STRATEGIES[strategy].name} AI`, color: PLAYER_COLORS[i].hex, colorName: PLAYER_COLORS[i].name, isHuman: false, strategy, cards: [], eliminated: false });
      }
      G.humanPlayerId = 0;
    }
    const armies = STARTING_ARMIES[count] || 30;
    for (const p of G.players) G.setupArmies[p.id] = armies;
  }

  function randomAssignTerritories(empire = false) {
    const names = TERRITORIES.map(t => t.name);
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
    let idx = 0;
    for (const n of names) { G.territories[n].owner = idx % G.players.length; G.territories[n].troops = 1; G.setupArmies[idx % G.players.length]--; idx++; }
    log('Territories assigned randomly');
  }

  function randomPlaceTroops() {
    for (const player of G.players) {
      const owned = getPlayerTerritories(player.id);
      let remaining = G.setupArmies[player.id];
      while (remaining > 0 && owned.length > 0) {
        const t = owned[Math.floor(Math.random() * owned.length)];
        const amt = Math.min(remaining, Math.ceil(Math.random() * 3));
        G.territories[t.name].troops += amt;
        remaining -= amt;
      }
      G.setupArmies[player.id] = 0;
    }
    log('Troops placed randomly');
  }

  function startClaimPhase() {
    G.phase = 'claim'; G.currentPlayer = 0;
    const unclaimed = TERRITORIES.filter(t => G.territories[t.name].owner === null);
    if (unclaimed.length === 0) { startSetupReinforce(); return; }
    G.currentTerritoryIdx = TERRITORIES.findIndex(t => G.territories[t.name].owner === null);
    updateUI();
    speech.speak(`Claiming phase. ${currentPlayer().name}, select an unclaimed territory.`);
    if (!currentPlayer().isHuman) setTimeout(aiTurn, G.aiDelay);
  }

  function startSetupReinforce() {
    G.phase = 'setup-reinforce'; G.currentPlayer = 0;
    if (!Object.values(G.setupArmies).some(a => a > 0)) { startMainGame(); return; }
    while (G.setupArmies[G.currentPlayer] <= 0) G.currentPlayer = (G.currentPlayer + 1) % G.players.length;
    G.currentTerritoryIdx = TERRITORIES.findIndex(t => G.territories[t.name].owner === G.currentPlayer);
    updateUI();
    speech.speak(`Setup. ${currentPlayer().name}, place armies. ${G.setupArmies[currentPlayer().id]} remaining.`);
    if (!currentPlayer().isHuman) setTimeout(aiTurn, G.aiDelay);
  }

  function nextSetupPlayer() {
    let next = (G.currentPlayer + 1) % G.players.length, checked = 0;
    while (checked < G.players.length) { if (G.setupArmies[next] > 0) break; next = (next + 1) % G.players.length; checked++; }
    if (checked >= G.players.length) { startMainGame(); return; }
    G.currentPlayer = next;
    updateUI();
    if (!currentPlayer().isHuman) setTimeout(aiTurn, G.aiDelay / 2);
    else speech.speak(`Your turn. ${G.setupArmies[currentPlayer().id]} armies to place.`);
  }

  function startMainGame() {
    G.currentPlayer = 0; G.turnNumber = 1;
    log('Main game begins', true);
    startReinforcePhase();
  }

  function startReinforcePhase() {
    const player = currentPlayer();
    if (player.eliminated) { nextPlayer(); return; }
    G.phase = 'reinforce'; G.conqueredThisTurn = false; G.attackFrom = null; G.fortifyFrom = null;
    const armies = calcReinforcements(player.id);
    G.armiesToPlace = armies;
    G.stats.troopsPlaced[player.id] += armies;
    G.currentTerritoryIdx = TERRITORIES.findIndex(t => G.territories[t.name].owner === player.id);
    updateUI();
    sounds.play('turn');
    let ann = `${player.name}'s turn, Turn ${G.turnNumber}. Reinforcement. ${armies} armies.`;
    if (player.cards.length >= 5) {
      const set = findValidCardSet(player.cards);
      if (set) { const bonus = executeCardTrade(player, set); G.armiesToPlace += bonus; ann += ` Auto-traded for ${bonus} more.`; }
    }
    log(`${player.name} receives ${G.armiesToPlace} armies`);
    speech.speak(ann);
    if (!player.isHuman) setTimeout(aiTurn, G.aiDelay);
  }

  function startAttackPhase() {
    G.phase = 'attack'; G.attackFrom = null;
    const player = currentPlayer();
    const idx = TERRITORIES.findIndex(t => { const ter = G.territories[t.name]; return ter.owner === player.id && ter.troops > 1 && getEnemyNeighbors(t.name, player.id).length > 0; });
    if (idx >= 0) G.currentTerritoryIdx = idx;
    updateUI();
    speech.speak(`Attack phase. Select territory to attack from, or press E to fortify.`);
    if (!player.isHuman) setTimeout(aiTurn, G.aiDelay);
  }

  function startFortifyPhase() {
    G.phase = 'fortify'; G.fortifyFrom = null;
    updateUI();
    speech.speak(`Fortify phase. Select territory to move from, or press E to end turn.`);
    if (!currentPlayer().isHuman) setTimeout(aiTurn, G.aiDelay);
  }

  function nextPlayer() {
    awardCardIfEarned(currentPlayer().id);
    const winner = checkVictory();
    if (winner !== null) { endGame(winner); return; }
    updatePeakStats();
    do { G.currentPlayer = (G.currentPlayer + 1) % G.players.length; } while (G.players[G.currentPlayer].eliminated);
    const firstActive = G.players.findIndex(p => !p.eliminated);
    if (G.currentPlayer === firstActive) G.turnNumber++;
    startReinforcePhase();
  }

  function rollDice(count) {
    return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1).sort((a, b) => b - a);
  }

  function resolveBattle(fromName, toName) {
    const from = G.territories[fromName], to = G.territories[toName];
    const attackDice = Math.min(3, from.troops - 1), defendDice = Math.min(2, to.troops);
    const attackRolls = rollDice(attackDice), defendRolls = rollDice(defendDice);
    let attackerLosses = 0, defenderLosses = 0;
    for (let i = 0; i < Math.min(attackRolls.length, defendRolls.length); i++) {
      if (attackRolls[i] > defendRolls[i]) defenderLosses++; else attackerLosses++;
    }
    from.troops -= attackerLosses; to.troops -= defenderLosses;
    return { attackRolls, defendRolls, attackerLosses, defenderLosses, fromName, toName, conquered: to.troops === 0 };
  }

  function findValidCardSet(cards) {
    if (cards.length < 3) return null;
    const types = { Infantry: [], Cavalry: [], Artillery: [], Wild: [] };
    cards.forEach((c, i) => types[c.type].push(i));
    for (const t of ['Infantry', 'Cavalry', 'Artillery']) if (types[t].length >= 3) return types[t].slice(0, 3);
    if (types.Infantry.length >= 1 && types.Cavalry.length >= 1 && types.Artillery.length >= 1) return [types.Infantry[0], types.Cavalry[0], types.Artillery[0]];
    if (types.Wild.length > 0) {
      for (const t of ['Infantry', 'Cavalry', 'Artillery']) if (types[t].length >= 2) return [types[t][0], types[t][1], types.Wild[0]];
      const avail = ['Infantry', 'Cavalry', 'Artillery'].filter(t => types[t].length >= 1);
      if (avail.length >= 2) return [types[avail[0]][0], types[avail[1]][0], types.Wild[0]];
    }
    return null;
  }

  function executeCardTrade(player, indices) {
    const value = getTradeValue();
    const sorted = [...indices].sort((a, b) => b - a);
    const removed = sorted.map(i => player.cards.splice(i, 1)[0]);
    G.discardPile.push(...removed);
    G.tradeCount++;
    G.stats.cards[player.id]++;
    let bonus = 0;
    for (const card of removed) if (card.territory && G.territories[card.territory]?.owner === player.id) bonus += 2;
    log(`${player.name} trades cards for ${value + bonus} armies`);
    return value + bonus;
  }

  function awardCardIfEarned(playerId) {
    if (!G.conqueredThisTurn || G.deck.length === 0) return;
    const card = G.deck.pop();
    G.players[playerId].cards.push(card);
    sounds.play('card');
    log(`${G.players[playerId].name} earned a card`);
  }

  function checkVictory() {
    const counts = {};
    for (const p of G.players) counts[p.id] = 0;
    for (const name in G.territories) { const owner = G.territories[name].owner; if (owner !== null) counts[owner]++; }
    for (const id in counts) if (counts[id] === 42) return parseInt(id);
    for (const p of G.players) {
      if (counts[p.id] === 0 && !p.eliminated) {
        p.eliminated = true; G.stats.eliminated[p.id] = G.turnNumber;
        sounds.play('elimination'); speech.speak(`${p.name} eliminated!`); log(`${p.name} eliminated`, true);
      }
    }
    return null;
  }

  function checkContinentControl() {
    for (const player of G.players) {
      for (const c in CONTINENTS) {
        const controls = controlsContinent(player.id, c);
        const had = G.stats.continents[player.id]?.includes(c);
        if (controls && !had) {
          if (!G.stats.continents[player.id]) G.stats.continents[player.id] = [];
          G.stats.continents[player.id].push(c);
          sounds.play('continent'); speech.speak(`${player.name} controls ${c}!`); log(`${player.name} controls ${c}`, true, true);
        } else if (!controls && had) {
          G.stats.continents[player.id] = G.stats.continents[player.id].filter(x => x !== c);
          log(`${player.name} lost ${c}`);
        }
      }
    }
  }

  function endGame(winnerId) {
    const winner = G.players[winnerId];
    G.phase = 'gameover'; G.endTime = Date.now();
    sounds.play(winnerId === G.humanPlayerId ? 'gameWin' : 'gameLose');
    speech.speak(`Game over! ${winner.name} wins!`);
    log(`${winner.name} wins!`, true, true);
    updateUI();
    showReport(winnerId);
  }

  function aiTurn() {
    const player = currentPlayer();
    if (player.isHuman) return;
    const strategy = STRATEGIES[player.strategy];
    if (!strategy) return;
    switch (G.phase) {
      case 'claim': aiClaim(player); break;
      case 'setup-reinforce': aiSetupReinforce(player); break;
      case 'reinforce': aiReinforce(player, strategy); break;
      case 'attack': aiAttack(player, strategy); break;
      case 'fortify': aiFortify(player, strategy); break;
    }
  }

  function aiClaim(player) {
    const unclaimed = TERRITORIES.filter(t => G.territories[t.name].owner === null);
    if (unclaimed.length === 0) return;
    let choice = null;
    for (const c of ['Australia', 'South America', 'Africa', 'North America', 'Europe', 'Asia']) {
      const contT = TERRITORIES.filter(t => t.continent === c);
      const owned = contT.filter(t => G.territories[t.name].owner === player.id);
      const free = contT.filter(t => G.territories[t.name].owner === null);
      if (free.length > 0 && (owned.length > 0 || c === 'Australia')) { choice = free[0]; break; }
    }
    if (!choice) choice = unclaimed[Math.floor(Math.random() * unclaimed.length)];
    G.territories[choice.name].owner = player.id; G.territories[choice.name].troops = 1; G.setupArmies[player.id]--;
    log(`${player.name} claims ${choice.name}`);
    setTimeout(() => {
      G.currentPlayer = (G.currentPlayer + 1) % G.players.length;
      if (TERRITORIES.filter(t => G.territories[t.name].owner === null).length === 0) startSetupReinforce();
      else { updateUI(); if (!currentPlayer().isHuman) setTimeout(aiTurn, G.aiDelay / 2); }
    }, G.aiDelay / 2);
  }

  function aiSetupReinforce(player) {
    const owned = getPlayerTerritories(player.id);
    if (owned.length === 0 || G.setupArmies[player.id] <= 0) { nextSetupPlayer(); return; }
    const borders = owned.filter(t => getEnemyNeighbors(t.name, player.id).length > 0);
    const choice = borders.length > 0 ? borders[Math.floor(Math.random() * borders.length)] : owned[Math.floor(Math.random() * owned.length)];
    G.territories[choice.name].troops++; G.setupArmies[player.id]--;
    log(`${player.name} places 1 on ${choice.name} (${G.setupArmies[player.id]} left)`);
    setTimeout(nextSetupPlayer, G.aiDelay / 3);
  }

  function aiReinforce(player, strategy) {
    if (player.cards.length >= 3) {
      const set = findValidCardSet(player.cards);
      if (set && (player.cards.length >= 5 || getTradeValue() >= 8)) { G.armiesToPlace += executeCardTrade(player, set); }
    }
    const gameInterface = createGameInterface();
    const placements = strategy.placeArmies(gameInterface, player, G.armiesToPlace);
    for (const p of placements) { if (G.territories[p.territory]?.owner === player.id) { G.territories[p.territory].troops += p.amount; log(`${player.name} places ${p.amount} on ${p.territory}`); } }
    G.armiesToPlace = 0;
    updateUI();
    setTimeout(startAttackPhase, G.aiDelay);
  }

  function aiAttack(player, strategy) {
    const attacks = strategy.attack(createGameInterface(), player);
    if (attacks.length === 0) { setTimeout(startFortifyPhase, G.aiDelay / 2); return; }
    executeAiAttacks(player, attacks, 0);
  }

  function executeAiAttacks(player, attacks, index) {
    if (index >= attacks.length) { setTimeout(startFortifyPhase, G.aiDelay / 2); return; }
    const attack = attacks[index];
    const from = G.territories[attack.from], to = G.territories[attack.to];
    if (from.owner !== player.id || to.owner === player.id || from.troops <= 1) { executeAiAttacks(player, attacks, index + 1); return; }
    const defender = G.players[to.owner];
    log(`${player.name} attacks ${attack.to} from ${attack.from}`);
    G.stats.attacks[player.id]++;
    let attacksRemaining = attack.maxAttacks || 10;
    const doAttack = () => {
      if (attacksRemaining <= 0 || from.troops <= 1 || to.owner === player.id) { setTimeout(() => executeAiAttacks(player, attacks, index + 1), G.aiDelay / 3); return; }
      const result = resolveBattle(attack.from, attack.to);
      attacksRemaining--;
      log(`  [${result.attackRolls}] vs [${result.defendRolls}]: -${result.attackerLosses}/-${result.defenderLosses}`);
      if (result.defenderLosses > result.attackerLosses) { G.stats.won[player.id]++; if (defender && !defender.eliminated) G.stats.failed[defender.id]++; }
      else { G.stats.failed[player.id]++; if (defender && !defender.eliminated) G.stats.won[defender.id]++; }
      if (to.troops === 0) {
        G.conqueredThisTurn = true; G.stats.conquered[player.id]++;
        if (defender && !defender.eliminated) G.stats.lost[defender.id]++;
        G.stats.successfulAttacks[player.id]++;
        const oldOwner = to.owner; to.owner = player.id;
        const toMove = Math.min(from.troops - 1, 3); from.troops -= toMove; to.troops = toMove;
        log(`${player.name} conquers ${attack.to}!`, true);
        sounds.play('victory');
        checkContinentControl();
        const defT = Object.values(G.territories).filter(t => t.owner === oldOwner);
        if (defT.length === 0 && oldOwner !== null) {
          const defPlayer = G.players[oldOwner];
          defPlayer.eliminated = true; G.stats.eliminated[oldOwner] = G.turnNumber;
          if (defPlayer.cards.length > 0) { player.cards.push(...defPlayer.cards); defPlayer.cards = []; }
          sounds.play('elimination'); log(`${defPlayer.name} eliminated`, true);
        }
        if (checkVictory() !== null) { endGame(checkVictory()); return; }
        updateUI();
        setTimeout(() => executeAiAttacks(player, attacks, index + 1), G.aiDelay / 2);
      } else { updateUI(); setTimeout(doAttack, 150); }
    };
    sounds.play('attack');
    doAttack();
  }

  function aiFortify(player, strategy) {
    const fortify = strategy.fortify(createGameInterface(), player);
    if (fortify?.amount > 0) {
      const from = G.territories[fortify.from], to = G.territories[fortify.to];
      if (from?.owner === player.id && to?.owner === player.id && from.troops > fortify.amount) {
        from.troops -= fortify.amount; to.troops += fortify.amount;
        log(`${player.name} moves ${fortify.amount} from ${fortify.from} to ${fortify.to}`);
      }
    }
    updateUI();
    setTimeout(nextPlayer, G.aiDelay);
  }

  function createGameInterface() {
    return {
      territories: G.territories, players: G.players, allTerritories: TERRITORIES,
      getPlayerTerritories: id => getPlayerTerritories(id),
      getEnemyNeighbors: (name, id) => getEnemyNeighbors(name, id),
      areConnected: (from, to, id) => areConnected(from, to, id)
    };
  }

  window.RiskGame = {
    setCallbacks,
    initPlayers,
    randomAssignTerritories,
    randomPlaceTroops,
    startClaimPhase,
    startSetupReinforce,
    nextSetupPlayer,
    startMainGame,
    startReinforcePhase,
    startAttackPhase,
    startFortifyPhase,
    nextPlayer,
    rollDice,
    resolveBattle,
    findValidCardSet,
    executeCardTrade,
    checkVictory,
    checkContinentControl,
    endGame,
    aiTurn
  };
})();
