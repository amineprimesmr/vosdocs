/**
 * Vercel serverless: GET /api/sitemap
 * Génère le sitemap dynamique avec les articles en base.
 */
module.exports = async (req, res) => {
  const { getBlogConfig } = require('../lib/blog-config');
  const baseUrl = getBlogConfig().baseUrl.replace(/\/$/, '');
  const staticUrls = [
    { loc: baseUrl + '/', changefreq: 'weekly', priority: '1.0' },
    { loc: baseUrl + '/conditions-generales-vente.html', changefreq: 'yearly', priority: '0.5' },
    { loc: baseUrl + '/conditions-generales-utilisation.html', changefreq: 'yearly', priority: '0.5' },
    { loc: baseUrl + '/politique-confidentialite.html', changefreq: 'yearly', priority: '0.5' },
    { loc: baseUrl + '/contact.html', changefreq: 'monthly', priority: '0.8' },
    { loc: baseUrl + '/aide.html', changefreq: 'monthly', priority: '0.8' },
    { loc: baseUrl + '/carte-grise.html', changefreq: 'monthly', priority: '0.8' },
    { loc: baseUrl + '/demarches.html', changefreq: 'monthly', priority: '0.9' },
    { loc: baseUrl + '/prix-carte-grise.html', changefreq: 'monthly', priority: '0.8' },
    { loc: baseUrl + '/prix-cheval-fiscal.html', changefreq: 'monthly', priority: '0.8' },
    { loc: baseUrl + '/papiers.html', changefreq: 'monthly', priority: '0.8' },
    { loc: baseUrl + '/mentions-legales.html', changefreq: 'monthly', priority: '0.5' },
    { loc: baseUrl + '/blog', changefreq: 'weekly', priority: '0.8' }
  ];

  let posts = [];
  try {
    const blog = require('../lib/blog');
    posts = await blog.getBlogPosts();
  } catch (_) {}

  const lastmod = new Date().toISOString().slice(0, 10);
  const escapeXml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const urlEntries = [
    ...staticUrls.map((u) => `<url><loc>${escapeXml(u.loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`),
    ...posts.map((p) => `<url><loc>${escapeXml(baseUrl + '/blog/' + encodeURIComponent(p.slug))}</loc><lastmod>${p.publishedAt ? new Date(p.publishedAt).toISOString().slice(0, 10) : lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`)
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">\n${urlEntries.join('\n')}\n</urlset>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.status(200).send(xml);
};
