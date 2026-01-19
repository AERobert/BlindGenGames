// map.js - Visual SVG map for sighted players
// This map is aria-hidden and does not affect screen reader users

(() => {
  const { TERRITORIES } = window.RiskData;
  const { G, currentTerritory } = window.RiskState;

  // Territory path definitions - more realistic geography
  // Coordinates are in a 1200x600 viewBox for better detail
  const TERRITORY_PATHS = {
    // === NORTH AMERICA ===
    "Alaska": {
      path: "M 35 80 Q 50 60 75 55 L 95 60 Q 110 70 105 90 L 95 110 Q 80 120 55 115 L 40 100 Q 30 90 35 80 Z",
      labelX: 70, labelY: 85
    },
    "Northwest Territory": {
      path: "M 110 55 L 145 48 Q 180 45 210 50 L 230 60 Q 235 75 225 95 L 200 105 Q 170 110 140 105 L 115 95 Q 105 80 110 55 Z",
      labelX: 170, labelY: 78
    },
    "Greenland": {
      path: "M 300 20 Q 330 15 360 22 L 385 35 Q 395 55 385 80 L 360 95 Q 330 100 305 90 L 290 70 Q 285 40 300 20 Z",
      labelX: 340, labelY: 55
    },
    "Alberta": {
      path: "M 95 115 L 135 108 Q 150 115 150 135 L 145 160 Q 135 175 110 175 L 85 165 Q 80 145 85 125 Q 88 118 95 115 Z",
      labelX: 115, labelY: 142
    },
    "Ontario": {
      path: "M 155 105 L 200 100 Q 230 105 240 125 L 235 155 Q 220 175 185 180 L 155 175 Q 145 160 150 135 Q 152 115 155 105 Z",
      labelX: 192, labelY: 140
    },
    "Eastern Canada": {
      path: "M 240 90 L 280 80 Q 305 85 310 105 L 300 135 Q 280 150 250 145 L 235 130 Q 230 110 240 90 Z",
      labelX: 270, labelY: 115
    },
    "Western US": {
      path: "M 80 180 L 115 175 Q 140 180 145 200 L 140 235 Q 125 255 95 255 L 70 245 Q 60 220 65 195 Q 70 182 80 180 Z",
      labelX: 105, labelY: 215
    },
    "Eastern US": {
      path: "M 150 180 L 185 175 Q 210 185 215 210 L 205 250 Q 185 270 155 265 L 140 250 Q 135 220 145 200 Q 148 185 150 180 Z",
      labelX: 175, labelY: 220
    },
    "Central America": {
      path: "M 90 260 L 130 255 Q 155 265 160 290 L 150 325 Q 130 345 100 340 L 80 320 Q 70 290 75 270 Q 80 262 90 260 Z",
      labelX: 118, labelY: 300
    },

    // === SOUTH AMERICA ===
    "Venezuela": {
      path: "M 165 340 L 210 335 Q 240 345 245 370 L 235 400 Q 215 420 180 415 L 160 395 Q 150 365 160 345 Q 162 340 165 340 Z",
      labelX: 200, labelY: 375
    },
    "Peru": {
      path: "M 155 420 L 190 415 Q 210 425 210 455 L 200 495 Q 180 515 150 510 L 130 485 Q 125 450 135 425 Q 145 418 155 420 Z",
      labelX: 170, labelY: 465
    },
    "Brazil": {
      path: "M 215 375 L 270 365 Q 305 380 310 420 L 295 475 Q 265 505 220 500 L 200 470 Q 195 430 205 395 Q 210 378 215 375 Z",
      labelX: 255, labelY: 435
    },
    "Argentina": {
      path: "M 165 515 L 210 505 Q 240 520 240 555 L 225 595 Q 200 615 165 605 L 145 580 Q 140 545 150 520 Q 158 512 165 515 Z",
      labelX: 192, labelY: 560
    },

    // === EUROPE ===
    "Iceland": {
      path: "M 400 55 Q 420 48 440 55 L 455 70 Q 458 85 448 98 L 425 105 Q 405 102 398 88 L 395 72 Q 395 60 400 55 Z",
      labelX: 425, labelY: 78
    },
    "Scandinavia": {
      path: "M 480 40 Q 510 35 535 45 L 550 65 Q 555 90 545 115 L 520 130 Q 490 135 470 120 L 460 95 Q 460 60 480 40 Z",
      labelX: 505, labelY: 85
    },
    "Great Britain": {
      path: "M 415 115 Q 435 108 450 118 L 460 140 Q 462 160 450 178 L 430 188 Q 410 185 402 168 L 400 145 Q 402 125 415 115 Z",
      labelX: 430, labelY: 150
    },
    "Northern Europe": {
      path: "M 465 125 L 515 118 Q 545 128 550 155 L 540 190 Q 515 210 480 205 L 458 185 Q 450 155 460 135 Q 462 128 465 125 Z",
      labelX: 500, labelY: 162
    },
    "Western Europe": {
      path: "M 400 195 L 445 188 Q 475 200 478 230 L 465 270 Q 440 290 405 285 L 385 260 Q 378 225 388 200 Q 395 193 400 195 Z",
      labelX: 430, labelY: 238
    },
    "Southern Europe": {
      path: "M 480 195 L 530 188 Q 560 200 565 235 L 550 275 Q 520 298 480 292 L 460 265 Q 455 230 468 205 Q 475 195 480 195 Z",
      labelX: 515, labelY: 242
    },
    "Russia": {
      path: "M 555 50 L 620 42 Q 665 50 680 85 L 675 140 Q 655 175 605 185 L 560 180 Q 535 165 535 130 L 540 85 Q 545 58 555 50 Z",
      labelX: 608, labelY: 115
    },

    // === AFRICA ===
    "North Africa": {
      path: "M 385 295 L 470 288 Q 510 300 515 345 L 495 400 Q 455 430 395 420 L 365 385 Q 355 340 370 305 Q 378 295 385 295 Z",
      labelX: 440, labelY: 355
    },
    "Egypt": {
      path: "M 520 290 L 575 282 Q 605 295 610 335 L 595 380 Q 565 405 520 398 L 500 365 Q 495 325 508 300 Q 515 290 520 290 Z",
      labelX: 555, labelY: 340
    },
    "East Africa": {
      path: "M 565 405 L 615 395 Q 645 410 650 455 L 635 510 Q 600 540 555 530 L 535 495 Q 530 450 545 415 Q 555 402 565 405 Z",
      labelX: 590, labelY: 465
    },
    "Central Africa": {
      path: "M 480 425 L 535 418 Q 560 432 560 470 L 545 520 Q 515 545 470 538 L 450 505 Q 445 465 460 435 Q 472 422 480 425 Z",
      labelX: 505, labelY: 478
    },
    "South Africa": {
      path: "M 510 545 L 565 535 Q 595 552 598 595 L 580 640 Q 545 665 500 655 L 480 620 Q 475 580 490 555 Q 502 542 510 545 Z",
      labelX: 540, labelY: 598
    },
    "Madagascar": {
      path: "M 630 530 Q 655 522 672 538 L 682 570 Q 682 600 668 622 L 645 635 Q 622 632 615 610 L 612 575 Q 615 545 630 530 Z",
      labelX: 648, labelY: 580
    },

    // === ASIA - Improved spacing and geography ===
    "Ural": {
      path: "M 685 45 L 745 38 Q 780 50 785 90 L 775 145 Q 750 175 700 168 L 675 145 Q 665 100 675 60 Q 680 48 685 45 Z",
      labelX: 725, labelY: 105
    },
    "Siberia": {
      path: "M 790 35 L 865 28 Q 905 42 910 85 L 895 145 Q 860 178 800 170 L 775 145 Q 770 95 782 55 Q 785 40 790 35 Z",
      labelX: 842, labelY: 100
    },
    "Yakutsk": {
      path: "M 915 28 L 985 22 Q 1020 38 1025 80 L 1010 135 Q 975 165 920 158 L 895 135 Q 890 88 902 50 Q 908 32 915 28 Z",
      labelX: 958, labelY: 90
    },
    "Kamchatka": {
      path: "M 1030 25 L 1095 20 Q 1130 38 1135 82 L 1118 140 Q 1080 172 1025 165 L 1000 140 Q 995 92 1010 52 Q 1020 30 1030 25 Z",
      labelX: 1065, labelY: 95
    },
    "Irkutsk": {
      path: "M 895 165 L 965 158 Q 1000 175 1005 215 L 990 265 Q 955 295 900 288 L 875 260 Q 870 210 882 178 Q 888 165 895 165 Z",
      labelX: 938, labelY: 225
    },
    "Mongolia": {
      path: "M 870 175 L 935 168 Q 970 185 975 225 L 960 275 Q 925 305 870 298 L 845 270 Q 840 220 852 188 Q 862 175 870 175 Z",
      labelX: 908, labelY: 235
    },
    "Japan": {
      path: "M 1040 175 Q 1070 168 1092 185 L 1105 220 Q 1105 260 1088 290 L 1060 305 Q 1035 300 1025 275 L 1020 235 Q 1025 195 1040 175 Z",
      labelX: 1062, labelY: 240
    },
    "Afghanistan": {
      path: "M 680 180 L 740 172 Q 775 190 780 235 L 765 290 Q 730 322 675 315 L 650 285 Q 645 235 658 198 Q 670 180 680 180 Z",
      labelX: 715, labelY: 248
    },
    "China": {
      path: "M 820 210 L 920 200 Q 970 222 978 280 L 958 355 Q 905 398 830 388 L 795 350 Q 785 285 802 235 Q 812 212 820 210 Z",
      labelX: 880, labelY: 298
    },
    "Middle East": {
      path: "M 580 295 L 660 285 Q 700 305 705 360 L 685 425 Q 640 462 575 452 L 550 415 Q 542 355 558 310 Q 570 295 580 295 Z",
      labelX: 625, labelY: 370
    },
    "India": {
      path: "M 710 325 L 785 315 Q 825 338 830 400 L 810 470 Q 765 508 700 498 L 670 458 Q 662 392 680 345 Q 698 322 710 325 Z",
      labelX: 752, labelY: 410
    },
    "Siam": {
      path: "M 835 395 L 905 385 Q 945 408 950 470 L 930 535 Q 885 572 820 562 L 790 522 Q 782 458 800 415 Q 820 392 835 395 Z",
      labelX: 870, labelY: 478
    },

    // === AUSTRALIA ===
    "Indonesia": {
      path: "M 875 495 L 960 482 Q 1005 505 1012 565 L 990 625 Q 940 662 870 650 L 840 610 Q 832 548 852 510 Q 865 492 875 495 Z",
      labelX: 925, labelY: 568
    },
    "New Guinea": {
      path: "M 1025 480 L 1100 468 Q 1140 492 1145 545 L 1125 600 Q 1080 635 1015 625 L 988 590 Q 982 535 1000 498 Q 1015 478 1025 480 Z",
      labelX: 1065, labelY: 545
    },
    "Western Australia": {
      path: "M 925 590 L 1000 578 Q 1040 602 1045 660 L 1025 720 Q 980 758 915 748 L 885 710 Q 878 650 898 608 Q 915 588 925 590 Z",
      labelX: 965, labelY: 668
    },
    "Eastern Australia": {
      path: "M 1050 578 L 1125 565 Q 1165 592 1170 655 L 1148 720 Q 1100 760 1035 750 L 1005 710 Q 998 648 1020 602 Q 1038 575 1050 578 Z",
      labelX: 1088, labelY: 660
    }
  };

  // Continent colors for territory borders
  const CONTINENT_COLORS = {
    "North America": "#f1c40f",
    "South America": "#e74c3c",
    "Europe": "#3498db",
    "Africa": "#e67e22",
    "Asia": "#2ecc71",
    "Australia": "#9b59b6"
  };

  let mapContainer = null;
  let svgElement = null;
  let territoryElements = {};
  let troopLabels = {};
  let initialized = false;

  // Create the SVG map
  function createMap() {
    if (initialized) return;

    mapContainer = document.getElementById('map-container');
    if (!mapContainer) return;

    // Create SVG element with larger viewBox for better detail
    svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgElement.setAttribute('viewBox', '0 0 1200 780');
    svgElement.setAttribute('class', 'risk-map');
    svgElement.setAttribute('aria-hidden', 'true'); // Hidden from screen readers
    svgElement.setAttribute('role', 'img');
    svgElement.setAttribute('focusable', 'false');

    // Create gradient background for ocean
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradient.setAttribute('id', 'ocean-gradient');
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '0%');
    gradient.setAttribute('y2', '100%');

    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', '#1a4a6e');
    gradient.appendChild(stop1);

    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', '#0d2840');
    gradient.appendChild(stop2);

    defs.appendChild(gradient);
    svgElement.appendChild(defs);

    // Create background
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', '0');
    background.setAttribute('y', '0');
    background.setAttribute('width', '1200');
    background.setAttribute('height', '780');
    background.setAttribute('fill', 'url(#ocean-gradient)');
    background.setAttribute('class', 'map-ocean');
    svgElement.appendChild(background);

    // Create subtle ocean texture
    for (let i = 0; i < 8; i++) {
      const wave = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const y = 80 + i * 95;
      wave.setAttribute('d', `M 0 ${y} Q 200 ${y - 15} 400 ${y} T 800 ${y} T 1200 ${y}`);
      wave.setAttribute('stroke', '#1e5580');
      wave.setAttribute('stroke-width', '1');
      wave.setAttribute('fill', 'none');
      wave.setAttribute('opacity', '0.3');
      svgElement.appendChild(wave);
    }

    // Create continent group backgrounds
    const continentGroups = {};
    for (const continent of Object.keys(CONTINENT_COLORS)) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', `continent-${continent.toLowerCase().replace(' ', '-')}`);
      continentGroups[continent] = group;
      svgElement.appendChild(group);
    }

    // Create territory paths
    for (const territory of TERRITORIES) {
      const pathData = TERRITORY_PATHS[territory.name];
      if (!pathData) continue;

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'territory-group');
      group.setAttribute('data-territory', territory.name);

      // Territory path with smooth curves
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData.path);
      path.setAttribute('class', 'territory');
      path.setAttribute('data-territory', territory.name);
      path.setAttribute('stroke', CONTINENT_COLORS[territory.continent]);
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('fill', '#444');
      path.setAttribute('stroke-linejoin', 'round');

      // Add title element for native tooltip on hover
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${territory.name} (${territory.continent})`;
      path.appendChild(title);

      // Add click/touch handler with improved touch support
      let touchStartTime = 0;
      let touchStartPos = { x: 0, y: 0 };

      path.addEventListener('click', (e) => handleTerritoryClick(territory.name, e));

      path.addEventListener('touchstart', (e) => {
        touchStartTime = Date.now();
        if (e.touches.length > 0) {
          touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
      }, { passive: true });

      path.addEventListener('touchend', (e) => {
        const touchDuration = Date.now() - touchStartTime;
        // Check if it was a quick tap and not a drag
        let moved = false;
        if (e.changedTouches.length > 0) {
          const endPos = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
          const distance = Math.sqrt(Math.pow(endPos.x - touchStartPos.x, 2) + Math.pow(endPos.y - touchStartPos.y, 2));
          moved = distance > 10;
        }
        if (touchDuration < 400 && !moved) {
          e.preventDefault();
          handleTerritoryClick(territory.name, e);
        }
      });

      group.appendChild(path);
      territoryElements[territory.name] = path;

      // Create background circle for troop count (better visibility)
      const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      labelBg.setAttribute('cx', pathData.labelX);
      labelBg.setAttribute('cy', pathData.labelY);
      labelBg.setAttribute('r', '16'); // Larger for better readability
      labelBg.setAttribute('class', 'troop-label-bg');
      labelBg.setAttribute('fill', 'rgba(0,0,0,0.6)');
      labelBg.setAttribute('stroke', 'rgba(255,255,255,0.4)');
      labelBg.setAttribute('stroke-width', '1.5');
      group.appendChild(labelBg);

      // Troop count label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', pathData.labelX);
      text.setAttribute('y', pathData.labelY);
      text.setAttribute('class', 'troop-label');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.textContent = '0';

      // Click on label also selects territory
      let labelTouchStart = 0;
      let labelTouchPos = { x: 0, y: 0 };

      text.addEventListener('click', (e) => handleTerritoryClick(territory.name, e));

      text.addEventListener('touchstart', (e) => {
        labelTouchStart = Date.now();
        if (e.touches.length > 0) {
          labelTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
      }, { passive: true });

      text.addEventListener('touchend', (e) => {
        const touchDuration = Date.now() - labelTouchStart;
        let moved = false;
        if (e.changedTouches.length > 0) {
          const endPos = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
          const distance = Math.sqrt(Math.pow(endPos.x - labelTouchPos.x, 2) + Math.pow(endPos.y - labelTouchPos.y, 2));
          moved = distance > 10;
        }
        if (touchDuration < 400 && !moved) {
          e.preventDefault();
          handleTerritoryClick(territory.name, e);
        }
      });

      group.appendChild(text);
      troopLabels[territory.name] = { text, bg: labelBg };

      continentGroups[territory.continent].appendChild(group);
    }

    // Add connection lines between territories (special routes across water)
    const connectionsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    connectionsGroup.setAttribute('class', 'connections');
    connectionsGroup.setAttribute('opacity', '0.4');

    // Special connections (across map)
    const specialConnections = [
      ["Alaska", "Kamchatka"],
      ["Greenland", "Iceland"],
      ["Brazil", "North Africa"],
      ["Western Europe", "North Africa"],
      ["East Africa", "Middle East"],
      ["Siam", "Indonesia"],
      ["Eastern Australia", "New Guinea"],
      ["Indonesia", "New Guinea"]
    ];

    for (const [from, to] of specialConnections) {
      const fromPath = TERRITORY_PATHS[from];
      const toPath = TERRITORY_PATHS[to];
      if (fromPath && toPath) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // Use curved lines for water routes
        const midX = (fromPath.labelX + toPath.labelX) / 2;
        const midY = (fromPath.labelY + toPath.labelY) / 2 - 20;
        line.setAttribute('d', `M ${fromPath.labelX} ${fromPath.labelY} Q ${midX} ${midY} ${toPath.labelX} ${toPath.labelY}`);
        line.setAttribute('stroke', '#88aacc');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke-dasharray', '8,4');
        connectionsGroup.appendChild(line);
      }
    }

    svgElement.insertBefore(connectionsGroup, svgElement.querySelector('g'));

    // Add legend
    const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    legend.setAttribute('class', 'map-legend');
    legend.setAttribute('transform', 'translate(15, 745)');

    let legendX = 0;
    for (const [continent, color] of Object.entries(CONTINENT_COLORS)) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', legendX);
      rect.setAttribute('y', '0');
      rect.setAttribute('width', '16');
      rect.setAttribute('height', '16');
      rect.setAttribute('fill', color);
      rect.setAttribute('rx', '3');
      rect.setAttribute('stroke', '#fff');
      rect.setAttribute('stroke-width', '1');
      legend.appendChild(rect);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', legendX + 22);
      text.setAttribute('y', '13');
      text.setAttribute('class', 'legend-text');
      text.setAttribute('fill', '#ccc');
      text.setAttribute('font-size', '13');
      text.textContent = continent;
      legend.appendChild(text);

      legendX += continent.length * 8 + 45;
    }

    svgElement.appendChild(legend);

    mapContainer.appendChild(svgElement);
    initialized = true;
  }

  // Handle territory click
  function handleTerritoryClick(territoryName, event) {
    event.stopPropagation();

    const idx = TERRITORIES.findIndex(t => t.name === territoryName);
    if (idx >= 0) {
      G.currentTerritoryIdx = idx;

      // Play move sound and announce
      const sounds = window.RiskSounds;
      const speech = window.RiskSpeech;
      if (sounds) sounds.play('move');

      // Update UI
      const ui = window.RiskUI;
      if (ui) {
        ui.updateUI();
        ui.announceTerritory();
      }
    }
  }

  // Update map to reflect current game state
  function updateMap() {
    if (!initialized) {
      createMap();
      if (!initialized) return;
    }

    const current = currentTerritory();
    const currentName = current?.name;

    for (const territory of TERRITORIES) {
      const path = territoryElements[territory.name];
      const labelData = troopLabels[territory.name];
      if (!path || !labelData) continue;

      const { text: label, bg: labelBg } = labelData;
      const terState = G.territories[territory.name];
      const owner = terState?.owner !== null && terState?.owner !== undefined
        ? G.players[terState.owner]
        : null;

      // Update territory color based on owner
      if (owner) {
        path.setAttribute('fill', owner.color);
        path.setAttribute('fill-opacity', '0.85');
      } else {
        path.setAttribute('fill', '#555');
        path.setAttribute('fill-opacity', '0.5');
      }

      // Update troop count
      const troops = terState?.troops || 0;
      label.textContent = troops > 0 ? troops.toString() : '';

      // Update tooltip with current info
      const titleEl = path.querySelector('title');
      if (titleEl) {
        const ownerName = owner ? owner.name : 'Unclaimed';
        const troopText = troops > 0 ? ` - ${troops} troops` : '';
        titleEl.textContent = `${territory.name} (${territory.continent})\n${ownerName}${troopText}`;
      }

      // Show/hide label background based on troops
      if (troops > 0) {
        labelBg.setAttribute('opacity', '1');
      } else {
        labelBg.setAttribute('opacity', '0');
      }

      // Adjust label color based on background
      if (owner) {
        const isLight = isLightColor(owner.color);
        label.setAttribute('fill', '#fff');
        labelBg.setAttribute('fill', isLight ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)');
      } else {
        label.setAttribute('fill', '#aaa');
      }

      // Selection states
      path.classList.remove('selected', 'attack-source', 'fortify-source', 'enemy-target', 'friendly-target');

      if (territory.name === currentName) {
        path.classList.add('selected');
      }

      if (G.attackFrom === territory.name) {
        path.classList.add('attack-source');
      }

      if (G.fortifyFrom === territory.name) {
        path.classList.add('fortify-source');
      }

      // Highlight targets based on phase
      if (G.attackFrom && G.phase === 'attack') {
        const { getEnemyNeighbors } = window.RiskState;
        const enemies = getEnemyNeighbors(G.attackFrom, G.players[G.currentPlayer]?.id);
        if (enemies.some(e => e.name === territory.name)) {
          path.classList.add('enemy-target');
        }
      }

      if (G.fortifyFrom && G.phase === 'fortify') {
        const { areConnected } = window.RiskState;
        const playerId = G.players[G.currentPlayer]?.id;
        if (terState?.owner === playerId && territory.name !== G.fortifyFrom) {
          if (areConnected(G.fortifyFrom, territory.name, playerId)) {
            path.classList.add('friendly-target');
          }
        }
      }
    }
  }

  // Check if a color is light (for contrast)
  function isLightColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  }

  // Toggle map visibility
  function toggleMap() {
    if (mapContainer) {
      mapContainer.classList.toggle('hidden');
      const isVisible = !mapContainer.classList.contains('hidden');
      localStorage.setItem('riskMapVisible', isVisible ? 'true' : 'false');
      return isVisible;
    }
    return false;
  }

  // Check if map is visible
  function isMapVisible() {
    return mapContainer && !mapContainer.classList.contains('hidden');
  }

  // Initialize map based on saved preference
  function initMapVisibility() {
    const saved = localStorage.getItem('riskMapVisible');
    // Default to visible for sighted users
    if (saved === 'false' && mapContainer) {
      mapContainer.classList.add('hidden');
    }
  }

  // Expose to window
  window.RiskMap = {
    createMap,
    updateMap,
    toggleMap,
    isMapVisible,
    initMapVisibility
  };
})();
