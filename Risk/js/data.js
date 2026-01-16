// data.js - All game data (territories, continents, cards, colors)

export const TERRITORIES = [
  // === NORTH AMERICA ===
  // Alaska: Coastal (Pacific, Arctic, Bering Strait). Ocean is correct.
  {"name":"Alaska","borders":["Northwest Territory","Alberta","Kamchatka"],"continent":"North America","directions":{"north":"ocean","northeast":"ocean","east":"Northwest Territory","southeast":"Alberta","south":"ocean","southwest":"ocean","west":"Kamchatka","northwest":"ocean"}},
  // Alberta: Interior Canadian province - landlocked directions are "land"
  {"name":"Alberta","borders":["Alaska","Northwest Territory","Ontario","Western US"],"continent":"North America","directions":{"north":"Northwest Territory","northeast":"land","east":"Ontario","southeast":"land","south":"Western US","southwest":"land","west":"land","northwest":"Alaska"}},
  // Central America: Pacific coast to west/south, Caribbean to east/north
  {"name":"Central America","borders":["Western US","Eastern US","Venezuela"],"continent":"North America","directions":{"north":"land","northeast":"Eastern US","east":"Venezuela","southeast":"ocean","south":"ocean","southwest":"ocean","west":"ocean","northwest":"Western US"}},
  // Eastern Canada (Quebec): Atlantic coast to east, interior to west/south
  {"name":"Eastern Canada","borders":["Ontario","Greenland","Eastern US"],"continent":"North America","directions":{"north":"Greenland","northeast":"ocean","east":"ocean","southeast":"ocean","south":"land","southwest":"Eastern US","west":"Ontario","northwest":"land"}},
  // Eastern US: Atlantic coast to east, interior to west
  {"name":"Eastern US","borders":["Ontario","Eastern Canada","Western US","Central America"],"continent":"North America","directions":{"north":"Ontario","northeast":"Eastern Canada","east":"ocean","southeast":"ocean","south":"land","southwest":"Central America","west":"Western US","northwest":"land"}},
  // Greenland: Island, all ocean is correct.
  {"name":"Greenland","borders":["Northwest Territory","Ontario","Eastern Canada","Iceland"],"continent":"North America","directions":{"north":"ocean","northeast":"ocean","east":"Iceland","southeast":"ocean","south":"Eastern Canada","southwest":"Ontario","west":"Northwest Territory","northwest":"ocean"}},
  // Northwest Territory: Arctic coast to north, interior to southwest
  {"name":"Northwest Territory","borders":["Alaska","Alberta","Ontario","Greenland"],"continent":"North America","directions":{"north":"ocean","northeast":"ocean","east":"Greenland","southeast":"Ontario","south":"Alberta","southwest":"land","west":"Alaska","northwest":"ocean"}},
  // Ontario: Touches Hudson Bay (north), otherwise landlocked
  {"name":"Ontario","borders":["Northwest Territory","Alberta","Greenland","Eastern Canada","Western US","Eastern US"],"continent":"North America","directions":{"north":"ocean","northeast":"Greenland","east":"Eastern Canada","southeast":"land","south":"Eastern US","southwest":"Western US","west":"Alberta","northwest":"Northwest Territory"}},
  // Western US: Pacific coast to west/southwest, interior elsewhere
  {"name":"Western US","borders":["Alberta","Ontario","Eastern US","Central America"],"continent":"North America","directions":{"north":"Alberta","northeast":"Ontario","east":"Eastern US","southeast":"Central America","south":"land","southwest":"ocean","west":"ocean","northwest":"land"}},

  // === SOUTH AMERICA ===
  // Argentina: Atlantic coast to east, Pacific influence to west, Patagonia to south
  {"name":"Argentina","borders":["Peru","Brazil"],"continent":"South America","directions":{"north":"Peru","northeast":"Brazil","east":"ocean","southeast":"ocean","south":"ocean","southwest":"ocean","west":"land","northwest":"land"}},
  // Brazil: Atlantic coast to east/north, interior to west
  {"name":"Brazil","borders":["Venezuela","Peru","Argentina","North Africa"],"continent":"South America","directions":{"north":"ocean","northeast":"ocean","east":"North Africa","southeast":"ocean","south":"land","southwest":"Argentina","west":"Peru","northwest":"Venezuela"}},
  // Peru: Pacific coast to west, interior/Andes to east
  {"name":"Peru","borders":["Venezuela","Brazil","Argentina"],"continent":"South America","directions":{"north":"land","northeast":"Venezuela","east":"Brazil","southeast":"land","south":"Argentina","southwest":"ocean","west":"ocean","northwest":"ocean"}},
  // Venezuela: Caribbean coast to north, interior to south
  {"name":"Venezuela","borders":["Central America","Peru","Brazil"],"continent":"South America","directions":{"north":"ocean","northeast":"ocean","east":"ocean","southeast":"Brazil","south":"land","southwest":"Peru","west":"Central America","northwest":"ocean"}},

  // === EUROPE ===
  // Great Britain: Island, ocean all around except connections
  {"name":"Great Britain","borders":["Iceland","Northern Europe","Scandinavia","Western Europe"],"continent":"Europe","directions":{"north":"ocean","northeast":"Scandinavia","east":"Northern Europe","southeast":"ocean","south":"Western Europe","southwest":"ocean","west":"ocean","northwest":"Iceland"}},
  // Iceland: Island
  {"name":"Iceland","borders":["Greenland","Great Britain","Scandinavia"],"continent":"Europe","directions":{"north":"ocean","northeast":"ocean","east":"Scandinavia","southeast":"Great Britain","south":"ocean","southwest":"ocean","west":"Greenland","northwest":"ocean"}},
  // Northern Europe: Baltic/North Sea coast, interior to south
  {"name":"Northern Europe","borders":["Great Britain","Scandinavia","Russia","Southern Europe","Western Europe"],"continent":"Europe","directions":{"north":"Scandinavia","northeast":"ocean","east":"Russia","southeast":"land","south":"Southern Europe","southwest":"Western Europe","west":"Great Britain","northwest":"ocean"}},
  // Russia: Arctic coast to north, interior elsewhere
  {"name":"Russia","borders":["Scandinavia","Northern Europe","Southern Europe","Middle East","Afghanistan","Ural"],"continent":"Europe","directions":{"north":"ocean","northeast":"Ural","east":"land","southeast":"Afghanistan","south":"Middle East","southwest":"Southern Europe","west":"Northern Europe","northwest":"Scandinavia"}},
  // Scandinavia: North Sea/Baltic/Arctic coast
  {"name":"Scandinavia","borders":["Iceland","Great Britain","Northern Europe","Russia"],"continent":"Europe","directions":{"north":"ocean","northeast":"ocean","east":"ocean","southeast":"Russia","south":"Northern Europe","southwest":"Great Britain","west":"Iceland","northwest":"ocean"}},
  // Southern Europe: Mediterranean coast
  {"name":"Southern Europe","borders":["Western Europe","Northern Europe","Russia","Middle East","Egypt","North Africa"],"continent":"Europe","directions":{"north":"Northern Europe","northeast":"Russia","east":"ocean","southeast":"Middle East","south":"Egypt","southwest":"North Africa","west":"Western Europe","northwest":"land"}},
  // Western Europe: Atlantic/Mediterranean coast
  {"name":"Western Europe","borders":["Great Britain","Northern Europe","Southern Europe","North Africa"],"continent":"Europe","directions":{"north":"Great Britain","northeast":"Northern Europe","east":"Southern Europe","southeast":"ocean","south":"North Africa","southwest":"ocean","west":"ocean","northwest":"ocean"}},

  // === AFRICA ===
  // Central Africa: LANDLOCKED - all impassable directions are "land"
  {"name":"Central Africa","borders":["North Africa","East Africa","South Africa"],"continent":"Africa","directions":{"north":"North Africa","northeast":"land","east":"East Africa","southeast":"land","south":"South Africa","southwest":"land","west":"land","northwest":"land"}},
  // East Africa: Indian Ocean coast to east/southeast
  {"name":"East Africa","borders":["Egypt","North Africa","Central Africa","South Africa","Madagascar","Middle East"],"continent":"Africa","directions":{"north":"Egypt","northeast":"Middle East","east":"ocean","southeast":"Madagascar","south":"ocean","southwest":"South Africa","west":"Central Africa","northwest":"North Africa"}},
  // Egypt: Mediterranean to north, Red Sea to east
  {"name":"Egypt","borders":["Southern Europe","North Africa","East Africa","Middle East"],"continent":"Africa","directions":{"north":"Southern Europe","northeast":"ocean","east":"Middle East","southeast":"land","south":"East Africa","southwest":"land","west":"North Africa","northwest":"ocean"}},
  // Madagascar: Island
  {"name":"Madagascar","borders":["East Africa","South Africa"],"continent":"Africa","directions":{"north":"ocean","northeast":"ocean","east":"ocean","southeast":"ocean","south":"ocean","southwest":"ocean","west":"South Africa","northwest":"East Africa"}},
  // North Africa: Mediterranean to north, Atlantic to west
  {"name":"North Africa","borders":["Western Europe","Southern Europe","Egypt","East Africa","Central Africa","Brazil"],"continent":"Africa","directions":{"north":"Western Europe","northeast":"Southern Europe","east":"Egypt","southeast":"East Africa","south":"Central Africa","southwest":"ocean","west":"Brazil","northwest":"ocean"}},
  // South Africa: Atlantic/Indian Ocean coast
  {"name":"South Africa","borders":["Central Africa","East Africa","Madagascar"],"continent":"Africa","directions":{"north":"Central Africa","northeast":"East Africa","east":"Madagascar","southeast":"ocean","south":"ocean","southwest":"ocean","west":"ocean","northwest":"land"}},

  // === ASIA ===
  // Afghanistan: LANDLOCKED - all impassable directions are "land"
  {"name":"Afghanistan","borders":["Russia","Ural","China","India","Middle East"],"continent":"Asia","directions":{"north":"Ural","northeast":"land","east":"China","southeast":"India","south":"land","southwest":"Middle East","west":"land","northwest":"Russia"}},
  // China: Has some coast (East China Sea), mostly interior
  {"name":"China","borders":["Siberia","Mongolia","Siam","India","Afghanistan","Ural"],"continent":"Asia","directions":{"north":"Mongolia","northeast":"Siberia","east":"ocean","southeast":"ocean","south":"Siam","southwest":"India","west":"Afghanistan","northwest":"Ural"}},
  // India: Indian Ocean coast to south/southwest
  {"name":"India","borders":["Middle East","Afghanistan","China","Siam"],"continent":"Asia","directions":{"north":"land","northeast":"China","east":"land","southeast":"Siam","south":"ocean","southwest":"ocean","west":"Middle East","northwest":"Afghanistan"}},
  // Irkutsk: Landlocked interior Siberia
  {"name":"Irkutsk","borders":["Siberia","Yakutsk","Mongolia","Kamchatka"],"continent":"Asia","directions":{"north":"Siberia","northeast":"Yakutsk","east":"Kamchatka","southeast":"land","south":"Mongolia","southwest":"land","west":"land","northwest":"land"}},
  // Japan: Island
  {"name":"Japan","borders":["Mongolia","Kamchatka"],"continent":"Asia","directions":{"north":"Kamchatka","northeast":"ocean","east":"ocean","southeast":"ocean","south":"ocean","southwest":"ocean","west":"Mongolia","northwest":"ocean"}},
  // Kamchatka: Pacific coast, Bering Strait
  {"name":"Kamchatka","borders":["Alaska","Yakutsk","Irkutsk","Mongolia","Japan"],"continent":"Asia","directions":{"north":"ocean","northeast":"ocean","east":"Alaska","southeast":"ocean","south":"Japan","southwest":"Mongolia","west":"Irkutsk","northwest":"Yakutsk"}},
  // Middle East: Persian Gulf/Red Sea coast
  {"name":"Middle East","borders":["Egypt","East Africa","Russia","Southern Europe","Afghanistan","India"],"continent":"Asia","directions":{"north":"Russia","northeast":"Afghanistan","east":"India","southeast":"ocean","south":"ocean","southwest":"East Africa","west":"Egypt","northwest":"Southern Europe"}},
  // Mongolia: LANDLOCKED - all impassable directions are "land"
  {"name":"Mongolia","borders":["Siberia","Irkutsk","Kamchatka","Japan","China"],"continent":"Asia","directions":{"north":"Irkutsk","northeast":"Kamchatka","east":"Japan","southeast":"land","south":"China","southwest":"land","west":"land","northwest":"Siberia"}},
  // Siam (Thailand): Gulf of Thailand, South China Sea coast
  {"name":"Siam","borders":["China","India","Indonesia"],"continent":"Asia","directions":{"north":"China","northeast":"ocean","east":"ocean","southeast":"Indonesia","south":"ocean","southwest":"ocean","west":"land","northwest":"India"}},
  // Siberia: Arctic coast to north
  {"name":"Siberia","borders":["Ural","Yakutsk","Irkutsk","Mongolia","China"],"continent":"Asia","directions":{"north":"ocean","northeast":"ocean","east":"Yakutsk","southeast":"Mongolia","south":"Irkutsk","southwest":"China","west":"Ural","northwest":"ocean"}},
  // Ural: LANDLOCKED - no coast access
  {"name":"Ural","borders":["Russia","Afghanistan","Siberia","China"],"continent":"Asia","directions":{"north":"land","northeast":"land","east":"Siberia","southeast":"China","south":"Afghanistan","southwest":"Russia","west":"land","northwest":"land"}},
  // Yakutsk: Arctic coast to north
  {"name":"Yakutsk","borders":["Siberia","Irkutsk","Kamchatka"],"continent":"Asia","directions":{"north":"ocean","northeast":"ocean","east":"ocean","southeast":"Kamchatka","south":"land","southwest":"Irkutsk","west":"Siberia","northwest":"ocean"}},

  // === AUSTRALIA ===
  // Eastern Australia: Pacific/Coral Sea coast
  {"name":"Eastern Australia","borders":["Indonesia","New Guinea","Western Australia"],"continent":"Australia","directions":{"north":"New Guinea","northeast":"ocean","east":"ocean","southeast":"ocean","south":"ocean","southwest":"ocean","west":"Western Australia","northwest":"Indonesia"}},
  // Indonesia: Archipelago with seas all around
  {"name":"Indonesia","borders":["Siam","New Guinea","Eastern Australia"],"continent":"Australia","directions":{"north":"ocean","northeast":"ocean","east":"New Guinea","southeast":"Eastern Australia","south":"ocean","southwest":"ocean","west":"ocean","northwest":"Siam"}},
  // New Guinea: Island with seas all around
  {"name":"New Guinea","borders":["Indonesia","Western Australia","Eastern Australia"],"continent":"Australia","directions":{"north":"ocean","northeast":"ocean","east":"ocean","southeast":"ocean","south":"Eastern Australia","southwest":"Western Australia","west":"Indonesia","northwest":"ocean"}},
  // Western Australia: Indian Ocean coast
  {"name":"Western Australia","borders":["New Guinea","Eastern Australia"],"continent":"Australia","directions":{"north":"ocean","northeast":"New Guinea","east":"Eastern Australia","southeast":"ocean","south":"ocean","southwest":"ocean","west":"ocean","northwest":"ocean"}}
];

export const CARD_TYPES = {
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

export const CONTINENTS = {
  "North America": { count: 9, bonus: 5 },
  "South America": { count: 4, bonus: 2 },
  "Europe": { count: 7, bonus: 5 },
  "Africa": { count: 6, bonus: 3 },
  "Asia": { count: 12, bonus: 7 },
  "Australia": { count: 4, bonus: 2 }
};

export const PLAYER_COLORS = [
  { hex: '#e94560', name: 'Red' },
  { hex: '#4ecca3', name: 'Green' },
  { hex: '#3498db', name: 'Blue' },
  { hex: '#f39c12', name: 'Orange' },
  { hex: '#9b59b6', name: 'Purple' },
  { hex: '#1abc9c', name: 'Teal' }
];

export const STARTING_ARMIES = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };
export const TRADE_VALUES = [4, 6, 8, 10, 12, 15];
export const NAV_KEYS = { 'u':'northwest','i':'north','o':'northeast','j':'west','l':'east','n':'southwest','m':'south',',':'southeast' };

export function findTerritory(name) { return TERRITORIES.find(t => t.name === name); }
