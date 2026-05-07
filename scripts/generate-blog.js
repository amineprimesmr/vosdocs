#!/usr/bin/env node
/**
 * Génère les pages du blog à partir de content/blog-articles.json
 * Usage: node scripts/generate-blog.js
 * Les pages sont écrites dans public/blog/
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const OUT_DIR = path.join(ROOT, 'public', 'blog');

const config = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'blog-config.json'), 'utf8'));
let articles = [];
try {
  articles = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'blog-articles.json'), 'utf8'));
} catch (e) {
  console.warn('blog-articles.json non trouvé ou vide');
}

const categories = config.categories || {};
const baseUrl = config.baseUrl || 'https://www.carvinguard.fr';
const blogPath = config.blogPath || '/blog';

// Trier par date décroissante
articles.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

function navHtml(active) {
  const blogActive = active === 'blog' ? ' nav-link-active' : '';
  return `
    <nav class="nav-main">
      <a href="../index.html#nos-atouts" class="nav-link">Service</a>
      <a href="../index.html#avis-clients" class="nav-link">Avis clients</a>
      <a href="../index.html#vehicules" class="nav-link">Véhicules</a>
      <a href="../index.html#quest-ce" class="nav-link">Qu'est-ce que c'est ?</a>
      <a href="../index.html#comment-faire" class="nav-link">Comment faire</a>
      <a href="../guides.html" class="nav-link">Guides</a>
      <a href="index.html" class="nav-link${blogActive}">Blog</a>
    </nav>
    <a href="../contact.html" class="btn btn-contact">Contact</a>`;
}

function mobileNavHtml(active) {
  const blogActive = active === 'blog' ? ' nav-link-active' : '';
  return `
    <a href="../index.html#nos-atouts" class="mobile-nav-link">Service</a>
    <a href="../index.html#avis-clients" class="mobile-nav-link">Avis clients</a>
    <a href="../index.html#vehicules" class="mobile-nav-link">Véhicules</a>
    <a href="../index.html#quest-ce" class="mobile-nav-link">Qu'est-ce que c'est ?</a>
    <a href="../index.html#comment-faire" class="mobile-nav-link">Comment faire</a>
    <a href="../guides.html" class="mobile-nav-link">Guides</a>
    <a href="index.html" class="mobile-nav-link${blogActive}">Blog</a>
    <a href="../contact.html" class="mobile-nav-link mobile-nav-contact">Contact</a>`;
}

function headBlock(title, description, canonical, isArticle, article) {
  const ogImage = baseUrl + '/og-image.png';
  let schema = '';
  if (isArticle && article) {
    schema = `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": ${JSON.stringify(article.title)},
      "description": ${JSON.stringify(description)},
      "datePublished": "${article.date}",
      "author": { "@type": "Organization", "name": "Carvinguard" },
      "publisher": { "@type": "Organization", "name": "Carvinguard", "url": "${baseUrl}" }
    }
    </script>`;
  }
  return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="${isArticle ? 'article' : 'website'}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${ogImage}">
    <meta property="og:locale" content="fr_FR">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <link rel="icon" type="image/png" href="/newlogo.png">
    <link rel="stylesheet" href="../css/styles.css">
    <link rel="stylesheet" href="../css/blog.css">
    <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="../js/analytics.js"></script>
    <script async src="https://www.googletagmanager.com/gtag/js?id=AW-17972633421"></script>
    <script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', 'AW-17972633421');</script>
    ${schema}`;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------- Index page ----------
function buildIndex() {
  const title = config.seo?.indexTitle || config.title + ' | Carvinguard';
  const description = config.seo?.indexDescription || config.subtitle;
  const canonical = baseUrl + blogPath + '/';

  const categoryList = Object.entries(categories).map(([key, label]) =>
    `<button type="button" class="blog-filter-btn" data-category="${key}">${escapeHtml(label)}</button>`
  ).join('\n                ');

  const cards = articles.map(a => {
    const catLabel = categories[a.category] || a.category;
    return `
                <article class="blog-card" data-category="${escapeHtml(a.category)}">
                  <div class="blog-card-inner">
                    <span class="blog-card-cat">${escapeHtml(catLabel)}</span>
                    <h2 class="blog-card-title"><a href="${escapeHtml(a.slug)}.html">${escapeHtml(a.title)}</a></h2>
                    <p class="blog-card-desc">${escapeHtml(a.description)}</p>
                    <div class="blog-card-meta">
                      <time datetime="${a.date}">${formatDate(a.date)}</time>
                      ${a.readingTime ? `<span class="blog-card-time">${escapeHtml(a.readingTime)}</span>` : ''}
                    </div>
                    <a href="${escapeHtml(a.slug)}.html" class="blog-card-link">Lire l'article →</a>
                  </div>
                </article>`;
  }).join('');

  const articlesJson = JSON.stringify(articles.map(a => ({
    slug: a.slug,
    title: a.title,
    description: a.description,
    date: a.date,
    category: a.category,
    readingTime: a.readingTime
  })));

  return `<!DOCTYPE html>
<html lang="fr">
<head>
${headBlock(title, description, canonical, false)}
</head>
<body>
  <a href="#blog-main" class="skip-link">Aller au contenu</a>
  <header class="header header-light blog-header">
    <div class="container header-inner">
      <a href="../index.html" class="logo"><img src="/newlogo.png" alt="Carvinguard"></a>
      <button type="button" class="menu-toggle" aria-label="Ouvrir le menu" aria-expanded="false"><span></span><span></span><span></span></button>
      ${navHtml('blog')}
    </div>
    <div class="mobile-nav" id="mobileNav" aria-hidden="true">
      <nav class="mobile-nav-inner">${mobileNavHtml('blog')}</nav>
    </div>
  </header>

  <main id="blog-main" class="blog-page">
    <div class="container">
      <nav class="breadcrumb" aria-label="Fil d'Ariane">
        <a href="../index.html">Accueil</a> &gt; <span>Blog</span>
      </nav>
      <header class="blog-hero">
        <h1 class="blog-hero-title">${escapeHtml(config.title)}</h1>
        <p class="blog-hero-subtitle">${escapeHtml(config.subtitle)}</p>
      </header>
      <div class="blog-filters" role="group" aria-label="Filtrer par catégorie">
        <button type="button" class="blog-filter-btn is-active" data-category="">Tout</button>
        ${categoryList}
      </div>
      <div class="blog-grid" id="blogGrid">
        ${cards}
      </div>
      <p class="blog-count" id="blogCount" aria-live="polite"></p>
    </div>
  </main>

  <footer class="footer">
    <div class="footer-bottom">
      <div class="container footer-bottom-inner">
        <div class="footer-copyright">
          <p>Copyright © Carvinguard.fr 2026</p>
          <span class="ssl-badge">🔒</span>
        </div>
        <nav class="footer-links">
          <a href="../index.html#comment-faire">Aide</a><span>•</span>
          <a href="../guides.html">Guides</a><span>•</span>
          <a href="index.html">Blog</a><span>•</span>
          <a href="../contact.html">Contact</a><span>•</span>
          <a href="../mentions-legales.html">Mentions légales</a>
        </nav>
      </div>
    </div>
    <div class="footer-disclaimer">
      <div class="container">Le Site et les Services sont proposés à titre privé. Démarches gratuites sur <a href="https://www.service-public.fr" target="_blank" rel="noopener">service-public.fr</a>.</div>
    </div>
  </footer>
  <script>
    (function() {
      var articles = ${articlesJson};
      var grid = document.getElementById('blogGrid');
      var countEl = document.getElementById('blogCount');
      var filterBtns = document.querySelectorAll('.blog-filter-btn');
      function updateFilter(cat) {
        var cards = grid.querySelectorAll('.blog-card');
        var n = 0;
        cards.forEach(function(c) {
          var show = !cat || c.getAttribute('data-category') === cat;
          c.style.display = show ? '' : 'none';
          if (show) n++;
        });
        countEl.textContent = n + ' article' + (n > 1 ? 's' : '');
        filterBtns.forEach(function(b) { b.classList.toggle('is-active', b.getAttribute('data-category') === cat); });
      }
      filterBtns.forEach(function(btn) {
        btn.addEventListener('click', function() { updateFilter(this.getAttribute('data-category')); });
      });
      updateFilter('');
    })();
  </script>
  <script src="../js/main.js"></script>
</body>
</html>`;
}

// ---------- Article page ----------
function buildArticle(article, index) {
  const catLabel = categories[article.category] || article.category;
  const title = article.title + ' | Blog Carvinguard';
  const canonical = baseUrl + blogPath + '/' + article.slug + '.html';

  const related = articles
    .filter(a => a.slug !== article.slug && (a.category === article.category || Math.random() > 0.6))
    .slice(0, 3);

  const relatedHtml = related.length ? `
      <aside class="blog-related" aria-label="Articles similaires">
        <h2 class="blog-related-title">Articles similaires</h2>
        <ul class="blog-related-list">
          ${related.map(a => `<li><a href="${escapeHtml(a.slug)}.html">${escapeHtml(a.title)}</a></li>`).join('')}
        </ul>
      </aside>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
${headBlock(title, article.description, canonical, true, article)}
</head>
<body>
  <a href="#article-body" class="skip-link">Aller au contenu</a>
  <header class="header header-light blog-header">
    <div class="container header-inner">
      <a href="../index.html" class="logo"><img src="/newlogo.png" alt="Carvinguard"></a>
      <button type="button" class="menu-toggle" aria-label="Ouvrir le menu" aria-expanded="false"><span></span><span></span><span></span></button>
      ${navHtml('blog')}
    </div>
    <div class="mobile-nav" id="mobileNav" aria-hidden="true">
      <nav class="mobile-nav-inner">${mobileNavHtml('blog')}</nav>
    </div>
  </header>

  <main class="blog-article-page">
    <article class="blog-article">
      <div class="container container-narrow">
        <nav class="breadcrumb" aria-label="Fil d'Ariane">
          <a href="../index.html">Accueil</a> &gt; <a href="index.html">Blog</a> &gt; <span>${escapeHtml(article.title)}</span>
        </nav>
        <header class="blog-article-header">
          <span class="blog-article-cat">${escapeHtml(catLabel)}</span>
          <h1 class="blog-article-title">${escapeHtml(article.title)}</h1>
          <div class="blog-article-meta">
            <time datetime="${article.date}">${formatDate(article.date)}</time>
            ${article.readingTime ? `<span>${escapeHtml(article.readingTime)} de lecture</span>` : ''}
          </div>
        </header>
        <div id="article-body" class="blog-article-body content-section" itemprop="articleBody">
          ${article.bodyHtml}
        </div>
        <div class="blog-article-cta">
          <p>Besoin d'un rapport VIN à jour ?</p>
          <a href="../index.html" class="btn btn-primary btn-lg">Commander mon rapport — 19,90 €</a>
        </div>
        ${relatedHtml}
      </div>
    </article>
  </main>

  <footer class="footer">
    <div class="footer-bottom">
      <div class="container footer-bottom-inner">
        <div class="footer-copyright">
          <p>Copyright © Carvinguard.fr 2026</p>
          <span class="ssl-badge">🔒</span>
        </div>
        <nav class="footer-links">
          <a href="../index.html#comment-faire">Aide</a><span>•</span>
          <a href="../guides.html">Guides</a><span>•</span>
          <a href="index.html">Blog</a><span>•</span>
          <a href="../contact.html">Contact</a><span>•</span>
          <a href="../mentions-legales.html">Mentions légales</a>
        </nav>
      </div>
    </div>
    <div class="footer-disclaimer">
      <div class="container">Le Site et les Services sont proposés à titre privé. Démarches gratuites sur <a href="https://www.service-public.fr" target="_blank" rel="noopener">service-public.fr</a>.</div>
    </div>
  </footer>
  <script src="../js/main.js"></script>
</body>
</html>`;
}

// ---------- Run ----------
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

fs.writeFileSync(path.join(OUT_DIR, 'index.html'), buildIndex(), 'utf8');
console.log('Written public/blog/index.html');

articles.forEach(a => {
  const out = path.join(OUT_DIR, a.slug + '.html');
  fs.writeFileSync(out, buildArticle(a), 'utf8');
  console.log('Written public/blog/' + a.slug + '.html');
});

console.log('Blog generated: ' + articles.length + ' articles.');
