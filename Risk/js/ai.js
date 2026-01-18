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
    emperor: 0.40,       // Aggressive expansion, takes calculated risks
    hyperAggressive: 0.10, // Attacks relentlessly regardless of odds
    hyperDefensive: 0.90   // Only attacks with overwhelming force
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

  /**
   * Find opponents who are close to controlling a continent
   * Returns array of { playerId, continent, territoriesNeeded, territories, totalTroops }
   * sorted by threat level (fewer territories needed = higher threat)
   * @param {object} game - Game state
   * @param {number} excludePlayerId - Player to exclude (current AI)
   * @returns {Array} Array of threat objects
   */
  function findContinentThreats(game, excludePlayerId) {
    const threats = [];

    for (const c in CONTINENTS) {
      const continentTerritories = game.allTerritories.filter(t => t.continent === c);
      const totalInContinent = continentTerritories.length;

      // Group territories by owner
      const ownerCounts = {};
      for (const t of continentTerritories) {
        const owner = game.territories[t.name].owner;
        if (owner !== null && owner !== excludePlayerId) {
          if (!ownerCounts[owner]) ownerCounts[owner] = { territories: [], troops: 0 };
          ownerCounts[owner].territories.push(t.name);
          ownerCounts[owner].troops += game.territories[t.name].troops;
        }
      }

      // Check each opponent's progress toward controlling this continent
      for (const playerId in ownerCounts) {
        const owned = ownerCounts[playerId].territories;
        const territoriesNeeded = totalInContinent - owned.length;

        // Only consider threats if they own at least half the continent or need ≤ 2 territories
        // Small continents (Australia, South America) are especially dangerous
        const isSmallContinent = totalInContinent <= 4;
        const threatThreshold = isSmallContinent ? 1 : Math.floor(totalInContinent / 2);

        if (owned.length >= threatThreshold || territoriesNeeded <= 2) {
          // Calculate which territories this player still needs
          const missingTerritories = continentTerritories
            .filter(t => game.territories[t.name].owner !== parseInt(playerId))
            .map(t => ({
              name: t.name,
              owner: game.territories[t.name].owner,
              troops: game.territories[t.name].troops
            }));

          // Higher priority for:
          // - Fewer territories needed
          // - Smaller continents (easier to complete)
          // - Higher continent bonus
          const urgency = (1 / (territoriesNeeded + 0.5)) *
                          (isSmallContinent ? 2 : 1) *
                          CONTINENTS[c].bonus;

          threats.push({
            playerId: parseInt(playerId),
            continent: c,
            territoriesNeeded,
            ownedTerritories: owned,
            missingTerritories,
            totalTroops: ownerCounts[playerId].troops,
            bonus: CONTINENTS[c].bonus,
            urgency,
            isSmallContinent
          });
        }
      }
    }

    // Sort by urgency (higher = more threatening)
    return threats.sort((a, b) => b.urgency - a.urgency);
  }

  /**
   * Find weak players who can potentially be eliminated
   * Returns array of { playerId, territoryCount, territories, totalTroops, canEliminate }
   * @param {object} game - Game state
   * @param {number} attackerId - Current AI player
   * @returns {Array} Array of weak player info
   */
  function findEliminationTargets(game, attackerId) {
    const targets = [];
    const attackerTerritories = game.getPlayerTerritories(attackerId);

    for (const player of game.players) {
      if (player.eliminated || player.id === attackerId) continue;

      const playerTerritories = game.getPlayerTerritories(player.id);
      const territoryCount = playerTerritories.length;

      // Only consider as elimination target if they have few territories
      if (territoryCount <= 5) {
        // Check which of their territories we can reach
        const reachableTerritories = [];
        let totalDefenderTroops = 0;
        let totalAttackerTroopsAdjacent = 0;

        for (const defT of playerTerritories) {
          const defTroops = game.territories[defT.name].troops;
          totalDefenderTroops += defTroops;

          // Check if we have an adjacent territory to attack from
          const defData = game.allTerritories.find(t => t.name === defT.name);
          if (defData) {
            for (const neighbor of defData.borders) {
              if (game.territories[neighbor]?.owner === attackerId) {
                const attackerTroops = game.territories[neighbor].troops;
                reachableTerritories.push({
                  target: defT.name,
                  defenderTroops: defTroops,
                  attackFrom: neighbor,
                  attackerTroops
                });
                totalAttackerTroopsAdjacent = Math.max(totalAttackerTroopsAdjacent, attackerTroops);
              }
            }
          }
        }

        // Check if elimination is possible (we can reach all their territories)
        const uniqueTargets = [...new Set(reachableTerritories.map(r => r.target))];
        const canEliminate = uniqueTargets.length === territoryCount && reachableTerritories.length > 0;

        // Check for continent threat from this player
        const continentThreats = findContinentThreats(game, attackerId)
          .filter(t => t.playerId === player.id);
        const hasContinentThreat = continentThreats.length > 0;

        targets.push({
          playerId: player.id,
          playerName: player.name,
          territoryCount,
          territories: playerTerritories.map(t => t.name),
          reachableTerritories,
          totalDefenderTroops,
          canEliminate,
          hasContinentThreat,
          continentThreats,
          // Higher priority for fewer territories and continent threats
          priority: (6 - territoryCount) * 10 + (hasContinentThreat ? 50 : 0) + (canEliminate ? 20 : 0)
        });
      }
    }

    return targets.sort((a, b) => b.priority - a.priority);
  }

  const STRATEGIES = {
    aggressive: {
      name: "Aggressive",
      placeArmies(game, player, armies) {
        const territories = game.getPlayerTerritories(player.id);

        // Aggressive still prioritizes elimination - place armies for maximum killing potential
        const elimTargets = findEliminationTargets(game, player.id);
        const priorityTarget = elimTargets.find(t => t.reachableTerritories.length > 0);
        if (priorityTarget) {
          const bestAttack = priorityTarget.reachableTerritories
            .sort((a, b) => b.attackerTroops - a.attackerTroops)[0];
          if (bestAttack) {
            return [{ territory: bestAttack.attackFrom, amount: armies }];
          }
        }

        // Default: place on territory adjacent to weakest enemy
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

        // Aggressive loves eliminating players - check for elimination targets first
        const elimTargets = findEliminationTargets(game, player.id);
        for (const elimTarget of elimTargets) {
          for (const reach of elimTarget.reachableTerritories) {
            const winProb = getWinProbability(reach.attackerTroops, reach.defenderTroops);
            if (winProb >= WIN_THRESHOLDS.aggressive) {
              attacks.push({
                from: reach.attackFrom,
                to: reach.target,
                winProb,
                priority: 50 + (6 - elimTarget.territoryCount) * 10 + (elimTarget.canEliminate ? 30 : 0),
                maxAttacks: 50
              });
            }
          }
        }

        // Then attack everything else
        for (const t of game.getPlayerTerritories(player.id).sort((a, b) => game.territories[b.name].troops - game.territories[a.name].troops)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops <= 1) continue;
          for (const e of game.getEnemyNeighbors(t.name, player.id).sort((a, b) => a.troops - b.troops)) {
            const winProb = getWinProbability(myTroops, e.troops);
            // Aggressive: attacks even with just 25% win chance
            if (winProb >= WIN_THRESHOLDS.aggressive) {
              attacks.push({ from: t.name, to: e.name, winProb, priority: 0, maxAttacks: 50 });
            }
          }
        }
        // Sort by priority then win probability
        return attacks.sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.winProb || 0) - (a.winProb || 0));
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
        // First check if we need to block an opponent's continent completion
        const threats = findContinentThreats(game, player.id);
        const urgentThreat = threats.find(t => t.territoriesNeeded <= 2 && t.isSmallContinent);

        if (urgentThreat) {
          // Find our territory adjacent to their continent that we can reinforce
          for (const missing of urgentThreat.missingTerritories) {
            if (missing.owner === player.id) {
              // We own one of the territories they need - reinforce it!
              return [{ territory: missing.name, amount: armies }];
            }
          }
        }

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
        const attacks = [];

        // PRIORITY 1: Block opponents close to completing small continents
        const threats = findContinentThreats(game, player.id);
        for (const threat of threats) {
          if (threat.territoriesNeeded <= 2) {
            // Attack one of their territories in that continent to block them
            for (const t of game.getPlayerTerritories(player.id)) {
              const myTroops = game.territories[t.name].troops;
              if (myTroops <= 1) continue;
              const tData = game.allTerritories.find(x => x.name === t.name);
              if (tData) {
                for (const enemyT of threat.ownedTerritories) {
                  if (tData.borders.includes(enemyT)) {
                    const defenderTroops = game.territories[enemyT].troops;
                    const winProb = getWinProbability(myTroops, defenderTroops);
                    // More willing to attack to block continent (40% threshold)
                    if (winProb >= 0.40) {
                      attacks.push({
                        from: t.name,
                        to: enemyT,
                        winProb,
                        priority: 100 + threat.urgency * 10, // High priority for blocking
                        maxAttacks: 50
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // PRIORITY 2: Complete our own continent
        const target = findContinentTarget(game, player.id);
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
                  if (winProb >= WIN_THRESHOLDS.continental) {
                    attacks.push({
                      from: t.name,
                      to: m.name,
                      winProb,
                      priority: 80, // High but below blocking
                      maxAttacks: 50
                    });
                  }
                }
              }
            }
          }
        }

        // PRIORITY 3: Eliminate weak players (especially those threatening continents)
        const elimTargets = findEliminationTargets(game, player.id);
        for (const elimTarget of elimTargets) {
          if (elimTarget.canEliminate || elimTarget.hasContinentThreat) {
            for (const reach of elimTarget.reachableTerritories) {
              const winProb = getWinProbability(reach.attackerTroops, reach.defenderTroops);
              if (winProb >= 0.35) {
                attacks.push({
                  from: reach.attackFrom,
                  to: reach.target,
                  winProb,
                  priority: 70 + (elimTarget.canEliminate ? 20 : 0) + (elimTarget.hasContinentThreat ? 15 : 0),
                  maxAttacks: 50
                });
              }
            }
          }
        }

        // Sort by priority first, then win probability
        attacks.sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.winProb || 0) - (a.winProb || 0));

        // If few high-priority targets, also attack other viable targets
        if (attacks.length < 3) attacks.push(...STRATEGIES.aggressive.attack(game, player));

        return attacks;
      },
      fortify(game, player) {
        // Check if we should fortify toward blocking an opponent
        const threats = findContinentThreats(game, player.id);
        const urgentThreat = threats.find(t => t.territoriesNeeded <= 2);

        if (urgentThreat) {
          // Find our territory adjacent to their continent
          const territories = game.getPlayerTerritories(player.id);
          for (const t of territories) {
            const tData = game.allTerritories.find(x => x.name === t.name);
            if (tData) {
              for (const enemyT of urgentThreat.ownedTerritories) {
                if (tData.borders.includes(enemyT)) {
                  // This is a good destination - find troops to move here
                  const sources = territories.filter(s =>
                    s.name !== t.name &&
                    game.territories[s.name].troops > 2 &&
                    game.areConnected(s.name, t.name, player.id)
                  ).sort((a, b) => game.territories[b.name].troops - game.territories[a.name].troops);

                  if (sources.length > 0) {
                    const source = sources[0];
                    const moveAmount = Math.floor((game.territories[source.name].troops - 1) / 2);
                    if (moveAmount > 0) {
                      return { from: source.name, to: t.name, amount: moveAmount };
                    }
                  }
                }
              }
            }
          }
        }

        // Default fortification
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

        // Use the new elimination targets helper
        const elimTargets = findEliminationTargets(game, player.id);

        // Prioritize players who threaten continent control
        const priorityTarget = elimTargets.find(t => t.hasContinentThreat && t.reachableTerritories.length > 0);
        if (priorityTarget) {
          // Place armies on our territory that can attack them
          const bestAttack = priorityTarget.reachableTerritories
            .sort((a, b) => b.attackerTroops - a.attackerTroops)[0];
          if (bestAttack) {
            return [{ territory: bestAttack.attackFrom, amount: armies }];
          }
        }

        // Otherwise find any weak player we can reach
        const anyTarget = elimTargets.find(t => t.reachableTerritories.length > 0);
        if (anyTarget) {
          const bestAttack = anyTarget.reachableTerritories
            .sort((a, b) => b.attackerTroops - a.attackerTroops)[0];
          if (bestAttack) {
            return [{ territory: bestAttack.attackFrom, amount: armies }];
          }
        }

        return STRATEGIES.aggressive.placeArmies(game, player, armies);
      },
      attack(game, player) {
        const attacks = [];

        // Use the new elimination targets helper
        const elimTargets = findEliminationTargets(game, player.id);

        // PRIORITY 1: Eliminate players who threaten continent control
        for (const target of elimTargets.filter(t => t.hasContinentThreat)) {
          for (const reach of target.reachableTerritories) {
            const winProb = getWinProbability(reach.attackerTroops, reach.defenderTroops);
            if (winProb >= 0.30) { // More aggressive threshold for dangerous targets
              attacks.push({
                from: reach.attackFrom,
                to: reach.target,
                priority: 150 + target.priority, // Highest priority
                winProb,
                maxAttacks: 50
              });
            }
          }
        }

        // PRIORITY 2: Eliminate any weak player we can reach
        for (const target of elimTargets.filter(t => t.canEliminate)) {
          for (const reach of target.reachableTerritories) {
            const winProb = getWinProbability(reach.attackerTroops, reach.defenderTroops);
            if (winProb >= WIN_THRESHOLDS.eliminator) {
              attacks.push({
                from: reach.attackFrom,
                to: reach.target,
                priority: 100 + (6 - target.territoryCount) * 10,
                winProb,
                maxAttacks: 50
              });
            }
          }
        }

        // PRIORITY 3: Attack weak players even if we can't eliminate them
        for (const target of elimTargets) {
          for (const reach of target.reachableTerritories) {
            const winProb = getWinProbability(reach.attackerTroops, reach.defenderTroops);
            if (winProb >= WIN_THRESHOLDS.eliminator) {
              attacks.push({
                from: reach.attackFrom,
                to: reach.target,
                priority: 50 + (6 - target.territoryCount) * 5,
                winProb,
                maxAttacks: 50
              });
            }
          }
        }

        // PRIORITY 4: Standard attacks on any enemy
        for (const t of game.getPlayerTerritories(player.id)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops <= 1) continue;
          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            const winProb = getWinProbability(myTroops, e.troops);
            if (winProb >= WIN_THRESHOLDS.eliminator) {
              attacks.push({ from: t.name, to: e.name, priority: 0, winProb, maxAttacks: 50 });
            }
          }
        }

        // Sort by priority first, then by win probability
        return attacks.sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.winProb || 0) - (a.winProb || 0));
      },
      fortify(game, player) {
        // Check if we should fortify toward an elimination target
        const elimTargets = findEliminationTargets(game, player.id);
        const priorityTarget = elimTargets.find(t => t.hasContinentThreat || t.canEliminate);

        if (priorityTarget && priorityTarget.reachableTerritories.length > 0) {
          const territories = game.getPlayerTerritories(player.id);
          // Find our territory adjacent to the target
          const adjacentTerritory = priorityTarget.reachableTerritories[0].attackFrom;

          // Find troops to move there
          const sources = territories.filter(s =>
            s.name !== adjacentTerritory &&
            game.territories[s.name].troops > 3 &&
            game.areConnected(s.name, adjacentTerritory, player.id)
          ).sort((a, b) => game.territories[b.name].troops - game.territories[a.name].troops);

          if (sources.length > 0) {
            const source = sources[0];
            const moveAmount = game.territories[source.name].troops - 2;
            if (moveAmount > 0) {
              return { from: source.name, to: adjacentTerritory, amount: moveAmount };
            }
          }
        }

        // Default: aggressive fortification
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
        // Check for urgent threats first
        const threats = findContinentThreats(game, player.id);
        const urgentThreat = threats.find(t => t.territoriesNeeded <= 2 && t.isSmallContinent);

        if (urgentThreat) {
          // Try to find a territory to block with
          const territories = game.getPlayerTerritories(player.id);
          for (const t of territories) {
            const tData = game.allTerritories.find(x => x.name === t.name);
            if (tData) {
              const canBlock = urgentThreat.ownedTerritories.some(enemyT => tData.borders.includes(enemyT));
              if (canBlock) {
                return [{ territory: t.name, amount: armies }];
              }
            }
          }
        }

        // Check for elimination targets
        const elimTargets = findEliminationTargets(game, player.id);
        const priorityTarget = elimTargets.find(t => t.canEliminate && t.reachableTerritories.length > 0);
        if (priorityTarget) {
          const bestAttack = priorityTarget.reachableTerritories
            .sort((a, b) => b.attackerTroops - a.attackerTroops)[0];
          if (bestAttack) {
            return [{ territory: bestAttack.attackFrom, amount: armies }];
          }
        }

        const target = findContinentTarget(game, player.id);
        if (target) return STRATEGIES.continental.placeArmies(game, player, armies);
        return STRATEGIES.defensive.placeArmies(game, player, armies);
      },
      attack(game, player) {
        const attacks = [];

        // Check for continent threats to block
        const threats = findContinentThreats(game, player.id);

        // PRIORITY 1: Block opponents close to completing small continents
        for (const threat of threats.filter(t => t.territoriesNeeded <= 2 && t.isSmallContinent)) {
          for (const t of game.getPlayerTerritories(player.id)) {
            const myTroops = game.territories[t.name].troops;
            if (myTroops <= 1) continue;
            const tData = game.allTerritories.find(x => x.name === t.name);
            if (tData) {
              for (const enemyT of threat.ownedTerritories) {
                if (tData.borders.includes(enemyT)) {
                  const defenderTroops = game.territories[enemyT].troops;
                  const winProb = getWinProbability(myTroops, defenderTroops);
                  if (winProb >= 0.45) {
                    attacks.push({
                      from: t.name,
                      to: enemyT,
                      winProb,
                      priority: 80 + threat.urgency * 10,
                      maxAttacks: 50
                    });
                  }
                }
              }
            }
          }
        }

        // PRIORITY 2: Eliminate weak players
        const elimTargets = findEliminationTargets(game, player.id);
        for (const elimTarget of elimTargets.filter(t => t.canEliminate)) {
          for (const reach of elimTarget.reachableTerritories) {
            const winProb = getWinProbability(reach.attackerTroops, reach.defenderTroops);
            if (winProb >= WIN_THRESHOLDS.balanced) {
              attacks.push({
                from: reach.attackFrom,
                to: reach.target,
                winProb,
                priority: 60 + (6 - elimTarget.territoryCount) * 10,
                maxAttacks: 50
              });
            }
          }
        }

        // PRIORITY 3: Standard attacks
        for (const t of game.getPlayerTerritories(player.id)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops <= 1) continue;
          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            const winProb = getWinProbability(myTroops, e.troops);
            if (winProb >= WIN_THRESHOLDS.balanced) {
              attacks.push({ from: t.name, to: e.name, winProb, priority: 0, maxAttacks: 50 });
            }
          }
        }

        // Sort by priority first, then win probability
        return attacks.sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.winProb || 0) - (a.winProb || 0));
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

        // Check for urgent threats (opponents close to continent control)
        const threats = findContinentThreats(game, player.id);
        const urgentThreats = threats.filter(t => t.territoriesNeeded <= 2);

        // Check for elimination targets
        const elimTargets = findEliminationTargets(game, player.id);
        const priorityElimTarget = elimTargets.find(t =>
          (t.canEliminate || t.hasContinentThreat) && t.reachableTerritories.length > 0
        );

        // Score each territory for army placement
        const scored = territories.map(t => {
          const tData = game.allTerritories.find(x => x.name === t.name);
          const enemies = game.getEnemyNeighbors(t.name, player.id);
          let score = 0;

          // HIGHEST PRIORITY: Can we eliminate someone with a continent threat?
          if (priorityElimTarget && priorityElimTarget.hasContinentThreat) {
            const isAdjacentToTarget = priorityElimTarget.reachableTerritories
              .some(r => r.attackFrom === t.name);
            if (isAdjacentToTarget) {
              score += 200; // Highest priority
            }
          }

          // HIGH PRIORITY: Block opponent continent completion
          for (const threat of urgentThreats) {
            if (tData) {
              // Check if we can attack their continent from here
              const canAttackContinent = threat.ownedTerritories
                .some(enemyT => tData.borders.includes(enemyT));
              if (canAttackContinent) {
                score += 150 + threat.urgency * 20;
              }
            }
          }

          // MEDIUM-HIGH: Elimination targets (even without continent threat)
          if (priorityElimTarget) {
            const isAdjacentToTarget = priorityElimTarget.reachableTerritories
              .some(r => r.attackFrom === t.name);
            if (isAdjacentToTarget) {
              score += 100 + (6 - priorityElimTarget.territoryCount) * 15;
            }
          }

          // MEDIUM: Complete our own continent
          if (target && tData) {
            const continentHits = target.missing.filter(m => tData.borders.includes(m.name)).length;
            score += continentHits * 40;
          }

          // LOWER: General attack opportunities
          for (const enemy of enemies) {
            const myTroops = game.territories[t.name].troops + armies;
            const ratio = myTroops / (enemy.troops + 1);
            if (ratio > 2) score += 10;
            if (ratio > 3) score += 15;
          }

          // Small bonus for border presence
          if (enemies.length > 0) score += 5;

          return { territory: t, score };
        });

        scored.sort((a, b) => b.score - a.score);

        if (scored.length > 0 && scored[0].score > 0) {
          return [{ territory: scored[0].territory.name, amount: armies }];
        }

        return STRATEGIES.aggressive.placeArmies(game, player, armies);
      },
      attack(game, player) {
        // Emperor: the master strategist - combines all threat analysis
        const attacks = [];
        const target = findContinentTarget(game, player.id);

        // Get threats and elimination targets
        const threats = findContinentThreats(game, player.id);
        const elimTargets = findEliminationTargets(game, player.id);

        // Build set of continental targets for quick lookup
        const continentTargets = new Set();
        if (target) {
          for (const m of target.missing) {
            continentTargets.add(m.name);
          }
        }

        // PRIORITY 1: Eliminate players who threaten continent control
        for (const elimTarget of elimTargets.filter(t => t.hasContinentThreat)) {
          for (const reach of elimTarget.reachableTerritories) {
            const winProb = getWinProbability(reach.attackerTroops, reach.defenderTroops);
            if (winProb >= 0.25) { // Very aggressive for dangerous targets
              attacks.push({
                from: reach.attackFrom,
                to: reach.target,
                priority: 300 + elimTarget.priority,
                winProb,
                maxAttacks: 50
              });
            }
          }
        }

        // PRIORITY 2: Block opponents close to continent control
        for (const threat of threats.filter(t => t.territoriesNeeded <= 2)) {
          for (const t of game.getPlayerTerritories(player.id)) {
            const myTroops = game.territories[t.name].troops;
            if (myTroops <= 1) continue;
            const tData = game.allTerritories.find(x => x.name === t.name);
            if (tData) {
              for (const enemyT of threat.ownedTerritories) {
                if (tData.borders.includes(enemyT)) {
                  const defenderTroops = game.territories[enemyT].troops;
                  const winProb = getWinProbability(myTroops, defenderTroops);
                  if (winProb >= 0.30) {
                    attacks.push({
                      from: t.name,
                      to: enemyT,
                      priority: 200 + threat.urgency * 20,
                      winProb,
                      maxAttacks: 50
                    });
                  }
                }
              }
            }
          }
        }

        // PRIORITY 3: Eliminate any weak player we can
        for (const elimTarget of elimTargets.filter(t => t.canEliminate)) {
          for (const reach of elimTarget.reachableTerritories) {
            const winProb = getWinProbability(reach.attackerTroops, reach.defenderTroops);
            if (winProb >= 0.35) {
              attacks.push({
                from: reach.attackFrom,
                to: reach.target,
                priority: 150 + (6 - elimTarget.territoryCount) * 20,
                winProb,
                maxAttacks: 50
              });
            }
          }
        }

        // PRIORITY 4: Complete our own continent
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
                  if (winProb >= 0.40) {
                    const territoriesRemaining = target.missing.length;
                    attacks.push({
                      from: t.name,
                      to: m.name,
                      priority: 100 + (30 / territoriesRemaining) + (territoriesRemaining === 1 ? 50 : 0),
                      winProb,
                      maxAttacks: 50
                    });
                  }
                }
              }
            }
          }
        }

        // PRIORITY 5: General opportunistic attacks
        for (const t of game.getPlayerTerritories(player.id).sort((a, b) =>
          game.territories[b.name].troops - game.territories[a.name].troops)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops <= 1) continue;

          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            const winProb = getWinProbability(myTroops, e.troops);
            if (winProb >= 0.40) {
              let priority = winProb * 30;
              // Bonus for weak territories (easy card)
              if (e.troops <= 2 && winProb >= 0.7) priority += 20;
              attacks.push({ from: t.name, to: e.name, priority, winProb, maxAttacks: 50 });
            }
          }
        }

        // Sort by priority, then win probability
        return attacks.sort((a, b) => b.priority - a.priority || b.winProb - a.winProb);
      },
      fortify(game, player) {
        const territories = game.getPlayerTerritories(player.id);

        // Check for urgent threats to block
        const threats = findContinentThreats(game, player.id);
        const urgentThreat = threats.find(t => t.territoriesNeeded <= 2);

        // Check for elimination targets to fortify toward
        const elimTargets = findEliminationTargets(game, player.id);
        const priorityElimTarget = elimTargets.find(t =>
          (t.canEliminate || t.hasContinentThreat) && t.reachableTerritories.length > 0
        );

        // PRIORITY 1: Fortify toward blocking a continent threat
        if (urgentThreat) {
          for (const t of territories) {
            const tData = game.allTerritories.find(x => x.name === t.name);
            if (tData) {
              for (const enemyT of urgentThreat.ownedTerritories) {
                if (tData.borders.includes(enemyT)) {
                  // Move troops to this territory for blocking
                  const sources = territories.filter(s =>
                    s.name !== t.name &&
                    game.territories[s.name].troops > 3 &&
                    game.areConnected(s.name, t.name, player.id)
                  ).sort((a, b) => game.territories[b.name].troops - game.territories[a.name].troops);

                  if (sources.length > 0) {
                    const source = sources[0];
                    const moveAmount = game.territories[source.name].troops - 2;
                    if (moveAmount > 0) {
                      return { from: source.name, to: t.name, amount: moveAmount };
                    }
                  }
                }
              }
            }
          }
        }

        // PRIORITY 2: Fortify toward elimination target
        if (priorityElimTarget && priorityElimTarget.reachableTerritories.length > 0) {
          const adjacentTerritory = priorityElimTarget.reachableTerritories
            .sort((a, b) => b.attackerTroops - a.attackerTroops)[0].attackFrom;

          const sources = territories.filter(s =>
            s.name !== adjacentTerritory &&
            game.territories[s.name].troops > 3 &&
            game.areConnected(s.name, adjacentTerritory, player.id)
          ).sort((a, b) => game.territories[b.name].troops - game.territories[a.name].troops);

          if (sources.length > 0) {
            const source = sources[0];
            const moveAmount = game.territories[source.name].troops - 2;
            if (moveAmount > 0) {
              return { from: source.name, to: adjacentTerritory, amount: moveAmount };
            }
          }
        }

        // PRIORITY 3: Fortify toward our continent target
        const target = findContinentTarget(game, player.id);
        if (target) {
          const adjacentToTarget = territories.filter(t => {
            const tData = game.allTerritories.find(x => x.name === t.name);
            return tData && target.missing.some(m => tData.borders.includes(m.name));
          });

          if (adjacentToTarget.length > 0) {
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

        // Default fortification
        return smartFortify(game, player, 0.60);
      }
    },

    hyperAggressive: {
      name: "Hyper Aggressive",
      placeArmies(game, player, armies) {
        const territories = game.getPlayerTerritories(player.id);

        // Prioritize continental targets for placement, but aggressively
        const target = findContinentTarget(game, player.id);
        if (target) {
          // Find territory adjacent to most missing continental territories
          const adjacency = target.owned
            .map(owned => {
              const tData = game.allTerritories.find(t => t.name === owned.name);
              const hits = tData ? target.missing.filter(m => tData.borders.includes(m.name)).length : 0;
              return { territory: owned, hits };
            })
            .sort((a, b) => b.hits - a.hits);
          if (adjacency.length > 0 && adjacency[0].hits > 0) {
            return [{ territory: adjacency[0].territory.name, amount: armies }];
          }
        }

        // Otherwise, place on territory with most enemy neighbors (maximum aggression)
        let bestT = null, maxEnemies = 0;
        for (const t of territories) {
          const enemies = game.getEnemyNeighbors(t.name, player.id);
          if (enemies.length > maxEnemies) {
            maxEnemies = enemies.length;
            bestT = t;
          }
        }

        return bestT ? [{ territory: bestT.name, amount: armies }] :
               territories.length > 0 ? [{ territory: territories[0].name, amount: armies }] : [];
      },
      attack(game, player) {
        const attacks = [];

        // PRIORITY 1: Continental targets - attack even with poor odds
        const target = findContinentTarget(game, player.id);
        if (target) {
          for (const t of game.getPlayerTerritories(player.id)) {
            const myTroops = game.territories[t.name].troops;
            // Hyper aggressive: attacks until only 2 troops left
            if (myTroops <= 2) continue;
            const tData = game.allTerritories.find(x => x.name === t.name);
            if (tData) {
              for (const m of target.missing) {
                if (tData.borders.includes(m.name)) {
                  const defenderTroops = game.territories[m.name].troops;
                  const winProb = getWinProbability(myTroops, defenderTroops);
                  // Attack continental targets with even lower threshold
                  if (winProb >= 0.05 || myTroops > 3) {
                    attacks.push({
                      from: t.name,
                      to: m.name,
                      winProb,
                      priority: 100,
                      maxAttacks: 50,
                      stopAt: 2 // Custom: stop when 2 troops remain
                    });
                  }
                }
              }
            }
          }
        }

        // PRIORITY 2: Block opponent continent completion
        const threats = findContinentThreats(game, player.id);
        for (const threat of threats.filter(t => t.territoriesNeeded <= 3)) {
          for (const t of game.getPlayerTerritories(player.id)) {
            const myTroops = game.territories[t.name].troops;
            if (myTroops <= 2) continue;
            const tData = game.allTerritories.find(x => x.name === t.name);
            if (tData) {
              for (const enemyT of threat.ownedTerritories) {
                if (tData.borders.includes(enemyT)) {
                  const defenderTroops = game.territories[enemyT].troops;
                  const winProb = getWinProbability(myTroops, defenderTroops);
                  attacks.push({
                    from: t.name,
                    to: enemyT,
                    winProb,
                    priority: 90 + threat.urgency * 10,
                    maxAttacks: 50,
                    stopAt: 2
                  });
                }
              }
            }
          }
        }

        // PRIORITY 3: Attack EVERYTHING else - no mercy!
        for (const t of game.getPlayerTerritories(player.id).sort((a, b) =>
          game.territories[b.name].troops - game.territories[a.name].troops)) {
          const myTroops = game.territories[t.name].troops;
          // Only stop when territory has 2 or fewer troops
          if (myTroops <= 2) continue;

          for (const e of game.getEnemyNeighbors(t.name, player.id).sort((a, b) => a.troops - b.troops)) {
            const winProb = getWinProbability(myTroops, e.troops);
            // Attack with even the lowest win probability - only need some chance
            if (winProb >= WIN_THRESHOLDS.hyperAggressive || myTroops > e.troops) {
              attacks.push({
                from: t.name,
                to: e.name,
                winProb,
                priority: 0,
                maxAttacks: 50,
                stopAt: 2
              });
            }
          }
        }

        return attacks.sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.winProb || 0) - (a.winProb || 0));
      },
      fortify(game, player) {
        // Hyper aggressive: accepts very high vulnerability (0.80) - all about offense
        return smartFortify(game, player, 0.80);
      }
    },

    hyperDefensive: {
      name: "Hyper Defensive",
      placeArmies(game, player, armies) {
        const territories = game.getPlayerTerritories(player.id);
        const borders = territories.filter(t => game.getEnemyNeighbors(t.name, player.id).length > 0);

        // Find the most threatened border territories
        const threats = borders.map(t => {
          const enemies = game.getEnemyNeighbors(t.name, player.id);
          const maxThreat = enemies.reduce((max, e) => Math.max(max, e.troops), 0);
          const myTroops = game.territories[t.name].troops;
          const deficit = 10 - myTroops; // Want at least 10 troops per border
          return { territory: t, deficit, maxThreat, myTroops };
        }).sort((a, b) => b.deficit - a.deficit);

        if (threats.length > 0) {
          // Build walls - prioritize territories that need troops to reach 10
          const wallTargets = threats.filter(t => t.myTroops < 10);
          if (wallTargets.length > 0) {
            // Distribute to build walls, prioritizing most vulnerable
            const placements = [];
            let remaining = armies;
            for (const t of wallTargets) {
              if (remaining <= 0) break;
              const needed = Math.min(remaining, t.deficit);
              if (needed > 0) {
                placements.push({ territory: t.territory.name, amount: needed });
                remaining -= needed;
              }
            }
            // If still have remaining, add to strongest wall
            if (remaining > 0 && threats.length > 0) {
              const strongest = threats.sort((a, b) => b.myTroops - a.myTroops)[0];
              placements.push({ territory: strongest.territory.name, amount: remaining });
            }
            return placements.length > 0 ? placements : [{ territory: threats[0].territory.name, amount: armies }];
          }

          // All walls already built - reinforce the most threatened one
          return [{ territory: threats[0].territory.name, amount: armies }];
        }

        // No borders? Place on any territory
        return territories.length > 0 ? [{ territory: territories[0].name, amount: armies }] : [];
      },
      attack(game, player) {
        const attacks = [];
        let hasAttackedOnce = false;

        // PRIORITY 1: Continental targets - but only with overwhelming force
        const target = findContinentTarget(game, player.id);
        if (target) {
          for (const t of game.getPlayerTerritories(player.id)) {
            const myTroops = game.territories[t.name].troops;
            // Hyper defensive: only attacks from territories with 10+ troops
            if (myTroops < 10) continue;
            const tData = game.allTerritories.find(x => x.name === t.name);
            if (tData) {
              for (const m of target.missing) {
                if (tData.borders.includes(m.name)) {
                  const defenderTroops = game.territories[m.name].troops;
                  const winProb = getWinProbability(myTroops, defenderTroops);
                  if (winProb >= WIN_THRESHOLDS.hyperDefensive) {
                    attacks.push({
                      from: t.name,
                      to: m.name,
                      winProb,
                      priority: 100,
                      maxAttacks: 50
                    });
                    hasAttackedOnce = true;
                  }
                }
              }
            }
          }
        }

        // PRIORITY 2: Block opponent continent completion (still need 10+ troops)
        const threats = findContinentThreats(game, player.id);
        for (const threat of threats.filter(t => t.territoriesNeeded <= 2)) {
          for (const t of game.getPlayerTerritories(player.id)) {
            const myTroops = game.territories[t.name].troops;
            if (myTroops < 10) continue;
            const tData = game.allTerritories.find(x => x.name === t.name);
            if (tData) {
              for (const enemyT of threat.ownedTerritories) {
                if (tData.borders.includes(enemyT)) {
                  const defenderTroops = game.territories[enemyT].troops;
                  const winProb = getWinProbability(myTroops, defenderTroops);
                  if (winProb >= WIN_THRESHOLDS.hyperDefensive) {
                    attacks.push({
                      from: t.name,
                      to: enemyT,
                      winProb,
                      priority: 90 + threat.urgency * 10,
                      maxAttacks: 50
                    });
                    hasAttackedOnce = true;
                  }
                }
              }
            }
          }
        }

        // PRIORITY 3: Standard attacks - only with overwhelming odds and 10+ troops
        for (const t of game.getPlayerTerritories(player.id)) {
          const myTroops = game.territories[t.name].troops;
          if (myTroops < 10) continue;

          for (const e of game.getEnemyNeighbors(t.name, player.id)) {
            const winProb = getWinProbability(myTroops, e.troops);
            if (winProb >= WIN_THRESHOLDS.hyperDefensive) {
              attacks.push({
                from: t.name,
                to: e.name,
                winProb,
                priority: 0,
                maxAttacks: 50
              });
              hasAttackedOnce = true;
            }
          }
        }

        // PRIORITY 4: One guaranteed attack per turn for a card (if no other attacks)
        // Find the safest possible attack even if odds aren't great
        if (!hasAttackedOnce && attacks.length === 0) {
          let bestCardAttack = null;
          let bestOdds = 0;

          for (const t of game.getPlayerTerritories(player.id).sort((a, b) =>
            game.territories[b.name].troops - game.territories[a.name].troops)) {
            const myTroops = game.territories[t.name].troops;
            if (myTroops <= 1) continue;

            for (const e of game.getEnemyNeighbors(t.name, player.id).sort((a, b) => a.troops - b.troops)) {
              const winProb = getWinProbability(myTroops, e.troops);
              // For card attack: find best odds available, even if below threshold
              if (winProb > bestOdds) {
                bestOdds = winProb;
                bestCardAttack = {
                  from: t.name,
                  to: e.name,
                  winProb,
                  priority: -10, // Low priority - just for card
                  maxAttacks: 5  // Limited attacks - just try to get the card
                };
              }
            }
          }

          // Only add card attack if odds are reasonable (at least 30%)
          if (bestCardAttack && bestOdds >= 0.30) {
            attacks.push(bestCardAttack);
          }
        }

        return attacks.sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.winProb || 0) - (a.winProb || 0));
      },
      fortify(game, player) {
        const territories = game.getPlayerTerritories(player.id);
        const borders = territories.filter(t => game.getEnemyNeighbors(t.name, player.id).length > 0);

        // Find borders that need wall reinforcement (below 10 troops)
        const weakWalls = borders
          .map(t => ({
            territory: t,
            troops: game.territories[t.name].troops,
            enemies: game.getEnemyNeighbors(t.name, player.id)
          }))
          .filter(t => t.troops < 10)
          .sort((a, b) => a.troops - b.troops);

        if (weakWalls.length > 0) {
          // Find interior territories with excess troops
          const interiors = territories
            .filter(t => game.getEnemyNeighbors(t.name, player.id).length === 0)
            .filter(t => game.territories[t.name].troops > 1)
            .sort((a, b) => game.territories[b.name].troops - game.territories[a.name].troops);

          // Also consider strong borders that can spare troops
          const strongBorders = borders
            .filter(t => game.territories[t.name].troops > 10)
            .sort((a, b) => game.territories[b.name].troops - game.territories[a.name].troops);

          const sources = [...interiors, ...strongBorders];

          for (const source of sources) {
            for (const dest of weakWalls) {
              if (source.name === dest.territory.name) continue;
              if (!game.areConnected(source.name, dest.territory.name, player.id)) continue;

              const sourceTroops = game.territories[source.name].troops;
              const isInterior = game.getEnemyNeighbors(source.name, player.id).length === 0;

              // Interior: move all but 1; Strong border: move down to 10
              const maxMove = isInterior ? sourceTroops - 1 : sourceTroops - 10;
              if (maxMove > 0) {
                return { from: source.name, to: dest.territory.name, amount: maxMove };
              }
            }
          }
        }

        // Default: very conservative fortification (0.20 vulnerability threshold)
        return smartFortify(game, player, 0.20);
      }
    }
  };

  const STRATEGY_NAMES = Object.keys(STRATEGIES);

  window.RiskAI = {
    STRATEGIES,
    STRATEGY_NAMES
  };
})();
