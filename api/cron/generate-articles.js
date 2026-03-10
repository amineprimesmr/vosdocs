/**
 * Vercel Cron : déclenché tous les 3 jours à 9h UTC.
 * Génère 2 articles via Groq et envoie l'email de propositions.
 * Pas besoin de cron-job.org : Vercel appelle cette fonction directement.
 */
module.exports = async (req, res) => {
  try {
    const blog = require('../../lib/blog');
    await blog.runCronGenerateArticles();
    res.status(200).json({ ok: true, message: 'Articles générés et email envoyé' });
  } catch (e) {
    console.error('Cron generate-articles:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
