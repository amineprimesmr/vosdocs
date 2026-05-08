/**
 * URL publique et nom de marque affiché (emails auto-blog, SEO, liens absolus).
 * Priorité : BASE_URL / APP_ORIGIN → baseUrl dans blog-config (via merge) → domaine prod par défaut.
 */

'use strict';

/** Domaine canonique prod si aucune variable ni fichier config */
const DEFAULT_PUBLIC_BASE_URL = 'https://www.carvingard.fr';
const DEFAULT_SITE_BRAND = 'Carvingard';

function normalizeBaseUrl(raw) {
  return String(raw || '')
    .trim()
    .replace(/\/$/, '');
}

/**
 * URL publique du site (sans slash final). Utilisée pour les liens d’approbation, sitemap, etc.
 */
function getPublicBaseUrl() {
  const fromEnv = normalizeBaseUrl(process.env.BASE_URL || process.env.APP_ORIGIN);
  if (fromEnv) return fromEnv;
  if (process.env.VERCEL_URL) {
    return 'https://' + String(process.env.VERCEL_URL).replace(/^https?:\/\//, '');
  }
  return DEFAULT_PUBLIC_BASE_URL;
}

function getDefaultSiteBrand() {
  return DEFAULT_SITE_BRAND;
}

/**
 * Marque affichée (sujets emails, titres blog dynamiques). Surchargé par SITE_BRAND ou SITE_NAME.
 */
function getSiteDisplayName() {
  const b = String(process.env.SITE_BRAND || process.env.SITE_NAME || DEFAULT_SITE_BRAND).trim();
  return b || DEFAULT_SITE_BRAND;
}

/**
 * Fusionne une config blog lue depuis JSON : BASE_URL impose l’URL, SITE_BRAND le nom affiché.
 */
function mergeBlogConfigLayer(fileConfig) {
  const out = { ...fileConfig };
  const envBase = normalizeBaseUrl(process.env.BASE_URL || process.env.APP_ORIGIN);
  out.baseUrl = envBase || normalizeBaseUrl(out.baseUrl) || getPublicBaseUrl();

  const envBrand = String(process.env.SITE_BRAND || process.env.SITE_NAME || '').trim();
  if (envBrand) out.brandName = envBrand;
  else if (!out.brandName) out.brandName = getSiteDisplayName();

  return out;
}

module.exports = {
  normalizeBaseUrl,
  getPublicBaseUrl,
  getSiteDisplayName,
  getDefaultSiteBrand,
  mergeBlogConfigLayer,
  DEFAULT_PUBLIC_BASE_URL,
  DEFAULT_SITE_BRAND
};
