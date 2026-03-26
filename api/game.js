// /api/game
// Receives player updates from the frontend and stores them in memory.

const { state } = require('./_gameState');

const TTL_MS = 8_000; // Expire players that haven't updated in a while.

function nowMs() {
  return Date.now();
}

function parseJsonBody(req) {
  if (!req || req.body == null) return null;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return req.body;
}

function cleanupExpiredPlayers() {
  const t = nowMs();
  for (const [id, p] of Object.entries(state.players)) {
    if (!p || typeof p.lastSeenAt !== 'number') continue;
    if (t - p.lastSeenAt > TTL_MS) delete state.players[id];
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const body = parseJsonBody(req) || {};

  const playerId = String(body.playerId || '').trim();
  if (!playerId) return res.status(400).json({ error: 'playerId is required' });

  const x = Number(body.x);
  const y = Number(body.y);
  const angle = typeof body.angle === 'number' ? body.angle : Number(body.angle);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'x and y must be numbers' });
  }

  // Keep the snapshot small but include enough fields for rendering.
  state.players[playerId] = {
    id: playerId,
    displayName: typeof body.displayName === 'string' ? body.displayName.slice(0, 22) : undefined,
    friendCode: typeof body.friendCode === 'string' ? body.friendCode.slice(0, 10) : undefined,
    x,
    y,
    angle: Number.isFinite(angle) ? angle : 0,
    radius: Number.isFinite(Number(body.radius)) ? Number(body.radius) : undefined,
    hp: Number.isFinite(Number(body.hp)) ? Number(body.hp) : undefined,
    shield: Number.isFinite(Number(body.shield)) ? Number(body.shield) : undefined,
    invuln: Number.isFinite(Number(body.invuln)) ? Number(body.invuln) : undefined,
    weaponIdx: Number.isFinite(Number(body.weaponIdx)) ? Number(body.weaponIdx) : undefined,
    boost: Number.isFinite(Number(body.boost)) ? Number(body.boost) : undefined,
    boosting: Boolean(body.boosting),
    team: Number.isFinite(Number(body.team)) ? Number(body.team) : undefined,
    lastSeenAt: nowMs()
  };

  cleanupExpiredPlayers();

  return res.status(200).json({ ok: true });
};

