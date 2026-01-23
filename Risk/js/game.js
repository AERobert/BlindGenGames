// game.js - Core game logic

(() => {
  const { TERRITORIES, PLAYER_COLORS, STARTING_ARMIES, CONTINENTS, findTerritory } = window.RiskData;
  const { G, gameLog, reset, initTerritories, initDeck, initStats, log, getTradeValue, getPlayerTerritories, getEnemyNeighbors, areConnected, controlsContinent, getControlledContinents, calcReinforcements, updatePeakStats, currentTerritory, currentPlayer } = window.RiskState;
  const { STRATEGIES, STRATEGY_NAMES } = window.RiskAI;
  const speech = window.RiskSpeech;
  const sounds = window.RiskSounds;

  // UI callbacks (set by main.js)
  let updateUI = () => {};
  let showReport = () => {};
  let showTroopInput = () => {};
  let showDiceResult = () => {};

  // Multiplayer broadcast callback (set by main.js)
  let broadcastAction = () => {};

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

  function generateCountryName(existingNames = new Set()) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const name = buildCountryName();
      if (!existingNames.has(name)) return name;
    }
    return buildCountryName();
  }

  function setCallbacks(ui, report, troop, dice, broadcast = null) {
    updateUI = ui; showReport = report; showTroopInput = troop; showDiceResult = dice;
    if (broadcast) broadcastAction = broadcast;
  }

  // Initialize players
  // strategySelections: array of strategy keys (e.g., ['aggressive', 'defensive', ...]) or null for random
  function initPlayers(name, count, spectator = false, strategySelections = null) {
    G.players = [];
    G.spectatorMode = spectator;
    const usedNames = new Set();
    if (name) usedNames.add(name);

    // Determine strategies for AI players
    let aiStrategies;
    if (strategySelections && strategySelections.length > 0) {
      // Use provided strategies, shuffled
      aiStrategies = shuffle([...strategySelections]);
    } else {
      // Use random strategies from the pool
      const strategyPool = shuffle([...STRATEGY_NAMES]);
      const aiCount = spectator ? count : count - 1;
      aiStrategies = [];
      for (let i = 0; i < aiCount; i++) {
        aiStrategies.push(strategyPool[i % strategyPool.length]);
      }
    }

    // Build list of all players (will be shuffled later in non-spectator mode)
    const playerList = [];
    let aiIndex = 0;

    if (spectator) {
      // All players are AI
      for (let i = 0; i < count; i++) {
        const strategy = aiStrategies[aiIndex++];
        const countryName = generateCountryName(usedNames);
        usedNames.add(countryName);
        playerList.push({
          name: countryName,
          isHuman: false,
          strategy,
          strategyName: STRATEGIES[strategy].name,
          cards: [],
          eliminated: false
        });
      }
      G.humanPlayerId = -1;
    } else {
      // One human player + AI players
      // First add the human
      playerList.push({
        name,
        isHuman: true,
        strategy: null,
        strategyName: null,
        cards: [],
        eliminated: false
      });

      // Then add AI players
      for (let i = 0; i < count - 1; i++) {
        const strategy = aiStrategies[aiIndex++];
        const countryName = generateCountryName(usedNames);
        usedNames.add(countryName);
        playerList.push({
          name: countryName,
          isHuman: false,
          strategy,
          strategyName: STRATEGIES[strategy].name,
          cards: [],
          eliminated: false
        });
      }

      // Shuffle the player list so human isn't always player #1
      shuffle(playerList);
    }

    // Assign final IDs and colors based on shuffled positions
    for (let i = 0; i < playerList.length; i++) {
      const p = playerList[i];
      p.id = i;
      p.color = PLAYER_COLORS[i].hex;
      p.colorName = PLAYER_COLORS[i].name;
      G.players.push(p);

      if (p.isHuman) {
        G.humanPlayerId = i;
      }
    }

    const armies = STARTING_ARMIES[count] || 30;
    for (const p of G.players) G.setupArmies[p.id] = armies;
  }

  // Random territory assignment
  function randomAssignTerritories(empire = false) {
    if (empire) {
      assignEmpireTerritories();
      return;
    }
    const names = TERRITORIES.map(t => t.name);
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
    let idx = 0;
    for (const n of names) { G.territories[n].owner = idx % G.players.length; G.territories[n].troops = 1; G.setupArmies[idx % G.players.length]--; idx++; }
    log('Territories assigned randomly');
  }

  // Empire Mode: Divide map into contiguous territory groups (ignoring continent borders)
  // Each player gets a contiguous "empire" of territories
  // Troops are spread evenly on border territories (those adjacent to enemies)
  function assignEmpireTerritories() {
    const numPlayers = G.players.length;
    const allNames = TERRITORIES.map(t => t.name);
    const territoriesPerPlayer = Math.floor(allNames.length / numPlayers);

    // Pick random starting points spread across the map
    const startingPoints = [];
    const shuffledNames = shuffle([...allNames]);

    // Try to pick starting points that are spread out
    for (let i = 0; i < numPlayers; i++) {
      // Pick from different regions of the shuffled list to spread them out
      const regionSize = Math.floor(shuffledNames.length / numPlayers);
      const regionStart = i * regionSize;
      const candidates = shuffledNames.slice(regionStart, regionStart + regionSize);

      // Find a starting point that's not too close to existing ones
      let bestStart = candidates[0];
      let bestMinDist = 0;

      for (const candidate of candidates) {
        if (startingPoints.length === 0) {
          bestStart = candidate;
          break;
        }
        // Calculate minimum "distance" (via BFS depth) to any existing start
        let minDist = Infinity;
        for (const existing of startingPoints) {
          const dist = getTerritoryDistance(candidate, existing);
          if (dist < minDist) minDist = dist;
        }
        if (minDist > bestMinDist) {
          bestMinDist = minDist;
          bestStart = candidate;
        }
      }
      startingPoints.push(bestStart);
    }

    // Assign starting territories to each player
    const assigned = new Set();
    const playerTerritories = [];

    for (let i = 0; i < numPlayers; i++) {
      const start = startingPoints[i];
      G.territories[start].owner = i;
      G.territories[start].troops = 1;
      G.setupArmies[i]--;
      assigned.add(start);
      playerTerritories[i] = [start];
    }

    // Grow each empire by claiming adjacent unassigned territories
    // Use round-robin expansion so empires grow evenly
    let unassignedCount = allNames.length - numPlayers;

    while (unassignedCount > 0) {
      for (let i = 0; i < numPlayers; i++) {
        if (unassignedCount <= 0) break;

        // Find all unassigned territories adjacent to this player's empire
        const frontiers = [];
        for (const tName of playerTerritories[i]) {
          const tData = findTerritory(tName);
          if (tData) {
            for (const neighbor of tData.borders) {
              if (!assigned.has(neighbor)) {
                frontiers.push(neighbor);
              }
            }
          }
        }

        if (frontiers.length > 0) {
          // Pick a random frontier territory to claim
          const choice = frontiers[Math.floor(Math.random() * frontiers.length)];
          G.territories[choice].owner = i;
          G.territories[choice].troops = 1;
          G.setupArmies[i]--;
          assigned.add(choice);
          playerTerritories[i].push(choice);
          unassignedCount--;
        }
      }

      // Safety: if no player could expand (isolated territories), assign remaining randomly
      const remaining = allNames.filter(n => !assigned.has(n));
      if (remaining.length === unassignedCount && remaining.length > 0) {
        // Check if any player expanded this round
        let anyExpanded = false;
        for (let i = 0; i < numPlayers; i++) {
          const frontiers = [];
          for (const tName of playerTerritories[i]) {
            const tData = findTerritory(tName);
            if (tData) {
              for (const neighbor of tData.borders) {
                if (!assigned.has(neighbor)) frontiers.push(neighbor);
              }
            }
          }
          if (frontiers.length > 0) anyExpanded = true;
        }

        if (!anyExpanded) {
          // No frontiers found - assign remaining to player with fewest territories
          for (const r of remaining) {
            const playerIdx = playerTerritories.reduce((minIdx, arr, idx, src) =>
              arr.length < src[minIdx].length ? idx : minIdx, 0);
            G.territories[r].owner = playerIdx;
            G.territories[r].troops = 1;
            G.setupArmies[playerIdx]--;
            assigned.add(r);
            playerTerritories[playerIdx].push(r);
            unassignedCount--;
          }
        }
      }
    }

    // Now distribute remaining troops evenly on border territories
    distributeEmpireTroops();

    log('Empire territories assigned - contiguous empires created');
  }

  // Calculate rough "distance" between two territories using BFS
  function getTerritoryDistance(from, to) {
    if (from === to) return 0;

    const visited = new Set([from]);
    const queue = [{name: from, dist: 0}];

    while (queue.length > 0) {
      const current = queue.shift();
      const tData = findTerritory(current.name);

      if (tData) {
        for (const neighbor of tData.borders) {
          if (neighbor === to) return current.dist + 1;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push({name: neighbor, dist: current.dist + 1});
          }
        }
      }
    }

    return Infinity; // Not connected (shouldn't happen on Risk map)
  }

  // Distribute remaining setup troops evenly on border territories
  function distributeEmpireTroops() {
    for (const player of G.players) {
      const owned = getPlayerTerritories(player.id);

      // Find border territories (those adjacent to enemy territories)
      const borderTerritories = owned.filter(t => {
        return getEnemyNeighbors(t.name, player.id).length > 0;
      });

      // If no border territories, use all territories
      const targets = borderTerritories.length > 0 ? borderTerritories : owned;

      // Distribute remaining setup armies evenly across border territories
      let remaining = G.setupArmies[player.id];
      let idx = 0;

      while (remaining > 0 && targets.length > 0) {
        const target = targets[idx % targets.length];
        G.territories[target.name].troops += 1;
        remaining--;
        idx++;
      }

      G.setupArmies[player.id] = 0;
    }
  }

  // Random troop placement
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

  // ============== PHASES ==============

  function startClaimPhase() {
    G.phase = 'claim'; G.currentPlayer = 0;
    const unclaimed = TERRITORIES.filter(t => G.territories[t.name].owner === null);
    if (unclaimed.length === 0) { startSetupReinforce(); return; }
    G.currentTerritoryIdx = TERRITORIES.findIndex(t => G.territories[t.name].owner === null);
    updateUI();
    speech.speak(`Claiming phase. ${currentPlayer().name}, select an unclaimed territory.`);
    if (!currentPlayer().isHuman && shouldRunAI()) setTimeout(aiTurn, G.aiDelay);
  }

  function startSetupReinforce() {
    G.phase = 'setup-reinforce'; G.currentPlayer = 0;
    G.setupTroopsPlacedThisRound = 0;  // Initialize round counter
    if (!Object.values(G.setupArmies).some(a => a > 0)) { startMainGame(); return; }
    while (G.setupArmies[G.currentPlayer] <= 0) G.currentPlayer = (G.currentPlayer + 1) % G.players.length;
    G.currentTerritoryIdx = TERRITORIES.findIndex(t => G.territories[t.name].owner === G.currentPlayer);
    updateUI();
    speech.speak(`Setup. ${currentPlayer().name}, place armies. ${G.setupArmies[currentPlayer().id]} remaining. Place up to 3 this round.`);
    if (!currentPlayer().isHuman && shouldRunAI()) setTimeout(aiTurn, G.aiDelay);
  }

  function nextSetupPlayer() {
    let next = (G.currentPlayer + 1) % G.players.length, checked = 0;
    while (checked < G.players.length) { if (G.setupArmies[next] > 0) break; next = (next + 1) % G.players.length; checked++; }
    if (checked >= G.players.length) { startMainGame(); return; }
    G.currentPlayer = next;
    G.setupTroopsPlacedThisRound = 0;  // Reset counter for new player's round
    updateUI();
    if (!currentPlayer().isHuman && shouldRunAI()) setTimeout(aiTurn, G.aiDelay / 2);
    else speech.speak(`${currentPlayer().name}'s turn. ${G.setupArmies[currentPlayer().id]} armies to place. Up to 3 this round.`);
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
      if (set) {
        const result = executeCardTrade(player, set);
        G.armiesToPlace += result.value;
        ann += ` Auto-traded for ${result.value}`;
        if (result.territoryBonuses.length > 0) {
          ann += ` plus ${result.territoryBonuses.length * 2} on ${result.territoryBonuses.join(', ')}`;
        }
        ann += '.';
      }
    }
    log(`${player.name} receives ${G.armiesToPlace} armies`);
    speech.speak(ann);
    if (!player.isHuman && shouldRunAI()) setTimeout(aiTurn, G.aiDelay);
  }

  function startAttackPhase() {
    G.phase = 'attack'; G.attackFrom = null;
    const player = currentPlayer();
    const idx = TERRITORIES.findIndex(t => { const ter = G.territories[t.name]; return ter.owner === player.id && ter.troops > 1 && getEnemyNeighbors(t.name, player.id).length > 0; });
    if (idx >= 0) G.currentTerritoryIdx = idx;
    updateUI();
    speech.speak(`Attack phase. Select territory to attack from, or press E to fortify.`);
    if (!player.isHuman && shouldRunAI()) setTimeout(aiTurn, G.aiDelay);
  }

  function startFortifyPhase() {
    G.phase = 'fortify'; G.fortifyFrom = null;
    updateUI();
    speech.speak(`Fortify phase. Select territory to move from, or press E to end turn.`);
    if (!currentPlayer().isHuman && shouldRunAI()) setTimeout(aiTurn, G.aiDelay);
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

  // ============== COMBAT ==============

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

  // ============== CARDS ==============

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
    // Per Risk rules: +2 bonus is placed directly on matching owned territories
    const territoryBonuses = [];
    for (const card of removed) {
      if (card.territory && G.territories[card.territory]?.owner === player.id) {
        G.territories[card.territory].troops += 2;
        territoryBonuses.push(card.territory);
      }
    }
    const totalBonus = territoryBonuses.length * 2;
    log(`${player.name} trades cards for ${value} armies` + (totalBonus > 0 ? ` (+${totalBonus} on ${territoryBonuses.join(', ')})` : ''));
    return { value, territoryBonuses };
  }

  function awardCardIfEarned(playerId) {
    if (!G.conqueredThisTurn || G.deck.length === 0) return;
    const card = G.deck.pop();
    G.players[playerId].cards.push(card);
    sounds.play('card');
    log(`${G.players[playerId].name} earned a card`);
    speech.speak(`${G.players[playerId].name} earned a card.`);
  }

  // ============== VICTORY ==============

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
          speech.speak(`${player.name} lost control of ${c}.`);
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

  // ============== AI ==============

  // Schedule AI action with pause support
  function scheduleAI(action, delay) {
    if (!shouldRunAI()) return;
    if (G.paused) {
      G.pendingAIAction = { action, delay };
      return;
    }
    setTimeout(action, delay);
  }

  function shouldRunAI() {
    return !G.multiplayerMode || G.multiplayerHost;
  }

  // Resume AI when unpaused
  function resumeAI() {
    if (!shouldRunAI()) return;
    if (G.pendingAIAction) {
      const { action, delay } = G.pendingAIAction;
      G.pendingAIAction = null;
      setTimeout(action, Math.min(delay, 200)); // Quick resume
    } else if (!currentPlayer()?.isHuman && G.phase !== 'gameover') {
      // If no pending action but it's AI turn, start fresh
      setTimeout(aiTurn, 200);
    }
  }

  function aiTurn() {
    if (!shouldRunAI()) return;
    const player = currentPlayer();
    if (player.isHuman || G.paused) return;
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
    if (G.paused) { G.pendingAIAction = { action: () => aiClaim(player), delay: 0 }; return; }
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
    speech.speak(`${player.name} claims ${choice.name}.`);

    // Broadcast in multiplayer
    if (G.multiplayerMode) {
      broadcastAction('claim', {
        territory: choice.name,
        playerId: player.id,
        playerName: player.name
      });
    }

    scheduleAI(() => {
      G.currentPlayer = (G.currentPlayer + 1) % G.players.length;
      if (TERRITORIES.filter(t => G.territories[t.name].owner === null).length === 0) startSetupReinforce();
      else { updateUI(); if (!currentPlayer().isHuman) scheduleAI(aiTurn, G.aiDelay / 2); }
    }, G.aiDelay / 2);
  }

  function aiSetupReinforce(player) {
    if (G.paused) { G.pendingAIAction = { action: () => aiSetupReinforce(player), delay: 0 }; return; }
    const owned = getPlayerTerritories(player.id);
    if (owned.length === 0 || G.setupArmies[player.id] <= 0) { nextSetupPlayer(); return; }
    const borders = owned.filter(t => getEnemyNeighbors(t.name, player.id).length > 0);
    const choice = borders.length > 0 ? borders[Math.floor(Math.random() * borders.length)] : owned[Math.floor(Math.random() * owned.length)];
    const amount = Math.min(3, G.setupArmies[player.id]);
    G.territories[choice.name].troops += amount;
    G.setupArmies[player.id] -= amount;
    G.setupTroopsPlacedThisRound = amount;  // AI places all at once, always completing round
    log(`${player.name} places ${amount} on ${choice.name} (${G.setupArmies[player.id]} left)`);
    speech.speak(`${player.name} places ${amount} on ${choice.name}. ${G.setupArmies[player.id]} remaining.`);

    // Broadcast in multiplayer - include turnComplete flag
    if (G.multiplayerMode) {
      broadcastAction('place', {
        territory: choice.name,
        amount: amount,
        playerId: player.id,
        playerName: player.name,
        phase: 'setup-reinforce',
        remaining: G.setupArmies[player.id],
        setupTroopsPlacedThisRound: G.setupTroopsPlacedThisRound,
        turnComplete: true
      });
    }

    scheduleAI(nextSetupPlayer, G.aiDelay / 3);
  }

  function aiReinforce(player, strategy) {
    if (G.paused) { G.pendingAIAction = { action: () => aiReinforce(player, strategy), delay: 0 }; return; }
    if (player.cards.length >= 3) {
      const set = findValidCardSet(player.cards);
      if (set && (player.cards.length >= 5 || getTradeValue() >= 8)) {
        const result = executeCardTrade(player, set);
        G.armiesToPlace += result.value;
        let ann = `${player.name} trades cards for ${result.value}`;
        if (result.territoryBonuses.length > 0) {
          ann += ` plus ${result.territoryBonuses.length * 2} on ${result.territoryBonuses.join(', ')}`;
        }
        speech.speak(ann + '.');

        // Broadcast trade in multiplayer
        if (G.multiplayerMode) {
          broadcastAction('trade', {
            playerId: player.id,
            playerName: player.name,
            value: result.value,
            territoryBonuses: result.territoryBonuses
          });
        }
      }
    }
    const gameInterface = createGameInterface();
    const placements = strategy.placeArmies(gameInterface, player, G.armiesToPlace);
    const placementSummary = [];
    for (const p of placements) {
      if (G.territories[p.territory]?.owner === player.id) {
        G.territories[p.territory].troops += p.amount;
        log(`${player.name} places ${p.amount} on ${p.territory}`);
        placementSummary.push(`${p.amount} on ${p.territory}`);

        // Broadcast each placement in multiplayer
        if (G.multiplayerMode) {
          broadcastAction('place', {
            territory: p.territory,
            amount: p.amount,
            playerId: player.id,
            playerName: player.name,
            phase: 'reinforce',
            remaining: 0
          });
        }
      }
    }
    if (placementSummary.length > 0) {
      speech.speak(`${player.name} places ${placementSummary.join(', ')}.`);
    }
    G.armiesToPlace = 0;

    // Broadcast phase transition in multiplayer
    if (G.multiplayerMode) {
      broadcastAction('endPhase', {
        phase: 'reinforce',
        nextPhase: 'attack',
        playerId: player.id,
        playerName: player.name
      });
    }

    updateUI();
    scheduleAI(startAttackPhase, G.aiDelay);
  }

  function aiAttack(player, strategy) {
    if (G.paused) { G.pendingAIAction = { action: () => aiAttack(player, strategy), delay: 0 }; return; }
    const attacks = strategy.attack(createGameInterface(), player);
    if (attacks.length === 0) {
      // Broadcast phase transition in multiplayer
      if (G.multiplayerMode) {
        broadcastAction('endPhase', {
          phase: 'attack',
          nextPhase: 'fortify',
          playerId: player.id,
          playerName: player.name
        });
      }
      scheduleAI(startFortifyPhase, G.aiDelay / 2);
      return;
    }
    executeAiAttacks(player, attacks, 0);
  }

  function executeAiAttacks(player, attacks, index) {
    if (G.paused) { G.pendingAIAction = { action: () => executeAiAttacks(player, attacks, index), delay: 0 }; return; }
    if (index >= attacks.length) {
      // Broadcast phase transition in multiplayer
      if (G.multiplayerMode) {
        broadcastAction('endPhase', {
          phase: 'attack',
          nextPhase: 'fortify',
          playerId: player.id,
          playerName: player.name
        });
      }
      scheduleAI(startFortifyPhase, G.aiDelay / 2);
      return;
    }
    const attack = attacks[index];
    const from = G.territories[attack.from], to = G.territories[attack.to];
    if (from.owner !== player.id || to.owner === player.id || from.troops <= 1) { executeAiAttacks(player, attacks, index + 1); return; }
    const defender = G.players[to.owner];
    const defenderId = to.owner;
    log(`${player.name} attacks ${attack.to} from ${attack.from}`);
    speech.speak(`${player.name} attacks ${attack.to} from ${attack.from}.`);
    G.stats.attacks[player.id]++;
    let attacksRemaining = attack.maxAttacks || 10;
    const doAttack = () => {
      if (G.paused) { G.pendingAIAction = { action: doAttack, delay: 0 }; return; }
      if (attacksRemaining <= 0 || from.troops <= 1 || to.owner === player.id) { scheduleAI(() => executeAiAttacks(player, attacks, index + 1), G.aiDelay / 3); return; }
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
        speech.speak(`${player.name} conquers ${attack.to}! ${toMove} troops moved in.`);
        checkContinentControl();

        let defenderEliminated = false;
        let cardsTransferred = false;
        const defT = Object.values(G.territories).filter(t => t.owner === oldOwner);
        if (defT.length === 0 && oldOwner !== null) {
          defenderEliminated = true;
          const defPlayer = G.players[oldOwner];
          defPlayer.eliminated = true; G.stats.eliminated[oldOwner] = G.turnNumber;
          if (defPlayer.cards.length > 0) {
            cardsTransferred = true;
            player.cards.push(...defPlayer.cards);
            defPlayer.cards = [];
            speech.speak(`${defPlayer.name} eliminated! ${player.name} captures cards.`);
          } else {
            speech.speak(`${defPlayer.name} eliminated!`);
          }
          sounds.play('elimination'); log(`${defPlayer.name} eliminated`, true);
          // If human player was eliminated, switch to spectator mode
          if (defPlayer.isHuman) {
            G.spectatorMode = true;
            G.humanPlayerId = -1;
            speech.speak('You have been eliminated. Switching to spectator mode.');
            log('Game continues in spectator mode', true);
          }
        }

        // Broadcast attack in multiplayer
        if (G.multiplayerMode) {
          broadcastAction('attack', {
            from: attack.from,
            to: attack.to,
            result: result,
            playerName: player.name,
            attackerId: player.id,
            defenderId: defenderId,
            conquered: true,
            fromTroops: from.troops,
            toTroops: to.troops,
            toOwner: player.id,
            defenderEliminated,
            cardsTransferred
          });
        }

        if (checkVictory() !== null) { endGame(checkVictory()); return; }
        updateUI();
        scheduleAI(() => executeAiAttacks(player, attacks, index + 1), G.aiDelay / 2);
      } else {
        // Broadcast non-conquering attack in multiplayer
        if (G.multiplayerMode) {
          broadcastAction('attack', {
            from: attack.from,
            to: attack.to,
            result: result,
            playerName: player.name,
            attackerId: player.id,
            defenderId: defenderId,
            conquered: false,
            fromTroops: from.troops,
            toTroops: to.troops,
            toOwner: to.owner
          });
        }

        updateUI(); scheduleAI(doAttack, 150);
      }
    };
    sounds.play('attack');
    doAttack();
  }

  function aiFortify(player, strategy) {
    if (G.paused) { G.pendingAIAction = { action: () => aiFortify(player, strategy), delay: 0 }; return; }
    const fortify = strategy.fortify(createGameInterface(), player);
    if (fortify?.amount > 0) {
      const from = G.territories[fortify.from], to = G.territories[fortify.to];
      if (from?.owner === player.id && to?.owner === player.id && from.troops > fortify.amount) {
        from.troops -= fortify.amount; to.troops += fortify.amount;
        log(`${player.name} moves ${fortify.amount} from ${fortify.from} to ${fortify.to}`);
        sounds.play('fortify');
        speech.speak(`${player.name} moves ${fortify.amount} from ${fortify.from} to ${fortify.to}.`);

        // Broadcast fortify in multiplayer
        if (G.multiplayerMode) {
          broadcastAction('fortify', {
            from: fortify.from,
            to: fortify.to,
            amount: fortify.amount,
            playerId: player.id,
            playerName: player.name
          });
        }
      }
    }
    updateUI();

    // Broadcast next player transition in multiplayer (will be sent after nextPlayer runs)
    const currentIdx = G.currentPlayer;
    scheduleAI(() => {
      nextPlayer();
      if (G.multiplayerMode && G.phase !== 'gameover') {
        broadcastAction('nextPlayer', {
          previousPlayer: currentIdx,
          nextPlayer: G.currentPlayer,
          turnNumber: G.turnNumber,
          newTurn: G.currentPlayer <= currentIdx,
          armies: G.armiesToPlace
        });
      }
    }, G.aiDelay);
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
    generateCountryName,
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
    aiTurn,
    resumeAI
  };
})();
