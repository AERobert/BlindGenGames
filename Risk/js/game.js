// game.js - Main game logic

import { TERRITORIES, CONTINENTS, STARTING_ARMIES, PLAYER_COLORS, CARD_TYPES, findTerritory } from './data.js';
import { G, gameLog, reset, initTerritories, initDeck, initStats, log, getTradeValue, getPlayerTerritories, getEnemyNeighbors, areConnected, controlsContinent, getControlledContinents, calcReinforcements, updatePeakStats, currentTerritory, currentPlayer } from './state.js';
import { STRATEGIES, STRATEGY_NAMES } from './ai.js';
import * as speech from './speech.js';
import * as sounds from './sounds.js';

// UI callbacks (set by main.js)
let updateUI = () => {};
let showReport = () => {};
let showTroopInput = () => {};
let showDiceResult = () => {};

const COUNTRY_NAME_PARTS = {
  adjectives: [
    'United', 'People\'s', 'Royal', 'Free', 'Grand', 'New', 'Old', 'Northern', 'Southern', 'Eastern', 'Western',
    'Golden', 'Silver', 'Crimson', 'Emerald', 'Azure', 'Iron', 'Verdant', 'Radiant', 'Stormy', 'Quiet', 'Sunny',
    'Brave', 'Merry', 'Noble', 'Clever', 'Cosmic', 'Wandering', 'Arcadian', 'Bumbling', 'Curious', 'Lucky',
    'French', 'Roman', 'Nordic', 'Maritime', 'Ivory', 'Obsidian', 'Autumn', 'Crystal', 'Serene', 'Starlit'
  ],
  regions: [
    'Highland', 'Lowland', 'River', 'Coastal', 'Island', 'Mountain', 'Desert', 'Forest', 'Frontier', 'Harbor',
    'Tundra', 'Prairie', 'Canyon', 'Marsh', 'Delta', 'Steppe', 'Sunset', 'Gulf', 'Northern', 'Southern'
  ],
  governments: [
    'Republic', 'Kingdom', 'Federation', 'Empire', 'Commonwealth', 'Union', 'Duchy', 'Sultanate',
    'Principality', 'Dominion', 'Confederacy', 'Alliance'
  ],
  realms: [
    'Isles', 'Marches', 'Plains', 'Shores', 'Haven', 'Reach', 'Crown', 'Throne', 'Hills', 'Ridges',
    'Gardens', 'Harbor', 'Heights', 'Fields', 'Fjords', 'Coast'
  ]
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildCountryName() {
  const templates = [
    () => `The ${pick(COUNTRY_NAME_PARTS.adjectives)} ${pick(COUNTRY_NAME_PARTS.governments)}`,
    () => `${pick(COUNTRY_NAME_PARTS.adjectives)} ${pick(COUNTRY_NAME_PARTS.governments)}`,
    () => `The ${pick(COUNTRY_NAME_PARTS.regions)} ${pick(COUNTRY_NAME_PARTS.governments)}`,
    () => `${pick(COUNTRY_NAME_PARTS.regions)} ${pick(COUNTRY_NAME_PARTS.governments)}`,
    () => `The ${pick(COUNTRY_NAME_PARTS.adjectives)} ${pick(COUNTRY_NAME_PARTS.realms)}`,
    () => `${pick(COUNTRY_NAME_PARTS.adjectives)} ${pick(COUNTRY_NAME_PARTS.realms)}`
  ];
  return templates[Math.floor(Math.random() * templates.length)]();
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function generateCountryName(existingNames = new Set()) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = buildCountryName();
    if (!existingNames.has(name)) return name;
  }
  return buildCountryName();
}

export function setCallbacks(ui, report, troop, dice) {
  updateUI = ui; showReport = report; showTroopInput = troop; showDiceResult = dice;
}

// Initialize players
export function initPlayers(name, count, spectator = false) {
  G.players = [];
  G.spectatorMode = spectator;
  const usedNames = new Set();
  if (name) usedNames.add(name);
  const strategyPool = shuffle([...STRATEGY_NAMES]);
  if (spectator) {
    for (let i = 0; i < count; i++) {
      const strategy = strategyPool[i % strategyPool.length];
      const countryName = generateCountryName(usedNames);
      usedNames.add(countryName);
      G.players.push({ id: i, name: countryName, color: PLAYER_COLORS[i].hex, colorName: PLAYER_COLORS[i].name, isHuman: false, strategy, strategyName: STRATEGIES[strategy].name, cards: [], eliminated: false });
    }
    G.humanPlayerId = -1;
  } else {
    G.players.push({ id: 0, name, color: PLAYER_COLORS[0].hex, colorName: PLAYER_COLORS[0].name, isHuman: true, cards: [], eliminated: false });
    for (let i = 1; i < count; i++) {
      const strategy = strategyPool[(i - 1) % strategyPool.length];
      const countryName = generateCountryName(usedNames);
      usedNames.add(countryName);
      G.players.push({ id: i, name: countryName, color: PLAYER_COLORS[i].hex, colorName: PLAYER_COLORS[i].name, isHuman: false, strategy, strategyName: STRATEGIES[strategy].name, cards: [], eliminated: false });
    }
    G.humanPlayerId = 0;
  }
  const armies = STARTING_ARMIES[count] || 30;
  for (const p of G.players) G.setupArmies[p.id] = armies;
}

