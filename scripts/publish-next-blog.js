#!/usr/bin/env node
/**
 * Publie le prochain article du calendrier (content/blog-calendar.json)
 * dans blog-articles.json avec la date du jour, puis lance generate-blog.js.
 * Usage: node scripts/publish-next-blog.js
 * Appelé par le workflow GitHub Actions tous les 3 jours.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const ARTICLES_PATH = path.join(CONTENT_DIR, 'blog-articles.json');
const CALENDAR_PATH = path.join(CONTENT_DIR, 'blog-calendar.json');

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return [];
  }
}

const calendar = loadJson(CALENDAR_PATH);
if (calendar.length === 0) {
  console.log('Aucun article en attente dans le calendrier.');
  process.exit(0);
}

const articles = loadJson(ARTICLES_PATH);
const next = calendar[0];
const today = new Date().toISOString().slice(0, 10);

const newArticle = {
  id: String(articles.length + 1),
  slug: next.slug,
  title: next.title,
  description: next.description,
  date: today,
  category: next.category,
  keywords: next.keywords || [],
  readingTime: next.readingTime || '4 min',
  bodyHtml: next.bodyHtml || '<p>Article à venir.</p>'
};

articles.unshift(newArticle);
const remaining = calendar.slice(1);

fs.writeFileSync(ARTICLES_PATH, JSON.stringify(articles, null, 2), 'utf8');
fs.writeFileSync(CALENDAR_PATH, JSON.stringify(remaining, null, 2), 'utf8');

console.log('Publié:', newArticle.title, '(', newArticle.slug + '.html', ')');
console.log('Restant dans le calendrier:', remaining.length);

execSync('node scripts/generate-blog.js', { cwd: ROOT, stdio: 'inherit' });
console.log('Génération blog terminée.');
