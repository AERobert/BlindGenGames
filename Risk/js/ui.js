// ui.js - UI rendering and dialogs

(() => {
  const { TERRITORIES, CONTINENTS, NAV_KEYS, findTerritory } = window.RiskData;
  const { G, gameLog, getPlayerTerritories, getEnemyNeighbors, getControlledContinents, currentTerritory, currentPlayer, areConnected } = window.RiskState;
  const speech = window.RiskSpeech;
  const sounds = window.RiskSounds;

  // Dialog state
  let quickJumpActive = false, troopInputActive = false, diceActive = false, reportActive = false;
  let troopCallback = null, diceCallback = null;
  let quickJumpMatches = [];
  let quickJumpIndex = -1;

  function isQuickJumpActive() { return quickJumpActive; }
  function isTroopInputActive() { return troopInputActive; }
  function isDiceActive() { return diceActive; }
  function isReportActive() { return reportActive; }

  // Main UI update
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
      if (G.phase === 'reinforce' && G.armiesToPlace > 0) { armiesEl.textContent = `${G.armiesToPlace} troops to place`; armiesEl.classList.remove('hidden'); }
      else if (G.phase === 'setup-reinforce') { armiesEl.textContent = `${G.setupArmies[player.id] || 0} troops remaining`; armiesEl.classList.remove('hidden'); }
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
      li.setAttribute('role', 'listitem');
      const strategyLabel = player.strategyName || player.strategy;
      const isCurrent = player.id === G.currentPlayer;
      const isYou = G.multiplayerMode ? (player.isHuman && !player.isRemote) : (player.id === G.humanPlayerId);
      const youLabel = isYou ? ' (You)' : '';
      const currentLabel = isCurrent ? ' - Current turn' : '';
      const eliminatedLabel = player.eliminated ? ' - Eliminated' : '';
      li.innerHTML = `<span class="player-indicator" style="background:${player.color}" aria-hidden="true"></span><span>${player.name}${youLabel}${player.isHuman ? '' : ` (${strategyLabel})`}</span><span style="margin-left:auto">${territories.length}T/${troops}A</span>`;
      li.setAttribute('aria-label', `${player.name}${youLabel}${player.isHuman ? '' : `, ${strategyLabel}`}, ${territories.length} territories, ${troops} troops${currentLabel}${eliminatedLabel}`);
      if (isCurrent) li.classList.add('current');
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
      // Check if it's a valid territory (not ocean/land)
      if (target && target !== 'ocean' && target !== 'land') {
        const targetTer = G.territories[target];
        const owner = targetTer?.owner !== null ? G.players[targetTer.owner] : null;
        btn.innerHTML = `<span>${keys[i].toUpperCase()}</span>${target}`;
        btn.disabled = false;
        btn.style.borderColor = owner ? owner.color : '#666';
      } else {
        // Display "Ocean" or "Land" based on the marker
        const label = target === 'land' ? 'Land' : 'Ocean';
        btn.innerHTML = `<span>${keys[i].toUpperCase()}</span>${label}`;
        btn.disabled = true;
        btn.style.borderColor = '#333';
      }
    });
  }

  function updatePhaseActions() {
    const el = document.getElementById('phase-actions');
    if (!el) return;
    el.innerHTML = '';
    const player = currentPlayer();
    if (!player) return;

    // In multiplayer, only show actions if it's my turn
    const isMyTurn = G.multiplayerMode ? (player.isHuman && !player.isRemote) : player.isHuman;
    if (!isMyTurn && !G.spectatorMode) {
      // Show waiting message for other player's turn
      if (G.multiplayerMode && player.isHuman && player.isRemote) {
        el.innerHTML = `<span style="color:#4ecca3">Waiting for ${player.name} to play...</span>`;
      }
      return;
    }

    const btns = {
      'claim': '<button onclick="game.claimTerritory()">Claim (Space)</button>',
      'setup-reinforce': '<button onclick="game.placeArmy()">Place Troops (Space)</button>',
      'reinforce': '<button onclick="game.placeArmy()">Place Troops (Space)</button><button onclick="game.tradeCards()">Trade (T)</button><button onclick="game.endReinforce()">End (E)</button>',
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

  // ============== DIALOGS ==============

  function showQuickJump() {
    quickJumpActive = true;
    document.getElementById('quick-jump-overlay').classList.remove('hidden');
    const input = document.getElementById('quick-jump-input');
    input.value = ''; input.focus();
    updateQuickJumpMatches('');
    speech.speak('Quick jump. Type a territory name. Use arrow keys to choose, Enter to jump.');
  }

  function hideQuickJump() {
    quickJumpActive = false;
    quickJumpMatches = [];
    quickJumpIndex = -1;
    document.getElementById('quick-jump-overlay').classList.add('hidden');
    document.getElementById('current-territory')?.focus();
  }

  function updateQuickJumpMatches(query) {
    const container = document.getElementById('quick-jump-matches');
    container.innerHTML = '';
    const normalized = query.trim().toLowerCase();
    // Filter territories that match the query
    const matches = TERRITORIES.filter(t => t.name.toLowerCase().includes(normalized));
    // Sort to prioritize matches that start with the query
    matches.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(normalized);
      const bStarts = b.name.toLowerCase().startsWith(normalized);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.name.localeCompare(b.name);
    });
    quickJumpMatches = matches.slice(0, 10);
    if (quickJumpMatches.length === 0) {
      container.textContent = normalized ? 'No matches.' : 'Type to search.';
      quickJumpIndex = -1;
      return;
    }
    quickJumpIndex = 0;
    quickJumpMatches.forEach((t, index) => {
      const ter = G.territories[t.name];
      const owner = ter.owner !== null ? G.players[ter.owner] : null;
      const div = document.createElement('div');
      div.className = 'quick-jump-match';
      if (index === quickJumpIndex) div.classList.add('active');
      div.textContent = `${t.name} (${t.continent}) - ${owner ? `${owner.colorName}, ${ter.troops}` : 'Unclaimed'}`;
      div.style.borderLeft = `4px solid ${owner ? owner.color : '#666'}`;
      div.onclick = () => { G.currentTerritoryIdx = TERRITORIES.findIndex(x => x.name === t.name); hideQuickJump(); updateUI(); announceTerritory(); };
      container.appendChild(div);
    });
    if (normalized && quickJumpMatches.length === 1 && quickJumpMatches[0].name.toLowerCase() === normalized) {
      confirmQuickJumpSelection();
    }
    announceQuickJumpSelection();
  }

  function setQuickJumpSelection(index) {
    if (quickJumpMatches.length === 0) return;
    quickJumpIndex = (index + quickJumpMatches.length) % quickJumpMatches.length;
    const container = document.getElementById('quick-jump-matches');
    container.querySelectorAll('.quick-jump-match').forEach((item, idx) => {
      item.classList.toggle('active', idx === quickJumpIndex);
    });
    const input = document.getElementById('quick-jump-input');
    if (input) {
      input.value = quickJumpMatches[quickJumpIndex].name;
      input.setSelectionRange(input.value.length, input.value.length);
    }
    announceQuickJumpSelection();
  }

  function announceQuickJumpSelection() {
    if (quickJumpIndex < 0 || quickJumpIndex >= quickJumpMatches.length) return;
    const t = quickJumpMatches[quickJumpIndex];
    const ter = G.territories[t.name];
    const owner = ter.owner !== null ? G.players[ter.owner] : null;
    speech.speak(`${t.name}. ${owner ? `${owner.colorName}, ${ter.troops} troops.` : 'Unclaimed.'}`);
  }

  function cycleQuickJumpMatch(direction) {
    if (quickJumpMatches.length === 0) return;
    const delta = direction === 'up' ? -1 : 1;
    setQuickJumpSelection(quickJumpIndex + delta);
  }

  function confirmQuickJumpSelection() {
    if (quickJumpMatches.length === 0) return;
    const match = quickJumpMatches[Math.max(0, quickJumpIndex)];
    G.currentTerritoryIdx = TERRITORIES.findIndex(x => x.name === match.name);
    hideQuickJump();
    updateUI();
    announceTerritory();
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
    speech.speak(`${title}. ${desc}. Min ${min}, max ${max}. Type A for all.`);
  }

  function confirmTroopInput() {
    const input = document.getElementById('troop-input');
    const rawValue = input.value.trim().toLowerCase();
    const min = parseInt(input.min);
    const max = parseInt(input.max);
    const value = rawValue === 'a' || rawValue === 'all' ? max : parseInt(rawValue, 10);
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
    let outcomeText = `Attack: ${result.attackRolls.join(', ')}. Defense: ${result.defendRolls.join(', ')}. `;
    outcomeText += `Attacker loses ${result.attackerLosses}. Defender loses ${result.defenderLosses}.`;
    if (result.conquered) {
      outcomeText += ' Territory conquered!';
    }
    speech.speak(outcomeText);
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

  // ============== ANNOUNCEMENTS ==============

  function announceTerritory() {
    const t = currentTerritory();
    if (!t) return;
    const ter = G.territories[t.name];
    const owner = ter.owner !== null ? G.players[ter.owner] : null;
    let ann = `${t.name}, ${t.continent}. ${owner ? `${owner.colorName}, ${ter.troops} troops.` : 'Unclaimed.'}`;
    const dirs = [];
    const directionLabels = [
      ['northwest', 'northwest'],
      ['north', 'north'],
      ['northeast', 'northeast'],
      ['west', 'west'],
      ['east', 'east'],
      ['southwest', 'southwest'],
      ['south', 'south'],
      ['southeast', 'southeast']
    ];
    for (const [dir, label] of directionLabels) {
      const target = t.directions[dir];
      // Only announce actual territories, not ocean/land
      if (target && target !== 'ocean' && target !== 'land') dirs.push(`${target} to the ${label}`);
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

  function announceClaimReport() {
    const unclaimed = TERRITORIES.filter(t => G.territories[t.name].owner === null);
    const claimed = TERRITORIES.length - unclaimed.length;
    const claimWord = claimed === 1 ? 'territory is' : 'territories are';
    const unclaimedWord = unclaimed.length === 1 ? 'territory is' : 'territories are';
    let ann = `${claimed} ${claimWord} claimed. ${unclaimed.length} ${unclaimedWord} unclaimed.`;
    if (unclaimed.length > 0) {
      const byC = {};
      for (const t of unclaimed) { if (!byC[t.continent]) byC[t.continent] = []; byC[t.continent].push(t.name); }
      for (const c in byC) ann += ` ${c}: ${byC[c].join(', ')}.`;
    }
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

  function announcePlayerVerbose(idx) {
    if (idx < 0 || idx >= G.players.length) { speech.speak('Invalid player.'); return; }
    const p = G.players[idx];
    const territories = getPlayerTerritories(p.id);
    const troops = territories.reduce((sum, t) => sum + G.territories[t.name].troops, 0);
    if (p.eliminated) { speech.speak(`${p.name}, ${p.colorName}, eliminated.`); return; }
    const territoryWord = territories.length === 1 ? 'territory' : 'territories';
    let ann = `${p.name}, ${p.colorName}. Controls ${territories.length} ${territoryWord} with ${troops} troops.`;
    if (territories.length === 0) {
      ann += ' No territories to report.';
      speech.speak(ann);
      return;
    }
    const details = territories
      .map(t => `${t.name} has ${G.territories[t.name].troops} troops`)
      .join('. ');
    ann += ` ${details}.`;
    speech.speak(ann);
  }

  function announcePhase() {
    const p = currentPlayer();
    let ann = `Turn ${G.turnNumber}. ${p.name}'s turn. Phase: ${G.phase}. `;
    if (G.phase === 'reinforce' && G.armiesToPlace > 0) ann += `${G.armiesToPlace} troops to place. `;
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
    cycleQuickJumpMatch,
    confirmQuickJumpSelection,
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
    announceClaimReport,
    listCards,
    announcePlayerVerbose,
    announcePhase
  };
})();
