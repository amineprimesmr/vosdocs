/**
 * Configuration blog (JSON + variables d’environnement).
 * Important : avec seulement blog-config.json, BASE_URL Vercel doit surcharger l’URL (liens email d’approbation).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { mergeBlogConfigLayer, getSiteDisplayName } = require('./site-identity');

const CONTENT_DIR = path.join(__dirname, '..', 'content');

function getBlogConfig() {
  const configPath = path.join(CONTENT_DIR, 'blog-config.json');
  let fromFile = {};
  if (fs.existsSync(configPath)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.warn('blog-config.json invalide:', e.message);
    }
  }

  const base = {
    title: 'Blog & Actualités',
    subtitle: '',
    blogPath: '/blog',
    categories: {},
    brandName: getSiteDisplayName(),
    ...fromFile
  };

  return mergeBlogConfigLayer(base);
}

module.exports = { getBlogConfig, CONTENT_DIR };
