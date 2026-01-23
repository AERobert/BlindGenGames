// network.js - Client-side WebSocket networking for multiplayer Risk

(() => {
  let ws = null;
  let clientId = null;
  let currentGameId = null;
  let myPlayerIndex = null;
  let isHost = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;

  // Callbacks for various events
  const callbacks = {
    onConnected: null,
    onDisconnected: null,
    onGamesList: null,
    onGameCreated: null,
    onGameJoined: null,
    onGameRejoined: null,
    onPlayerJoined: null,
    onPlayerLeft: null,
    onPlayerRejoined: null,
    onGameStarted: null,
    onGameAction: null,
    onSyncState: null,
    onChat: null,
    onError: null
  };

  // Check if we're running on localhost with a server
  function getServerUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const port = window.location.port || '3000';
    return `${protocol}//${host}:${port}`;
  }

  // Check if multiplayer server is available
  function isMultiplayerAvailable() {
    return ws !== null && ws.readyState === WebSocket.OPEN;
  }

  // Connect to the WebSocket server
  function connect(onSuccess, onError) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (onSuccess) onSuccess();
      return;
    }

    const serverUrl = getServerUrl();
    console.log('Connecting to server:', serverUrl);

    try {
      ws = new WebSocket(serverUrl);

      ws.onopen = () => {
        console.log('Connected to multiplayer server');
        reconnectAttempts = 0;
        if (onSuccess) onSuccess();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };

      ws.onclose = (event) => {
        console.log('Disconnected from server:', event.code, event.reason);
        if (callbacks.onDisconnected) {
          callbacks.onDisconnected(event.code, event.reason);
        }

        // Attempt reconnect if we were in a game
        if (currentGameId && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(`Attempting reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          setTimeout(() => connect(), 2000 * reconnectAttempts);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (onError) onError(error);
        if (callbacks.onError) {
          callbacks.onError('Connection failed. Server may not be running.');
        }
      };
    } catch (e) {
      console.error('Failed to connect:', e);
      if (onError) onError(e);
    }
  }

  // Disconnect from server
  function disconnect() {
    if (ws) {
      ws.close();
      ws = null;
    }
    clientId = null;
    currentGameId = null;
    myPlayerIndex = null;
    isHost = false;
  }

  // Handle incoming messages
  function handleMessage(message) {
    switch (message.type) {
      case 'connected':
        clientId = message.clientId;
        console.log('Assigned client ID:', clientId);
        if (callbacks.onConnected) {
          callbacks.onConnected(clientId, message.games);
        }
        break;

      case 'games_list':
        if (callbacks.onGamesList) {
          callbacks.onGamesList(message.games);
        }
        break;

      case 'game_created':
        currentGameId = message.game.id;
        myPlayerIndex = message.yourPlayerIndex;
        isHost = true;
        if (callbacks.onGameCreated) {
          callbacks.onGameCreated(message.game, myPlayerIndex);
        }
        break;

      case 'game_joined':
        currentGameId = message.game.id;
        myPlayerIndex = message.yourPlayerIndex;
        isHost = false;
        if (callbacks.onGameJoined) {
          callbacks.onGameJoined(message.game, myPlayerIndex);
        }
        break;

      case 'player_joined':
        if (callbacks.onPlayerJoined) {
          callbacks.onPlayerJoined(message.playerName, message.clientId, message.game);
        }
        break;

      case 'player_left':
        if (callbacks.onPlayerLeft) {
          callbacks.onPlayerLeft(message.playerName, message.clientId, message.game);
        }
        break;

      case 'game_rejoined':
        currentGameId = message.game.id;
        myPlayerIndex = message.yourPlayerIndex;
        isHost = false;  // Rejoining player is never the host
        if (callbacks.onGameRejoined) {
          callbacks.onGameRejoined(message.game, myPlayerIndex, message.gameState);
        }
        break;

      case 'player_rejoined':
        if (callbacks.onPlayerRejoined) {
          callbacks.onPlayerRejoined(message.playerName, message.clientId, message.playerIndex, message.game);
        }
        break;

      case 'game_started':
        if (callbacks.onGameStarted) {
          callbacks.onGameStarted(message.game, message.initialState, message.playerAssignments);
        }
        break;

      case 'game_action':
        if (callbacks.onGameAction) {
          callbacks.onGameAction(message.action, message.data, message.fromClientId, message.fromPlayerName);
        }
        break;

      case 'sync_state':
        if (callbacks.onSyncState) {
          callbacks.onSyncState(message.state, message.fromClientId);
        }
        break;

      case 'chat':
        if (callbacks.onChat) {
          callbacks.onChat(message.from, message.message);
        }
        break;

      case 'error':
        console.error('Server error:', message.message);
        if (callbacks.onError) {
          callbacks.onError(message.message);
        }
        break;

      case 'left_game':
        currentGameId = null;
        myPlayerIndex = null;
        isHost = false;
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  // Send a message to the server
  function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    console.warn('Cannot send: not connected');
    return false;
  }

  // Create a new game lobby
  function createGame(playerName, gameName, totalPlayers, humanPlayers, aiStrategies = null) {
    return send({
      type: 'create_game',
      playerName,
      name: gameName,
      totalPlayers,
      humanPlayers,
      aiStrategies
    });
  }

  // Join an existing game
  function joinGame(gameId, playerName) {
    return send({
      type: 'join_game',
      gameId,
      playerName
    });
  }

  // Rejoin an ongoing game with a disconnected player slot
  function rejoinGame(gameId, playerName, playerIndex = undefined) {
    return send({
      type: 'rejoin_game',
      gameId,
      playerName,
      playerIndex
    });
  }

  // Leave the current game
  function leaveGame() {
    return send({ type: 'leave_game' });
  }

  // Request current games list
  function getGames() {
    return send({ type: 'get_games' });
  }

  // Start the game (host only)
  function startGame(initialState, playerAssignments) {
    return send({
      type: 'start_game',
      initialState,
      playerAssignments
    });
  }

  // Send a game action (claim, place, attack, etc.)
  function sendAction(action, data) {
    return send({
      type: 'game_action',
      action,
      data
    });
  }

  // Sync full game state
  function syncState(state) {
    return send({
      type: 'sync_state',
      state
    });
  }

  // Send chat message
  function sendChat(text) {
    return send({
      type: 'chat',
      text
    });
  }

  // Set callbacks
  function setCallback(name, fn) {
    if (callbacks.hasOwnProperty(name)) {
      callbacks[name] = fn;
    }
  }

  // Getters
  function getClientId() { return clientId; }
  function getCurrentGameId() { return currentGameId; }
  function getMyPlayerIndex() { return myPlayerIndex; }
  function getIsHost() { return isHost; }
  function isConnected() { return ws && ws.readyState === WebSocket.OPEN; }
  function isInGame() { return currentGameId !== null; }

  // Export
  window.RiskNetwork = {
    connect,
    disconnect,
    isMultiplayerAvailable,
    isConnected,
    isInGame,
    getClientId,
    getCurrentGameId,
    getMyPlayerIndex,
    getIsHost,
    setCallback,
    createGame,
    joinGame,
    rejoinGame,
    leaveGame,
    getGames,
    startGame,
    sendAction,
    syncState,
    sendChat
  };
})();
