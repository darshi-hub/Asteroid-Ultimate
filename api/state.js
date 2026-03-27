// /api/state.js
// Returns all current players (non-expired) for rendering.

const { state } = require('./_gameState');

const TTL_MS = 8_000; // Must match api/game.js.

function nowMs() {
  return Date.now();
}

function cleanupExpiredPlayers() {
  const t = nowMs();
  for (const [id, p] of Object.entries(state.players)) {
    if (!p || typeof p.lastSeenAt !== 'number') continue;
    if (t - p.lastSeenAt > TTL_MS) delete state.players[id];
  }
}

module.exports = async function handler(req, res) {
  // Ensure the browser fetches fresh data instead of caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  cleanupExpiredPlayers();

  return res.status(200).json({
    players: Object.values(state.players)
  });
};