// Random territory assignment
export function randomAssignTerritories(empire = false) {
  const names = TERRITORIES.map(t => t.name);
  for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  let idx = 0;
  for (const n of names) { G.territories[n].owner = idx % G.players.length; G.territories[n].troops = 1; G.setupArmies[idx % G.players.length]--; idx++; }
  log('Territories assigned randomly');
}

// Random troop placement
export function randomPlaceTroops() {
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

// ============== PHASES ==============

export function startClaimPhase() {
  G.phase = 'claim'; G.currentPlayer = 0;
  const unclaimed = TERRITORIES.filter(t => G.territories[t.name].owner === null);
  if (unclaimed.length === 0) { startSetupReinforce(); return; }
  G.currentTerritoryIdx = TERRITORIES.findIndex(t => G.territories[t.name].owner === null);
  updateUI();
  speech.speak(`Claiming phase. ${currentPlayer().name}, select an unclaimed territory.`);
  if (!currentPlayer().isHuman) setTimeout(aiTurn, G.aiDelay);
}

export function startSetupReinforce() {
  G.phase = 'setup-reinforce'; G.currentPlayer = 0;
  if (!Object.values(G.setupArmies).some(a => a > 0)) { startMainGame(); return; }
  while (G.setupArmies[G.currentPlayer] <= 0) G.currentPlayer = (G.currentPlayer + 1) % G.players.length;
  G.currentTerritoryIdx = TERRITORIES.findIndex(t => G.territories[t.name].owner === G.currentPlayer);
  updateUI();
  speech.speak(`Setup. ${currentPlayer().name}, place armies. ${G.setupArmies[currentPlayer().id]} remaining.`);
  if (!currentPlayer().isHuman) setTimeout(aiTurn, G.aiDelay);
}

export function nextSetupPlayer() {
  let next = (G.currentPlayer + 1) % G.players.length, checked = 0;
  while (checked < G.players.length) { if (G.setupArmies[next] > 0) break; next = (next + 1) % G.players.length; checked++; }
  if (checked >= G.players.length) { startMainGame(); return; }
  G.currentPlayer = next;
  updateUI();
  if (!currentPlayer().isHuman) setTimeout(aiTurn, G.aiDelay / 2);
  else speech.speak(`Your turn. ${G.setupArmies[currentPlayer().id]} armies to place.`);
}

export function startMainGame() {
  G.currentPlayer = 0; G.turnNumber = 1;
  log('Main game begins', true);
  startReinforcePhase();
}

export function startReinforcePhase() {
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

export function startAttackPhase() {
  G.phase = 'attack'; G.attackFrom = null;
  const player = currentPlayer();
  const idx = TERRITORIES.findIndex(t => { const ter = G.territories[t.name]; return ter.owner === player.id && ter.troops > 1 && getEnemyNeighbors(t.name, player.id).length > 0; });
  if (idx >= 0) G.currentTerritoryIdx = idx;
  updateUI();
  speech.speak(`Attack phase. Select territory to attack from, or press E to fortify.`);
  if (!player.isHuman) setTimeout(aiTurn, G.aiDelay);
}

export function startFortifyPhase() {
  G.phase = 'fortify'; G.fortifyFrom = null;
  updateUI();
  speech.speak(`Fortify phase. Select territory to move from, or press E to end turn.`);
  if (!currentPlayer().isHuman) setTimeout(aiTurn, G.aiDelay);
}

export function nextPlayer() {
  awardCardIfEarned(currentPlayer().id);
  const winner = checkVictory();
  if (winner !== null) { endGame(winner); return; }
  updatePeakStats();
  do { G.currentPlayer = (G.currentPlayer + 1) % G.players.length; } while (G.players[G.currentPlayer].eliminated);
  const firstActive = G.players.findIndex(p => !p.eliminated);
  if (G.currentPlayer === firstActive) G.turnNumber++;
  startReinforcePhase();
}

// ============== COMBAT ==============

export function rollDice(count) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1).sort((a, b) => b - a);
}

export function resolveBattle(fromName, toName) {
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

// ============== CARDS ==============

export function findValidCardSet(cards) {
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

export function executeCardTrade(player, indices) {
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

// ============== VICTORY ==============

export function checkVictory() {
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

export function checkContinentControl() {
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

export function endGame(winnerId) {
  const winner = G.players[winnerId];
  G.phase = 'gameover'; G.endTime = Date.now();
  sounds.play(winnerId === G.humanPlayerId ? 'gameWin' : 'gameLose');
  speech.speak(`Game over! ${winner.name} wins!`);
  log(`${winner.name} wins!`, true, true);
  updateUI();
  showReport(winnerId);
}

// ============== AI ==============

export function aiTurn() {
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
