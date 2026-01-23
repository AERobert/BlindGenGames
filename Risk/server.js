// Risk Multiplayer Server
// A WebSocket server for coordinating multiplayer Risk games

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Create HTTP server for serving static files
const server = http.createServer((req, res) => {
  let filePath = '.' + req.url;
  if (filePath === './') filePath = './index.html';

  const extname = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  const contentType = contentTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(500);
        res.end('Server error: ' + error.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Game lobbies storage
const games = new Map();  // gameId -> GameLobby
const clients = new Map(); // ws -> ClientInfo

class GameLobby {
  constructor(id, name, totalPlayers, humanPlayers, hostId, aiStrategies = null) {
    this.id = id;
    this.name = name;
    this.totalPlayers = totalPlayers;
    this.humanPlayers = humanPlayers;
    this.aiPlayers = totalPlayers - humanPlayers;
    this.aiStrategies = aiStrategies;
    this.hostId = hostId;
    this.players = new Map();  // playerId -> PlayerInfo
    this.spectators = new Set();  // clientIds watching
    this.status = 'waiting';  // waiting, playing, finished
    this.gameState = null;
    this.createdAt = Date.now();
    this.playerSlots = [];  // Which player indices are assigned to which clients
    this.currentPlayerClientId = null;  // Which client is currently playing
  }

  addPlayer(clientId, playerName) {
    if (this.players.size >= this.humanPlayers) return false;

    const playerIndex = this.players.size;
    this.players.set(clientId, {
      id: clientId,
      name: playerName,
      playerIndex: playerIndex,
      ready: false,
      connected: true
    });
    this.playerSlots.push({ clientId, playerIndex });
    return true;
  }

  removePlayer(clientId) {
    const player = this.players.get(clientId);
    if (player) {
      player.connected = false;
      // Don't remove during game, just mark disconnected
      if (this.status === 'waiting') {
        this.players.delete(clientId);
        this.playerSlots = this.playerSlots.filter(s => s.clientId !== clientId);
        // Reassign indices
        let idx = 0;
        for (const [cid, p] of this.players) {
          p.playerIndex = idx++;
        }
        this.playerSlots = Array.from(this.players.entries()).map(([cid, p]) => ({
          clientId: cid,
          playerIndex: p.playerIndex
        }));
      }
    }
    this.spectators.delete(clientId);
  }

  isReady() {
    return this.players.size === this.humanPlayers;
  }

  getPlayerByIndex(index) {
    for (const [clientId, player] of this.players) {
      if (player.playerIndex === index) return { clientId, player };
    }
    return null;
  }

  // Get disconnected player slots that can be rejoined
  getOpenSlots() {
    const openSlots = [];
    for (const [clientId, player] of this.players) {
      if (!player.connected) {
        openSlots.push({
          playerIndex: player.playerIndex,
          playerName: player.name,
          originalClientId: clientId
        });
      }
    }
    return openSlots;
  }

  // Check if this game can be rejoined
  canRejoin() {
    return this.status === 'playing' && this.getOpenSlots().length > 0;
  }

  // Rejoin a disconnected player slot
  rejoinPlayer(newClientId, playerName, playerIndex) {
    // Find the disconnected slot
    for (const [oldClientId, player] of this.players) {
      if (player.playerIndex === playerIndex && !player.connected) {
        // Remove old entry
        this.players.delete(oldClientId);
        // Add new entry with new client ID
        player.id = newClientId;
        player.name = playerName;
        player.connected = true;
        this.players.set(newClientId, player);
        // Update playerSlots
        this.playerSlots = this.playerSlots.map(s =>
          s.playerIndex === playerIndex ? { clientId: newClientId, playerIndex } : s
        );
        return player;
      }
    }
    return null;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      totalPlayers: this.totalPlayers,
      humanPlayers: this.humanPlayers,
      aiPlayers: this.aiPlayers,
      currentPlayers: this.players.size,
      connectedPlayers: Array.from(this.players.values()).filter(p => p.connected).length,
      status: this.status,
      createdAt: this.createdAt,
      canRejoin: this.canRejoin(),
      openSlots: this.getOpenSlots(),
      players: Array.from(this.players.values()).map(p => ({
        name: p.name,
        playerIndex: p.playerIndex,
        connected: p.connected
      }))
    };
  }
}

// Generate unique IDs
function generateId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Broadcast to all clients in a game
function broadcastToGame(gameId, message, excludeClientId = null) {
  const game = games.get(gameId);
  if (!game) return;

  const messageStr = JSON.stringify(message);

  for (const [clientId] of game.players) {
    if (clientId !== excludeClientId) {
      const client = findClientById(clientId);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    }
  }

  for (const clientId of game.spectators) {
    if (clientId !== excludeClientId) {
      const client = findClientById(clientId);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    }
  }
}

function findClientById(clientId) {
  for (const [ws, info] of clients) {
    if (info.id === clientId) return ws;
  }
  return null;
}

// Send to specific client
function sendToClient(clientId, message) {
  const client = findClientById(clientId);
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

// Broadcast available games to all clients not in a game
function broadcastGamesList() {
  // Include waiting games AND playing games that can be rejoined
  const gamesList = Array.from(games.values())
    .filter(g => g.status === 'waiting' || g.canRejoin())
    .map(g => g.toJSON());

  const message = { type: 'games_list', games: gamesList };

  for (const [ws, info] of clients) {
    if (!info.gameId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
  const clientId = generateId();
  clients.set(ws, {
    id: clientId,
    gameId: null,
    playerName: null
  });

  console.log(`Client connected: ${clientId}`);

  // Send client their ID and available games (including rejoinable ones)
  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
    games: Array.from(games.values())
      .filter(g => g.status === 'waiting' || g.canRejoin())
      .map(g => g.toJSON())
  }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(ws, message);
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      console.log(`Client disconnected: ${info.id}`);

      if (info.gameId) {
        const game = games.get(info.gameId);
        if (game) {
          game.removePlayer(info.id);

          // Notify other players
          broadcastToGame(info.gameId, {
            type: 'player_left',
            clientId: info.id,
            playerName: info.playerName,
            game: game.toJSON()
          });

          // Clean up empty games
          if (game.players.size === 0 && game.status === 'waiting') {
            games.delete(info.gameId);
          }
        }
      }

      clients.delete(ws);
      broadcastGamesList();
    }
  });
});

