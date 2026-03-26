// Retained webhook endpoint (not used by the multiplayer logic).
// Converted to CommonJS to match the project `package.json`.
module.exports = function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  console.log('Webhook received:', req.body);

  return res.status(200).json({ ok: true });
};
