// ai.js - AI Strategies (improved for v2)

import { CONTINENTS } from './data.js';

// Find best continent to target
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

export const STRATEGIES = {
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
      const borders = territories.filter(t => game.getEnemyNeighbors(t.name, player.id).length > 0);
      const pool = borders.length > 0 && Math.random() > 0.3 ? borders : territories;
      const placements = []; let remaining = armies;
      while (remaining > 0) {
        const t = pool[Math.floor(Math.random() * pool.length)];
        const amt = Math.min(remaining, Math.ceil(Math.random() * 4));
        placements.push({ territory: t.name, amount: amt });
        remaining -= amt;
      }
      return placements;
    },
    attack(game, player) {
      if (Math.random() < 0.2) return [];
      const attacks = [], attackable = game.getPlayerTerritories(player.id).filter(t => game.territories[t.name].troops > 1);
      for (let i = 0; i < Math.ceil(Math.random() * 5) && attackable.length > 0; i++) {
        const from = attackable[Math.floor(Math.random() * attackable.length)];
        const enemies = game.getEnemyNeighbors(from.name, player.id);
        if (enemies.length > 0) attacks.push({ from: from.name, to: enemies[Math.floor(Math.random() * enemies.length)].name, maxAttacks: Math.ceil(Math.random() * 10) });
      }
      return attacks;
    },
    fortify(game, player) { return Math.random() < 0.4 ? null : STRATEGIES.defensive.fortify(game, player); }
  },

  balanced: {
    name: "Balanced",
    placeArmies(game, player, armies) {
      const target = findContinentTarget(game, player.id);
      if (target) return STRATEGIES.continental.placeArmies(game, player, armies);
      return STRATEGIES.defensive.placeArmies(game, player, armies);
    },
    attack(game, player) {
      const defensive = STRATEGIES.defensive.attack(game, player);
      const aggressive = STRATEGIES.aggressive.attack(game, player);
      return [...defensive, ...aggressive.slice(0, 2)];
    },
    fortify(game, player) { return STRATEGIES.defensive.fortify(game, player); }
  }
};

export const STRATEGY_NAMES = Object.keys(STRATEGIES);
