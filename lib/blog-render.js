/**
 * Rendu HTML des pages blog (liste, article, confirmation)
 * Utilisé par les routes Express /blog, /blog/:slug, /blog/published
 */

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateObj) {
  if (!dateObj) return '';
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function headBlock(config, title, description, canonical, isArticle, article, basePath = '../') {
  const baseUrl = config.baseUrl || 'https://www.carvinguard.fr';
  const ogImage = baseUrl + '/og-image.png';
  let schema = '';
  if (isArticle && article) {
    const dateStr = article.publishedAt ? new Date(article.publishedAt).toISOString().slice(0, 10) : '';
    schema = `
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Article","headline":${JSON.stringify(article.title)},"description":${JSON.stringify(description)},"datePublished":"${dateStr}","author":{"@type":"Organization","name":"Carvinguard"},"publisher":{"@type":"Organization","name":"Carvinguard","url":"${baseUrl}"}}
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
    <link rel="icon" type="image/svg+xml" href="${escapeHtml(basePath)}favicon.svg">
    <link rel="stylesheet" href="${escapeHtml(basePath)}css/styles.css">
    <link rel="stylesheet" href="${escapeHtml(basePath)}css/blog.css">
    <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="${escapeHtml(basePath)}js/analytics.js"></script>
    <script async src="https://www.googletagmanager.com/gtag/js?id=AW-17972633421"></script>
    <script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', 'AW-17972633421');</script>
    ${schema}`;
}

const navHtml = (basePath, activeBlog) => `
  <nav class="nav-main">
    <a href="${basePath}index.html#nos-atouts" class="nav-link">Service</a>
    <a href="${basePath}index.html#avis-clients" class="nav-link">Avis clients</a>
    <a href="${basePath}index.html#vehicules" class="nav-link">Véhicules</a>
    <a href="${basePath}index.html#quest-ce" class="nav-link">Qu'est-ce que c'est ?</a>
    <a href="${basePath}index.html#comment-faire" class="nav-link">Comment faire</a>
    <a href="${basePath}guides.html" class="nav-link">Guides</a>
    <a href="${basePath}blog" class="nav-link${activeBlog ? ' nav-link-active' : ''}">Blog</a>
  </nav>
  <a href="${basePath}contact.html" class="btn btn-contact">Contact</a>`;

const mobileNavHtml = (basePath, activeBlog) => `
  <a href="${basePath}index.html#nos-atouts" class="mobile-nav-link">Service</a>
  <a href="${basePath}index.html#avis-clients" class="mobile-nav-link">Avis clients</a>
  <a href="${basePath}index.html#vehicules" class="mobile-nav-link">Véhicules</a>
  <a href="${basePath}index.html#quest-ce" class="mobile-nav-link">Qu'est-ce que c'est ?</a>
  <a href="${basePath}index.html#comment-faire" class="mobile-nav-link">Comment faire</a>
  <a href="${basePath}guides.html" class="mobile-nav-link">Guides</a>
  <a href="${basePath}blog" class="mobile-nav-link${activeBlog ? ' nav-link-active' : ''}">Blog</a>
  <a href="${basePath}contact.html" class="mobile-nav-link mobile-nav-contact">Contact</a>`;

const footerHtml = (basePath) => `
  <footer class="footer">
    <div class="footer-bottom">
      <div class="container footer-bottom-inner">
        <div class="footer-copyright">
          <p>Copyright © Carvinguard.fr 2026</p>
          <span class="ssl-badge">🔒</span>
        </div>
        <nav class="footer-links">
          <a href="${basePath}index.html#comment-faire">Aide</a><span>•</span>
          <a href="${basePath}guides.html">Guides</a><span>•</span>
          <a href="${basePath}blog">Blog</a><span>•</span>
          <a href="${basePath}contact.html">Contact</a><span>•</span>
          <a href="${basePath}mentions-legales.html">Mentions légales</a>
        </nav>
      </div>
    </div>
    <div class="footer-disclaimer">
      <div class="container">Le Site et les Services sont proposés à titre privé. Démarches gratuites sur <a href="https://www.service-public.fr" target="_blank" rel="noopener">service-public.fr</a>.</div>
    </div>
  </footer>`;

/**
 * Page liste du blog (/blog)
 */
function renderBlogIndex(config, posts) {
  const baseUrl = config.baseUrl || 'https://www.carvinguard.fr';
  const blogPath = config.blogPath || '/blog';
  const basePath = '../';
  const categories = config.categories || {};
  const title = config.seo?.indexTitle || (config.title || 'Blog') + ' | Carvinguard';
  const description = config.seo?.indexDescription || config.subtitle || '';
  const canonical = baseUrl + blogPath;

  const categoryList = Object.entries(categories).map(([key, label]) =>
    `<button type="button" class="blog-filter-btn" data-category="${escapeHtml(key)}">${escapeHtml(label)}</button>`
  ).join('\n                ');

  const cards = posts.map(p => {
    const catLabel = categories[p.category] || p.category;
    const dateStr = p.publishedAt ? formatDate(p.publishedAt) : '';
    return `
                <article class="blog-card" data-category="${escapeHtml(p.category)}">
                  <div class="blog-card-inner">
                    <span class="blog-card-cat">${escapeHtml(catLabel)}</span>
                    <h2 class="blog-card-title"><a href="${blogPath}/${encodeURIComponent(p.slug)}">${escapeHtml(p.title)}</a></h2>
                    <p class="blog-card-desc">${escapeHtml(p.description)}</p>
                    <div class="blog-card-meta">
                      <time datetime="${p.publishedAt ? new Date(p.publishedAt).toISOString() : ''}">${dateStr}</time>
                      ${p.readingTime ? `<span class="blog-card-time">${escapeHtml(p.readingTime)}</span>` : ''}
                    </div>
                    <a href="${blogPath}/${encodeURIComponent(p.slug)}" class="blog-card-link">Lire l'article →</a>
                  </div>
                </article>`;
  }).join('');

  const articlesJson = JSON.stringify(posts.map(p => ({
    slug: p.slug,
    title: p.title,
    description: p.description,
    date: p.publishedAt,
    category: p.category,
    readingTime: p.readingTime
  })));

  return `<!DOCTYPE html>
<html lang="fr">
<head>
${headBlock(config, title, description, canonical, false, null, basePath)}
</head>
<body>
  <a href="#blog-main" class="skip-link">Aller au contenu</a>
  <header class="header header-light blog-header">
    <div class="container header-inner">
      <a href="${basePath}index.html" class="logo"><img src="/logo.png" alt="CarVINGuard"></a>
      <button type="button" class="menu-toggle" aria-label="Ouvrir le menu" aria-expanded="false"><span></span><span></span><span></span></button>
      ${navHtml(basePath, true)}
    </div>
    <div class="mobile-nav" id="mobileNav" aria-hidden="true">
      <nav class="mobile-nav-inner">${mobileNavHtml(basePath, true)}</nav>
    </div>
  </header>

  <main id="blog-main" class="blog-page">
    <div class="container">
      <nav class="breadcrumb" aria-label="Fil d'Ariane">
        <a href="${basePath}index.html">Accueil</a> &gt; <span>Blog</span>
      </nav>
      <header class="blog-hero">
        <h1 class="blog-hero-title">${escapeHtml(config.title || 'Blog & Actualités')}</h1>
        <p class="blog-hero-subtitle">${escapeHtml(config.subtitle || '')}</p>
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

  ${footerHtml(basePath)}
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
  <script src="${basePath}js/main.js"></script>
</body>
</html>`;
}

/**
 * Page article (/blog/:slug)
 */
function renderBlogArticle(config, post, allPosts) {
  const baseUrl = config.baseUrl || 'https://www.carvinguard.fr';
  const blogPath = config.blogPath || '/blog';
  const basePath = '../../';
  const categories = config.categories || {};
  const title = post.title + ' | Blog Carvinguard';
  const canonical = baseUrl + blogPath + '/' + encodeURIComponent(post.slug);
  const catLabel = categories[post.category] || post.category;

  const related = allPosts.filter(p => p.slug !== post.slug && (p.category === post.category || Math.random() > 0.6)).slice(0, 3);
  const relatedHtml = related.length ? `
      <aside class="blog-related" aria-label="Articles similaires">
        <h2 class="blog-related-title">Articles similaires</h2>
        <ul class="blog-related-list">
          ${related.map(p => `<li><a href="${blogPath}/${encodeURIComponent(p.slug)}">${escapeHtml(p.title)}</a></li>`).join('')}
        </ul>
      </aside>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
${headBlock(config, title, post.description, canonical, true, { ...post, date: post.publishedAt }, basePath)}
</head>
<body>
  <a href="#article-body" class="skip-link">Aller au contenu</a>
  <header class="header header-light blog-header">
    <div class="container header-inner">
      <a href="${basePath}index.html" class="logo"><img src="/logo.png" alt="CarVINGuard"></a>
      <button type="button" class="menu-toggle" aria-label="Ouvrir le menu" aria-expanded="false"><span></span><span></span><span></span></button>
      ${navHtml(basePath, true)}
    </div>
    <div class="mobile-nav" id="mobileNav" aria-hidden="true">
      <nav class="mobile-nav-inner">${mobileNavHtml(basePath, true)}</nav>
    </div>
  </header>

  <main class="blog-article-page">
    <article class="blog-article">
      <div class="container container-narrow">
        <nav class="breadcrumb" aria-label="Fil d'Ariane">
          <a href="${basePath}index.html">Accueil</a> &gt; <a href="${blogPath}">Blog</a> &gt; <span>${escapeHtml(post.title)}</span>
        </nav>
        <header class="blog-article-header">
          <span class="blog-article-cat">${escapeHtml(catLabel)}</span>
          <h1 class="blog-article-title">${escapeHtml(post.title)}</h1>
          <div class="blog-article-meta">
            <time datetime="${post.publishedAt ? new Date(post.publishedAt).toISOString() : ''}">${formatDate(post.publishedAt)}</time>
            ${post.readingTime ? `<span>${escapeHtml(post.readingTime)} de lecture</span>` : ''}
          </div>
        </header>
        <div id="article-body" class="blog-article-body content-section" itemprop="articleBody">
          ${post.bodyHtml}
        </div>
        <div class="blog-article-cta">
          <p>Besoin d'un rapport VIN à jour ?</p>
          <a href="${basePath}index.html" class="btn btn-primary btn-lg">Commander mon rapport — 19,90 €</a>
        </div>
        ${relatedHtml}
      </div>
    </article>
  </main>

  ${footerHtml(basePath)}
  <script src="${basePath}js/main.js"></script>
</body>
</html>`;
}

/**
 * Page confirmation après approbation (/blog/published)
 */
function renderBlogPublished(config) {
  const basePath = '../../';
  const blogPath = config.blogPath || '/blog';
  const title = 'Article publié | Blog Carvinguard';
  const description = 'Votre article a été publié sur le blog Carvinguard.';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
${headBlock(config, title, description, (config.baseUrl || 'https://www.carvinguard.fr') + blogPath + '/published', false, null, basePath)}
</head>
<body>
  <a href="#main" class="skip-link">Aller au contenu</a>
  <header class="header header-light blog-header">
    <div class="container header-inner">
      <a href="${basePath}index.html" class="logo"><img src="/logo.png" alt="CarVINGuard"></a>
      <button type="button" class="menu-toggle" aria-label="Ouvrir le menu" aria-expanded="false"><span></span><span></span><span></span></button>
      ${navHtml(basePath, true)}
    </div>
    <div class="mobile-nav" id="mobileNav" aria-hidden="true">
      <nav class="mobile-nav-inner">${mobileNavHtml(basePath, true)}</nav>
    </div>
  </header>

  <main id="main" class="blog-page">
    <div class="container">
      <div class="blog-hero" style="text-align:center;padding:3rem 1rem;">
        <h1 class="blog-hero-title">Article publié</h1>
        <p class="blog-hero-subtitle">L'article a bien été mis en ligne sur le blog.</p>
        <a href="${blogPath}" class="btn btn-primary">Voir le blog</a>
      </div>
    </div>
  </main>

  ${footerHtml(basePath)}
  <script src="${basePath}js/main.js"></script>
</body>
</html>`;
}

module.exports = {
  renderBlogIndex,
  renderBlogArticle,
  renderBlogPublished,
  escapeHtml,
  formatDate
};