function handleMessage(ws, message) {
  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  switch (message.type) {
    case 'create_game':
      handleCreateGame(ws, clientInfo, message);
      break;

    case 'join_game':
      handleJoinGame(ws, clientInfo, message);
      break;

    case 'rejoin_game':
      handleRejoinGame(ws, clientInfo, message);
      break;

    case 'leave_game':
      handleLeaveGame(ws, clientInfo);
      break;

    case 'start_game':
      handleStartGame(ws, clientInfo, message);
      break;

    case 'game_action':
      handleGameAction(ws, clientInfo, message);
      break;

    case 'sync_state':
      handleSyncState(ws, clientInfo, message);
      break;

    case 'chat':
      handleChat(ws, clientInfo, message);
      break;

    case 'get_games':
      ws.send(JSON.stringify({
        type: 'games_list',
        games: Array.from(games.values())
          .filter(g => g.status === 'waiting' || g.canRejoin())
          .map(g => g.toJSON())
      }));
      break;

    default:
      console.log('Unknown message type:', message.type);
  }
}

function handleCreateGame(ws, clientInfo, message) {
  const gameId = generateId();
  const game = new GameLobby(
    gameId,
    message.name || `Game ${gameId}`,
    message.totalPlayers || 3,
    message.humanPlayers || 2,
    clientInfo.id,
    message.aiStrategies || null
  );

  // Creator automatically joins
  game.addPlayer(clientInfo.id, message.playerName);
  clientInfo.gameId = gameId;
  clientInfo.playerName = message.playerName;

  games.set(gameId, game);

  console.log(`Game created: ${gameId} by ${message.playerName}`);

  ws.send(JSON.stringify({
    type: 'game_created',
    game: game.toJSON(),
    yourPlayerIndex: 0
  }));

  broadcastGamesList();
}

function handleJoinGame(ws, clientInfo, message) {
  const game = games.get(message.gameId);

  if (!game) {
    ws.send(JSON.stringify({ type: 'error', message: 'Game not found' }));
    return;
  }

  if (game.status !== 'waiting') {
    ws.send(JSON.stringify({ type: 'error', message: 'Game already started' }));
    return;
  }

  if (!game.addPlayer(clientInfo.id, message.playerName)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Game is full' }));
    return;
  }

  clientInfo.gameId = message.gameId;
  clientInfo.playerName = message.playerName;

  const playerIndex = game.players.get(clientInfo.id).playerIndex;

  console.log(`${message.playerName} joined game ${message.gameId}`);

  ws.send(JSON.stringify({
    type: 'game_joined',
    game: game.toJSON(),
    yourPlayerIndex: playerIndex
  }));

  // Notify others
  broadcastToGame(message.gameId, {
    type: 'player_joined',
    playerName: message.playerName,
    clientId: clientInfo.id,
    game: game.toJSON()
  }, clientInfo.id);

  broadcastGamesList();
}

