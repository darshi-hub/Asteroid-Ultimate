// Simple in-memory state shared by our serverless functions.
// Note: Vercel may create multiple instances/cold starts; this is intentionally
// "temporary" as requested.
const GLOBAL_KEY = '__ASTER_GAME_STATE__';

const state = globalThis[GLOBAL_KEY] || {
  // Map: playerId -> player snapshot
  players: Object.create(null)
};

globalThis[GLOBAL_KEY] = state;

module.exports = { state };

