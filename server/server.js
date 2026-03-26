// Multiplayer WebSocket server for ASTER.
// MVP scaffolding: rooms, friend codes (in-memory), and periodic snapshot broadcasts.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const engine = require('./server/engine');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const WORLD = 4000;

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function genPlayerId() {
  return Math.random().toString(36).slice(2, 10);
}

function spawnPlanets() {
  const planets = [];
  for (let i = 0; i < 5; i++) {
    planets.push({
      type: 'planet',
      x: rand(0, WORLD),
      y: rand(0, WORLD),
      vx: rand(-0.15, 0.15),
      vy: rand(-0.15, 0.15),
      radius: rand(120, 220),
      angle: 0,
      spin: 0,
      deco: true
    });
  }
  return planets;
}

function spawnAsteroids(level) {
  const count = 8 + level * 4;
  const asteroids = [];
  for (let i = 0; i < count; i++) {
    const r = rand(38, 70);
    asteroids.push({
      type: 'asteroid',
      x: rand(0, WORLD),
      y: rand(0, WORLD),
      vx: rand(-2, 2),
      vy: rand(-2, 2),
      radius: r,
      angle: rand(0, Math.PI * 2),
      spin: rand(-0.03, 0.03),
      hp: r > 55 ? 3 : r > 35 ? 2 : 1
    });
  }
  return asteroids;
}

function spawnUFO(level) {
  // Static-ish MVP spawn; AI/behavior will come from `server/engine.js`.
  const count = 2 + Math.floor(level / 2);
  const ufos = [];
  for (let i = 0; i < count; i++) {
    const side = Math.random() > 0.5 ? 700 : -700;
    const base = WORLD / 2;
    ufos.push({
      type: 'ufo',
      x: base + side,
      y: base + (Math.random() > 0.5 ? side : -side),
      vx: rand(-2, 2),
      vy: rand(-2, 2),
      radius: 32,
      cooldown: 90,
      hp: 3,
      chaseTimer: 0
    });
  }
  return ufos;
}

const rooms = new Map(); // roomCode -> room state
const socketMeta = new Map(); // ws -> { playerId, friendCode, roomCode }
const onlineByFriendCode = new Map(); // friendCode -> { playerId, displayName }
const friendGraph = new Map(); // ownerFriendCode -> Set(friendCodes)

function getFriendSet(ownerCode) {
  let set = friendGraph.get(ownerCode);
  if (!set) {
    set = new Set();
    friendGraph.set(ownerCode, set);
  }
  return set;
}

function isValidWsPayload(obj) {
  return obj && typeof obj === 'object' && typeof obj.type === 'string';
}

function initRoomWorld(room) {
  room.level = 1;
  room.tick = 0;
  room.entities = [];
  engine.initRoom(room);
}

function getPlayerSnapshot(p) {
  return {
    id: p.id,
    displayName: p.displayName,
    friendCode: p.friendCode,
    x: p.x,
    y: p.y,
    angle: p.angle,
    invuln: p.invuln ?? 0,
    hp: p.hp,
    shield: p.shield,
    radius: p.radius,
    weaponIdx: p.weaponIdx
  };
}

function sendJson(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(obj));
}

function broadcastRoomPlayers(room) {
  const players = Array.from(room.players.values()).map(p => ({
    id: p.id,
    displayName: p.displayName
  }));
  room.players.forEach(p => {
    sendJson(p.socket, { type: 'room:players', roomCode: room.code, players });
  });
}

function broadcastSnapshot(room) {
  const playersArr = Array.from(room.players.values()).map(getPlayerSnapshot);

  room.players.forEach(p => {
    sendJson(p.socket, {
      type: 'snapshot',
      tick: room.tick,
      youId: p.id,
      world: {
        score: p.score ?? 0,
        level: room.level,
        entities: room.entities,
        players: playersArr
      }
    });
  });
}

function getOrCreateRoom(code, mode) {
  let room = rooms.get(code);
  if (!room) {
    room = {
      code,
      mode,
      noBoss: mode === 'pvp',
      players: new Map(),
      entities: [],
      score: 0,
      level: 1,
      tick: 0,
      lastPlayersBroadcastAt: 0
    };
    initRoomWorld(room);
    rooms.set(code, room);
  }
  return room;
}

function removeSocketFromRoom(ws) {
  const meta = socketMeta.get(ws);
  if (!meta) return;
  const room = rooms.get(meta.roomCode);
  if (!room) return;

  const p = room.players.get(meta.playerId);
  if (p) {
    room.players.delete(meta.playerId);
    onlineByFriendCode.delete(meta.friendCode);
  }
  socketMeta.delete(ws);

  if (room.players.size === 0) {
    rooms.delete(room.code);
  } else {
    broadcastRoomPlayers(room);
  }
}

