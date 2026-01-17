// ai.js - AI Strategies (improved for v2)
// Now with combat probability calculations for smarter attack decisions

(() => {
  const { CONTINENTS } = window.RiskData;

  // ============================================================================
  // COMBAT WIN PROBABILITY CALCULATIONS
  // Based on Monte Carlo simulations of Risk combat
  // ============================================================================

  // Lookup table for small battles (A=attackers 2-11, D=defenders 1-9)
  // Values are attacker win rates from 30,000+ simulations each
  const WIN_RATE_TABLE = {
    // A: { D: win_rate, ... }
    2:  { 1: 0.42, 2: 0.11, 3: 0.03, 4: 0.01 },
    3:  { 1: 0.75, 2: 0.36, 3: 0.21, 4: 0.09, 5: 0.05 },
    4:  { 1: 0.92, 2: 0.65, 3: 0.48, 4: 0.32, 5: 0.21, 6: 0.13 },
    5:  { 1: 0.97, 2: 0.78, 3: 0.65, 4: 0.48, 5: 0.36, 6: 0.26, 7: 0.18 },
    6:  { 1: 0.99, 2: 0.89, 3: 0.77, 4: 0.64, 5: 0.51, 6: 0.40, 7: 0.29, 8: 0.22 },
    7:  { 1: 1.00, 2: 0.94, 3: 0.86, 4: 0.75, 5: 0.64, 6: 0.52, 7: 0.42, 8: 0.33, 9: 0.26 },
    8:  { 1: 1.00, 2: 0.97, 3: 0.91, 4: 0.83, 5: 0.74, 6: 0.64, 7: 0.53, 8: 0.45, 9: 0.36 },
    9:  { 1: 1.00, 2: 0.98, 3: 0.95, 4: 0.89, 5: 0.82, 6: 0.73, 7: 0.64, 8: 0.55, 9: 0.47 },
    10: { 1: 1.00, 2: 0.99, 3: 0.97, 4: 0.93, 5: 0.87, 6: 0.81, 7: 0.73, 8: 0.65, 9: 0.56 },
    11: { 1: 1.00, 2: 0.99, 3: 0.98, 4: 0.95, 5: 0.91, 6: 0.86, 7: 0.80, 8: 0.72, 9: 0.65 }
  };

  /**
   * Calculate attacker win probability using the simplified formula
   * For large battles (≥8 troops each): win_rate ≈ R^5 / (R^5 + 1)
   * @param {number} attackers - Number of attacking troops
   * @param {number} defenders - Number of defending troops
   * @returns {number} Win probability 0-1
   */
  function calculateWinProbabilityFormula(attackers, defenders) {
    if (attackers <= 1 || defenders <= 0) return 0;
    const R = attackers / defenders;
    const R5 = Math.pow(R, 5);
    return R5 / (R5 + 1);
  }

  /**
   * Get attacker win probability using lookup table for small battles
   * or formula for larger battles
   * @param {number} attackers - Number of attacking troops
   * @param {number} defenders - Number of defending troops
   * @returns {number} Win probability 0-1
   */
  function getWinProbability(attackers, defenders) {
    // Need at least 2 attackers to attack (1 must stay behind)
    if (attackers <= 1) return 0;
    if (defenders <= 0) return 1;

    // Use lookup table for small battles (more accurate)
    if (attackers <= 11 && defenders <= 9 && WIN_RATE_TABLE[attackers]?.[defenders] !== undefined) {
      return WIN_RATE_TABLE[attackers][defenders];
    }

    // For larger battles, use the R^5 formula
    return calculateWinProbabilityFormula(attackers, defenders);
  }

  /**
   * Check if attack meets minimum win probability threshold
   * @param {number} attackers - Number of attacking troops
   * @param {number} defenders - Number of defending troops
   * @param {number} threshold - Minimum win probability required (0-1)
   * @returns {boolean} True if attack is advisable
   */
  function shouldAttack(attackers, defenders, threshold) {
    return getWinProbability(attackers, defenders) >= threshold;
  }

  // Strategy-specific win probability thresholds
  const WIN_THRESHOLDS = {
    aggressive: 0.25,    // Will attack even with low odds
    defensive: 0.70,     // Needs good odds to attack
    continental: 0.50,   // Moderate - will push for continent control
    opportunist: 0.50,   // Looks for favorable situations
    eliminator: 0.40,    // Willing to take risks to eliminate players
    turtle: 0.80,        // Very conservative, only attacks sure things
    balanced: 0.50,      // Middle ground
    emperor: 0.40        // Aggressive expansion, takes calculated risks
  };

  // ============================================================================
  // SMART FORTIFICATION HELPERS
  // ============================================================================

  /**
   * Calculate how vulnerable a territory is based on enemy neighbors
   * Returns the highest enemy win probability against this territory
   * @param {object} game - Game state
   * @param {string} territoryName - Territory to check
   * @param {number} troops - Number of troops on the territory
   * @returns {number} Vulnerability (0-1, higher = more vulnerable)
   */
  function getTerritoryVulnerability(game, territoryName, troops) {
    const territory = game.territories[territoryName];
    const tData = game.allTerritories.find(t => t.name === territoryName);
    if (!tData) return 0;

    let maxThreat = 0;
    for (const neighborName of tData.borders) {
      const neighbor = game.territories[neighborName];
      if (neighbor.owner !== territory.owner) {
        // Calculate enemy's win probability if they attack us
        const enemyWinProb = getWinProbability(neighbor.troops, troops);
        maxThreat = Math.max(maxThreat, enemyWinProb);
      }
    }
    return maxThreat;
  }

  /**
   * Smart fortification that considers vulnerability
   * Won't leave source territory too exposed
   * @param {object} game - Game state
   * @param {object} player - Current player
   * @param {number} maxAcceptableVulnerability - Max enemy win prob to allow (default 0.5)
   * @returns {object|null} Fortification move or null
   */
  function smartFortify(game, player, maxAcceptableVulnerability = 0.50) {
    const territories = game.getPlayerTerritories(player.id);

    // Find border territories sorted by vulnerability (most vulnerable first)
    const borders = territories
      .filter(t => game.getEnemyNeighbors(t.name, player.id).length > 0)
      .map(t => ({
        territory: t,
        troops: game.territories[t.name].troops,
        vulnerability: getTerritoryVulnerability(game, t.name, game.territories[t.name].troops)
      }))
      .sort((a, b) => b.vulnerability - a.vulnerability);

    if (borders.length === 0) return null;

    // Find territories that can donate troops
    const potentialSources = territories
      .filter(t => game.territories[t.name].troops > 1)
      .map(t => ({
        territory: t,
        troops: game.territories[t.name].troops,
        isInterior: game.getEnemyNeighbors(t.name, player.id).length === 0,
        vulnerability: getTerritoryVulnerability(game, t.name, game.territories[t.name].troops)
      }))
      // Prioritize interior territories, then least vulnerable borders
      .sort((a, b) => {
        if (a.isInterior !== b.isInterior) return a.isInterior ? -1 : 1;
        return a.vulnerability - b.vulnerability;
      });

    // Try to find a good fortification move
    for (const dest of borders) {
      // Skip if destination isn't very vulnerable
      if (dest.vulnerability < 0.30) continue;

      for (const source of potentialSources) {
        if (source.territory.name === dest.territory.name) continue;
        if (!game.areConnected(source.territory.name, dest.territory.name, player.id)) continue;

        // Calculate how many troops we can safely move
        let maxMove = source.troops - 1;

        // If source is a border, don't leave it too vulnerable
        if (!source.isInterior) {
          // Try different amounts until we find one that's safe
          for (let tryMove = maxMove; tryMove >= 1; tryMove--) {
            const remainingTroops = source.troops - tryMove;
            const newVulnerability = getTerritoryVulnerability(game, source.territory.name, remainingTroops);
            if (newVulnerability <= maxAcceptableVulnerability) {
              maxMove = tryMove;
              break;
            }
            if (tryMove === 1) maxMove = 0; // Can't safely move anything
          }
        }

        if (maxMove > 0) {
          return {
            from: source.territory.name,
            to: dest.territory.name,
            amount: maxMove
          };
        }
      }
    }

    return null;
  }

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
            const winProb = getWinProbability(myTroops, e.troops);
            // Aggressive: attacks even with just 25% win chance
            if (winProb >= WIN_THRESHOLDS.aggressive) {
              attacks.push({ from: t.name, to: e.name, winProb, maxAttacks: 50 });
            }
          }
        }
        // Sort by win probability descending - no artificial limit, attack all viable targets
        return attacks.sort((a, b) => (b.winProb || 0) - (a.winProb || 0));
      },
      fortify(game, player) {
        // Aggressive accepts higher vulnerability (0.60) - prioritizes offense
        return smartFortify(game, player, 0.60);
      }
    },

    defensive: {
      name: "Defensive",
      placeArmies(game, player, armies) {
        const territories = game.getPlayerTerritories(player.id);
        const borders = territories.filter(t => game.getEnemyNeighbors(t.name, player.id).length > 0);
        const threats = borders.map(t => {
          const maxThreat = game.getEnemyNeighbors(t.name, player.id).reduce((max, e) => Math.max(max, e.troops), 0);
          const deficit = maxThreat + 1 - game.territories[t.name].troops;
          return { territory: t, deficit };
        }).sort((a, b) => b.deficit - a.deficit);
        if (threats.length > 0) {
          const placements = []; let remaining = armies;
          for (const t of threats.slice(0, 2)) {
            if (remaining <= 0) break;
            const amt = Math.min(remaining, Math.max(2, t.deficit + 2));
            placements.push({ territory: t.territory.name, amount: amt });
            remaining -= amt;
          }
          if (remaining > 0) {
            const anchor = threats[0]?.territory || territories[0];
            if (anchor) placements.push({ territory: anchor.name, amount: remaining });
          }
          return placements;
        }
        return territories.length > 0 ? [{ territory: territories[0].name, amount: armies }] : [];
      },
      attack(game, player) {
        const attacks = [];
        for (const t of game.getPlayerTerritories(player.id)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops <= 2) continue;
          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            const winProb = getWinProbability(myTroops, e.troops);
            // Defensive: only attacks with 70% win chance
            if (winProb >= WIN_THRESHOLDS.defensive) {
              attacks.push({ from: t.name, to: e.name, winProb, maxAttacks: 50 });
            }
          }
        }
        // No artificial limit - attack all targets meeting threshold
        return attacks.sort((a, b) => (b.winProb || 0) - (a.winProb || 0));
      },
      fortify(game, player) {
        // Defensive is very careful - won't accept more than 40% enemy win chance
        return smartFortify(game, player, 0.40);
      }
    },

    continental: {
      name: "Continental",
      placeArmies(game, player, armies) {
        const target = findContinentTarget(game, player.id);
        if (target) {
          const adjacency = target.owned
            .map(owned => {
              const tData = game.allTerritories.find(t => t.name === owned.name);
              const hits = tData ? target.missing.filter(m => tData.borders.includes(m.name)).length : 0;
              return { territory: owned, hits };
            })
            .sort((a, b) => b.hits - a.hits);
          if (adjacency.length > 0 && adjacency[0].hits > 0) return [{ territory: adjacency[0].territory.name, amount: armies }];
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
            if (tData) {
              for (const m of target.missing) {
                if (tData.borders.includes(m.name)) {
                  const defenderTroops = game.territories[m.name].troops;
                  const winProb = getWinProbability(myTroops, defenderTroops);
                  // Continental: attacks with 50% win chance for continent goals
                  if (winProb >= WIN_THRESHOLDS.continental) {
                    attacks.push({ from: t.name, to: m.name, winProb, maxAttacks: 50 });
                  }
                }
              }
            }
          }
        }
        // Sort continent attacks by win probability
        attacks.sort((a, b) => (b.winProb || 0) - (a.winProb || 0));
        // If few continent targets, also attack other viable targets
        if (attacks.length < 3) attacks.push(...STRATEGIES.aggressive.attack(game, player));
        // No artificial limit - pursue all viable attacks
        return attacks;
      },
      fortify(game, player) {
        // Continental accepts moderate vulnerability (0.50)
        return smartFortify(game, player, 0.50);
      }
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
            const winProb = getWinProbability(myTroops, e.troops);
            // Opportunist: attacks with 50% win chance
            if (winProb >= WIN_THRESHOLDS.opportunist) {
              attacks.push({ from: t.name, to: e.name, winProb, maxAttacks: 50 });
            }
          }
        }
        // No artificial limit - attack all viable targets
        return attacks.sort((a, b) => (b.winProb || 0) - (a.winProb || 0));
      },
      fortify(game, player) {
        // Opportunist accepts moderate vulnerability (0.50)
        return smartFortify(game, player, 0.50);
      }
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
            const winProb = getWinProbability(myTroops, e.troops);
            // Eliminator: attacks with 40% win chance, prioritizes weak players
            if (winProb >= WIN_THRESHOLDS.eliminator) {
              const priority = (counts[e.owner] || 99) <= 3 ? 100 - (counts[e.owner] || 99) : 0;
              attacks.push({ from: t.name, to: e.name, priority, winProb, maxAttacks: 50 });
            }
          }
        }
        // Sort by priority first (weak players), then by win probability - no artificial limit
        return attacks.sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.winProb || 0) - (a.winProb || 0));
      },
      fortify(game, player) {
        // Eliminator accepts higher vulnerability (0.55) - focused on eliminating players
        return smartFortify(game, player, 0.55);
      }
    },

    turtle: {
      name: "Turtle",
      placeArmies(game, player, armies) { return STRATEGIES.defensive.placeArmies(game, player, armies); },
      attack(game, player) {
        const attacks = [];
        for (const t of game.getPlayerTerritories(player.id)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops < 4) continue;
          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            const winProb = getWinProbability(myTroops, e.troops);
            // Turtle: only attacks with 80% win chance (very conservative)
            if (winProb >= WIN_THRESHOLDS.turtle) {
              attacks.push({ from: t.name, to: e.name, winProb, maxAttacks: 10 });
            }
          }
        }
        // Turtle keeps a modest limit - very conservative, only sure things
        return attacks.sort((a, b) => (b.winProb || 0) - (a.winProb || 0)).slice(0, 5);
      },
      fortify(game, player) {
        // Turtle is very defensive - won't accept more than 30% enemy win chance
        return smartFortify(game, player, 0.30);
      }
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
        const attacks = [];
        for (const t of game.getPlayerTerritories(player.id)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops <= 1) continue;
          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            const winProb = getWinProbability(myTroops, e.troops);
            // Balanced: attacks with 50% win chance
            if (winProb >= WIN_THRESHOLDS.balanced) {
              attacks.push({ from: t.name, to: e.name, winProb, maxAttacks: 50 });
            }
          }
        }
        // No artificial limit - attack all viable targets
        return attacks.sort((a, b) => (b.winProb || 0) - (a.winProb || 0));
      },
      fortify(game, player) {
        // Balanced accepts moderate vulnerability (0.45)
        return smartFortify(game, player, 0.45);
      }
    },

    emperor: {
      name: "Emperor",
      placeArmies(game, player, armies) {
        const territories = game.getPlayerTerritories(player.id);
        const target = findContinentTarget(game, player.id);

        // Count territories for each player to find elimination targets
        const playerCounts = {};
        for (const p of game.players) {
          if (!p.eliminated && p.id !== player.id) {
            playerCounts[p.id] = game.getPlayerTerritories(p.id).length;
          }
        }

        // Score each territory for army placement
        const scored = territories.map(t => {
          const tData = game.allTerritories.find(x => x.name === t.name);
          const enemies = game.getEnemyNeighbors(t.name, player.id);
          let score = 0;

          // Bonus for continental targets - high priority
          if (target && tData) {
            const continentHits = target.missing.filter(m => tData.borders.includes(m.name)).length;
            score += continentHits * 30; // Strong bonus for continental completion
          }

          // Bonus for being adjacent to weak players
          for (const enemy of enemies) {
            const ownerCount = playerCounts[enemy.owner] || 99;
            if (ownerCount <= 5) {
              // Higher bonus for weaker players (closer to elimination)
              score += Math.max(0, 25 - (ownerCount * 4));
            }
          }

          // Bonus for favorable attack opportunities (opportunist logic)
          const myTroops = game.territories[t.name].troops + armies;
          for (const enemy of enemies) {
            const ratio = myTroops / (enemy.troops + 1);
            if (ratio > 2) score += 10; // Good attack opportunity
            if (ratio > 3) score += 10; // Great attack opportunity
          }

          // Small bonus for border territories in general
          if (enemies.length > 0) score += 5;

          return { territory: t, score };
        });

        // Sort by score and place armies on highest scored territory
        scored.sort((a, b) => b.score - a.score);

        if (scored.length > 0 && scored[0].score > 0) {
          return [{ territory: scored[0].territory.name, amount: armies }];
        }

        // Fallback to aggressive placement on territory adjacent to weakest enemy
        return STRATEGIES.aggressive.placeArmies(game, player, armies);
      },
      attack(game, player) {
        // Emperor: masterfully combines continental control, player elimination, and opportunism
        const attacks = [];
        const target = findContinentTarget(game, player.id);

        // Count territories for each player
        const playerCounts = {};
        for (const p of game.players) {
          if (!p.eliminated) {
            playerCounts[p.id] = game.getPlayerTerritories(p.id).length;
          }
        }

        // Build set of continental targets for quick lookup
        const continentTargets = new Set();
        if (target) {
          for (const m of target.missing) {
            continentTargets.add(m.name);
          }
        }

        for (const t of game.getPlayerTerritories(player.id).sort((a, b) =>
          game.territories[b.name].troops - game.territories[a.name].troops)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops <= 1) continue;

          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            const winProb = getWinProbability(myTroops, e.troops);

            // Emperor uses lower threshold (35%) - aggressive but calculated
            if (winProb >= 0.35) {
              let priority = 0;

              // HIGHEST: Continental completion attacks (especially last territory)
              if (continentTargets.has(e.name)) {
                const territoriesRemaining = target.missing.length;
                // Bonus scales with how close we are to completion
                priority += 50 + (30 / territoriesRemaining);
                // Extra bonus for last territory in continent
                if (territoriesRemaining === 1) priority += 50;
              }

              // HIGH: Elimination priority (more generous threshold than eliminator)
              const ownerCount = playerCounts[e.owner] || 99;
              if (ownerCount <= 5) {
                // Huge bonus for potential elimination (cards!)
                priority += 40 + Math.max(0, (6 - ownerCount) * 15);
                // Extra bonus if this is their last territory
                if (ownerCount === 1) priority += 100;
              }

              // MEDIUM: Win probability bonus - favor high-probability attacks
              priority += winProb * 25;

              // SMALL: Bonus for attacking weak territories (easy wins for cards)
              if (e.troops <= 2 && winProb >= 0.6) {
                priority += 15; // Easy card acquisition
              }

              attacks.push({ from: t.name, to: e.name, priority, winProb, maxAttacks: 50 });
            }
          }
        }

        // Sort by composite priority score
        return attacks.sort((a, b) => b.priority - a.priority || b.winProb - a.winProb);
      },
      fortify(game, player) {
        const territories = game.getPlayerTerritories(player.id);
        const target = findContinentTarget(game, player.id);

        // If we have a continent target, try to fortify toward it
        if (target) {
          // Find our territories adjacent to missing continent territories
          const adjacentToTarget = territories.filter(t => {
            const tData = game.allTerritories.find(x => x.name === t.name);
            return tData && target.missing.some(m => tData.borders.includes(m.name));
          });

          if (adjacentToTarget.length > 0) {
            // Find the best source of troops
            const potentialSources = territories
              .filter(t => {
                const troops = game.territories[t.name].troops;
                const isInterior = game.getEnemyNeighbors(t.name, player.id).length === 0;
                return troops > 1 && (isInterior || troops > 3);
              })
              .sort((a, b) => {
                const aInterior = game.getEnemyNeighbors(a.name, player.id).length === 0;
                const bInterior = game.getEnemyNeighbors(b.name, player.id).length === 0;
                if (aInterior !== bInterior) return aInterior ? -1 : 1;
                return game.territories[b.name].troops - game.territories[a.name].troops;
              });

            for (const source of potentialSources) {
              for (const dest of adjacentToTarget) {
                if (source.name === dest.name) continue;
                if (game.areConnected(source.name, dest.name, player.id)) {
                  const sourceTroops = game.territories[source.name].troops;
                  const isInterior = game.getEnemyNeighbors(source.name, player.id).length === 0;
                  const moveAmount = isInterior ? sourceTroops - 1 : Math.floor(sourceTroops / 2);
                  if (moveAmount > 0) {
                    return { from: source.name, to: dest.name, amount: moveAmount };
                  }
                }
              }
            }
          }
        }

        // Fallback to smart fortify with higher acceptable vulnerability
        return smartFortify(game, player, 0.60);
      }
    }
  };

  const STRATEGY_NAMES = Object.keys(STRATEGIES);

  window.RiskAI = {
    STRATEGIES,
    STRATEGY_NAMES
  };
})();
