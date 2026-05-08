/**
 * Variante serverless (non utilisée sur ce projet) : sur Vercel, `vercel.json`
 * réécrit `/api/*` vers `server.js`, donc c’est la route Express
 * `GET /api/cron/generate-articles` dans server.js qui s’exécute (auth CRON_SECRET ou x-vercel-cron).
 * Ce fichier reste une référence si la réécriture API change un jour.
 */
module.exports = async (req, res) => {
  try {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const fromVercelCron = req.headers['x-vercel-cron'] === '1';
    if (process.env.CRON_SECRET && !fromVercelCron && bearer !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const blog = require('../../lib/blog');
    await blog.runCronGenerateArticles();
    res.status(200).json({ ok: true, message: 'Articles générés et email envoyé' });
  } catch (e) {
    console.error('Cron generate-articles:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