const server = http.createServer((req, res) => {
  // Minimal static hosting for easier testing.
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    const html = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }
    if (!isValidWsPayload(msg)) return;

    // Only remove a socket from a previous room when it tries to (re)create/join a room.
    if (msg.type === 'room:create' || msg.type === 'room:join') {
      removeSocketFromRoom(ws);
    }

    if (msg.type === 'room:create') {
      const mode = msg.mode === 'pvp' ? 'pvp' : 'coop';
      const displayName = (msg.displayName || 'Pilot').toString().slice(0, 22);
      const friendCode = (msg.friendCode || '').toString().toUpperCase().slice(0, 10);
      const shipConfig = msg.shipConfig || {};

      // Generate unique room code.
      let code = genCode();
      while (rooms.has(code)) code = genCode();

      const room = getOrCreateRoom(code, mode);
      const playerId = genPlayerId();

      const shipRadius = typeof shipConfig.radius === 'number' ? shipConfig.radius : 28;
      const shipMaxHp = typeof shipConfig.maxHp === 'number' ? shipConfig.maxHp : 100;
      const shipShield = typeof shipConfig.shield === 'number' ? shipConfig.shield : 100;
      const weaponIdx = typeof shipConfig.weaponIdx === 'number' ? shipConfig.weaponIdx : 0;

      const idx = room.players.size;
      const p = {
        id: playerId,
        socket: ws,
        roomCode: code,
        friendCode,
        displayName,
        angle: -Math.PI / 2,
        x: WORLD / 2 + rand(-80, 80),
        y: WORLD / 2 + rand(-80, 80),
        hp: shipMaxHp,
        shield: shipShield,
        radius: shipRadius,
        weaponIdx,
        shipConfig
      };
      engine.initPlayer(p);
      room.players.set(playerId, p);
      socketMeta.set(ws, { playerId, friendCode, roomCode: code });
      onlineByFriendCode.set(friendCode, { playerId, displayName });

      // ACK + broadcast
      sendJson(ws, { type: 'room:created', roomCode: code });
      broadcastRoomPlayers(room);
      broadcastSnapshot(room);
      return;
    }

    if (msg.type === 'room:join') {
      const mode = msg.mode === 'pvp' ? 'pvp' : 'coop';
      const displayName = (msg.displayName || 'Pilot').toString().slice(0, 22);
      const friendCode = (msg.friendCode || '').toString().toUpperCase().slice(0, 10);
      const shipConfig = msg.shipConfig || {};
      const roomCode = (msg.roomCode || '').toString().toUpperCase().slice(0, 10);

      const room = rooms.get(roomCode);
      if (!room) {
        sendJson(ws, { type: 'error', message: 'Room not found' });
        return;
      }

      const playerId = genPlayerId();
      const shipRadius = typeof shipConfig.radius === 'number' ? shipConfig.radius : 28;
      const shipMaxHp = typeof shipConfig.maxHp === 'number' ? shipConfig.maxHp : 100;
      const shipShield = typeof shipConfig.shield === 'number' ? shipConfig.shield : 100;
      const weaponIdx = typeof shipConfig.weaponIdx === 'number' ? shipConfig.weaponIdx : 0;

      const p = {
        id: playerId,
        socket: ws,
        roomCode,
        friendCode,
        displayName,
        angle: -Math.PI / 2,
        x: WORLD / 2 + rand(-80, 80),
        y: WORLD / 2 + rand(-80, 80),
        hp: shipMaxHp,
        shield: shipShield,
        radius: shipRadius,
        weaponIdx,
        shipConfig
      };
      engine.initPlayer(p);
      room.players.set(playerId, p);
      socketMeta.set(ws, { playerId, friendCode, roomCode });
      onlineByFriendCode.set(friendCode, { playerId, displayName });

      sendJson(ws, { type: 'room:joined', roomCode });
      broadcastRoomPlayers(room);
      broadcastSnapshot(room);
      return;
    }

    if (msg.type === 'friend:add') {
      const meta = socketMeta.get(ws);
      if (!meta) {
        sendJson(ws, { type: 'error', message: 'Join a room first' });
        return;
      }
      const owner = meta.friendCode;
      const code = (msg.friendCode || '').toString().toUpperCase().slice(0, 10);
      if (!code) return;
      const set = getFriendSet(owner);
      set.add(code);

      const friends = Array.from(set.values()).map(c => ({
        code: c,
        online: onlineByFriendCode.has(c)
      }));
      sendJson(ws, { type: 'friends:list', friends });
      return;
    }

    if (msg.type === 'input') {
      // MVP: store only; physics/inputs will be applied in `server/engine.js`.
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (!room) return;
      const p = room.players.get(meta.playerId);
      if (!p) return;
      p.lastInput = msg.input || msg.actions || msg;
      return;
    }
  });

  ws.on('close', () => {
    removeSocketFromRoom(ws);
  });
});

// Tick loop for snapshot relay.
setInterval(() => {
  const now = Date.now();
  rooms.forEach(room => {
    engine.stepRoom(room);
    broadcastSnapshot(room);

    // Player list refresh every ~1s.
    if (now - room.lastPlayersBroadcastAt > 1000) {
      room.lastPlayersBroadcastAt = now;
      broadcastRoomPlayers(room);
    }
  });
}, 50);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[ASTER] Server listening on http://localhost:${PORT}`);
});