function handleRejoinGame(ws, clientInfo, message) {
  const game = games.get(message.gameId);

  if (!game) {
    ws.send(JSON.stringify({ type: 'error', message: 'Game not found' }));
    return;
  }

  if (game.status !== 'playing') {
    ws.send(JSON.stringify({ type: 'error', message: 'Game is not in progress' }));
    return;
  }

  if (!game.canRejoin()) {
    ws.send(JSON.stringify({ type: 'error', message: 'No open slots to rejoin' }));
    return;
  }

  // Find the open slot (use specified playerIndex or first available)
  const openSlots = game.getOpenSlots();
  const targetSlot = message.playerIndex !== undefined
    ? openSlots.find(s => s.playerIndex === message.playerIndex)
    : openSlots[0];

  if (!targetSlot) {
    ws.send(JSON.stringify({ type: 'error', message: 'Slot not available' }));
    return;
  }

  // Rejoin the player
  const player = game.rejoinPlayer(clientInfo.id, message.playerName, targetSlot.playerIndex);
  if (!player) {
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to rejoin' }));
    return;
  }

  clientInfo.gameId = message.gameId;
  clientInfo.playerName = message.playerName;

  console.log(`${message.playerName} rejoined game ${message.gameId} as player ${player.playerIndex}`);

  // Send rejoined response with current game state
  ws.send(JSON.stringify({
    type: 'game_rejoined',
    game: game.toJSON(),
    yourPlayerIndex: player.playerIndex,
    gameState: game.gameState
  }));

  // Notify others
  broadcastToGame(message.gameId, {
    type: 'player_rejoined',
    playerName: message.playerName,
    clientId: clientInfo.id,
    playerIndex: player.playerIndex,
    game: game.toJSON()
  }, clientInfo.id);

  broadcastGamesList();
}

function handleLeaveGame(ws, clientInfo) {
  if (!clientInfo.gameId) return;

  const game = games.get(clientInfo.gameId);
  if (game) {
    game.removePlayer(clientInfo.id);

    broadcastToGame(clientInfo.gameId, {
      type: 'player_left',
      clientId: clientInfo.id,
      playerName: clientInfo.playerName,
      game: game.toJSON()
    });

    // Clean up empty waiting games
    if (game.players.size === 0 && game.status === 'waiting') {
      games.delete(clientInfo.gameId);
    }
  }

  clientInfo.gameId = null;
  clientInfo.playerName = null;

  ws.send(JSON.stringify({ type: 'left_game' }));
  broadcastGamesList();
}

function handleStartGame(ws, clientInfo, message) {
  const game = games.get(clientInfo.gameId);

  if (!game) {
    ws.send(JSON.stringify({ type: 'error', message: 'Game not found' }));
    return;
  }

  if (game.hostId !== clientInfo.id) {
    ws.send(JSON.stringify({ type: 'error', message: 'Only host can start' }));
    return;
  }

  if (!game.isReady()) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Waiting for ${game.humanPlayers - game.players.size} more players`
    }));
    return;
  }

  game.status = 'playing';
  game.gameState = message.initialState;

  // Determine which client controls which player based on their join order
  // The host initialized with player assignments already

  console.log(`Game ${game.id} started!`);

  broadcastToGame(clientInfo.gameId, {
    type: 'game_started',
    game: game.toJSON(),
    initialState: message.initialState,
    playerAssignments: message.playerAssignments
  });

  broadcastGamesList();
}

function handleGameAction(ws, clientInfo, message) {
  const game = games.get(clientInfo.gameId);

  if (!game || game.status !== 'playing') return;

  // Validate that this client can make this action
  // (In a production system, you'd verify the action is legal)

  // Broadcast the action to all other players
  broadcastToGame(clientInfo.gameId, {
    type: 'game_action',
    action: message.action,
    data: message.data,
    fromClientId: clientInfo.id,
    fromPlayerName: clientInfo.playerName
  }, clientInfo.id);
}

function handleSyncState(ws, clientInfo, message) {
  const game = games.get(clientInfo.gameId);

  if (!game) return;

  // Update the server's copy of game state
  game.gameState = message.state;

  // Broadcast to all other players
  broadcastToGame(clientInfo.gameId, {
    type: 'sync_state',
    state: message.state,
    fromClientId: clientInfo.id
  }, clientInfo.id);
}

function handleChat(ws, clientInfo, message) {
  if (!clientInfo.gameId) return;

  broadcastToGame(clientInfo.gameId, {
    type: 'chat',
    from: clientInfo.playerName,
    message: message.text
  });
}

// Start server
server.listen(PORT, () => {
  console.log(`Risk Multiplayer Server running on http://localhost:${PORT}`);
  console.log('Open this URL in multiple browser windows to play!');
});
