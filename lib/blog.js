/**
 * Auto-Blog SEO - Logique métier
 * Génération d'articles via Groq, propositions, tokens, email Resend
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Resend } = require('resend');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');

let prisma = null;
function getPrisma() {
  if (!process.env.DATABASE_URL) return null;
  if (!prisma) {
    try {
      const { PrismaClient } = require('@prisma/client');
      prisma = new PrismaClient();
    } catch (e) {
      console.warn('Prisma non disponible:', e.message);
    }
  }
  return prisma;
}

function getBlogConfig() {
  const configPath = path.join(CONTENT_DIR, 'blog-config.json');
  if (!fs.existsSync(configPath)) {
    return {
      baseUrl: process.env.BASE_URL || 'https://www.carvinguard.fr',
      blogPath: '/blog',
      categories: {}
    };
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

const CATEGORIES_LIST = [
  'rapport-vin',
  'carte-grise',
  'vente-vehicule',
  'achat-occasion',
  'demarches',
  'documents'
];

/**
 * Appelle l'API Groq (Llama 3.3 70B) pour générer du contenu
 */
async function callGroq(messages, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY manquant');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.model || 'llama-3.3-70b-versatile',
      messages,
      max_tokens: options.max_tokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      ...(options.jsonObject ? { response_format: { type: 'json_object' } } : {})
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API: ${res.status} ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Réponse Groq vide');
  return content;
}

function parseJsonSafely(raw) {
  const direct = String(raw || '').trim();
  const withoutFence = direct.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const candidates = [withoutFence];

  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_) {}
    try {
      // Supprime les échappements invalides (\x, \_, etc.) qui cassent JSON.parse
      const cleaned = candidate.replace(/\\(?!["\\/bfnrtu])/g, '');
      return JSON.parse(cleaned);
    } catch (_) {}
  }

  throw new Error('Réponse IA invalide: JSON non parsable');
}

/**
 * Génère 2 articles SEO via Groq (thème : rapport VIN, carte grise, vente/achat véhicule)
 */
async function generateTwoArticles(existingSlugs = []) {
  const slugsHint = existingSlugs.length
    ? `Slugs déjà utilisés à NE PAS réutiliser : ${existingSlugs.join(', ')}.`
    : '';

  const systemPrompt = `Tu es un rédacteur SEO senior pour un site français (Carvinguard) spécialisé dans les démarches véhicule (rapport VIN / historique, carte grise, vente/achat d'occasion).
Tu écris en français naturel, utile, expert et orienté intention de recherche.
Chaque article doit être très complet (1000 à 1600 mots), clair, actionnable, et structuré.
Le bodyHtml doit être du HTML propre et valide avec cette organisation minimale :
- Introduction concrète en <p>
- 5 à 8 sections <h2> avec sous-sections <h3> si utile
- listes <ul><li> pour checklists/étapes
- un bloc "Erreurs fréquentes" ou "Pièges à éviter"
- un mini FAQ (2 à 4 questions) en fin d'article (H2 + paragraphes)
- une conclusion pratique
Tu dois éviter les affirmations juridiques risquées et rester factuel.
Catégories possibles : ${CATEGORIES_LIST.join(', ')}.
Quand pertinent, ajoute un lien vers <a href="https://www.carvinguard.fr/">Carvinguard</a>.`;

  const userPrompt = `Génère exactement 2 articles de blog SEO différents pour Carvinguard.
${slugsHint}
Pour chaque article, fournis un objet JSON avec les clés exactes :
- title (string, titre accrocheur)
- slug (string, URL-friendly, minuscules, tirets, pas d'accents, ex: "fraicheur-donnees-rapport-vin")
- description (string, meta description 140-160 caractères)
- category (string, une des catégories listées ci-dessus)
- readingTime (string, ex "7 min" ou "9 min")
- bodyHtml (string, contenu HTML complet de l'article, avec <p>, <h2>, <ul>, <a>)

Réponds UNIQUEMENT par un JSON valide de la forme :
{"articles":[ {"title":"...","slug":"...","description":"...","category":"...","readingTime":"...","bodyHtml":"..."}, {"title":"...","slug":"...","description":"...","category":"...","readingTime":"...","bodyHtml":"..."} ]}
Sans markdown, sans \`\`\`, uniquement le JSON.`;

  const raw = await callGroq(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    { max_tokens: 8192, jsonObject: true }
  );

  const parsed = parseJsonSafely(raw);
  const articles = parsed.articles || parsed;
  if (!Array.isArray(articles) || articles.length < 2) {
    throw new Error('Groq doit retourner au moins 2 articles dans un tableau');
  }
  return articles.slice(0, 2).map(a => ({
    title: String(a.title || '').trim(),
    slug: String(a.slug || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'article-' + Date.now(),
    description: String(a.description || '').trim(),
    category: CATEGORIES_LIST.includes(a.category) ? a.category : CATEGORIES_LIST[0],
    readingTime: String(a.readingTime || '4 min').trim(),
    bodyHtml: String(a.bodyHtml || '').trim() || '<p>Contenu à venir.</p>'
  }));
}

/**
 * Crée 2 propositions + 2 tokens en base et envoie l'email de choix
 */
async function createProposalsAndSendEmail(articles) {
  const db = getPrisma();
  if (!db) throw new Error('Base de données non configurée (DATABASE_URL)');

  const baseUrl = process.env.BASE_URL || getBlogConfig().baseUrl || 'https://www.carvinguard.fr';
  const batchId = Date.now().toString();
  const merchantEmail = process.env.MERCHANT_EMAIL || process.env.MAIL_TO || 'infos.carvinguard@gmail.com';

  const proposals = [];
  for (const art of articles) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h

    const proposal = await db.blogProposal.create({
      data: {
        title: art.title,
        slug: art.slug,
        description: art.description,
        content: art.bodyHtml,
        bodyHtml: art.bodyHtml,
        category: art.category,
        readingTime: art.readingTime,
        status: 'PENDING',
        batchId
      }
    });

    await db.blogAuthToken.create({
      data: {
        token,
        proposalId: proposal.id,
        expiresAt
      }
    });

    proposals.push({
      ...proposal,
      approveUrl: `${baseUrl}/api/blog/approve?token=${token}`
    });
  }

  // Envoi email Resend
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.MAIL_FROM || 'onboarding@resend.dev';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
  <h1 style="font-size:1.25rem;">Carvinguard – Nouvelles propositions d'articles</h1>
  <p>Deux articles ont été générés. Choisissez celui à publier en cliquant sur <strong>Publier</strong> (l'autre sera rejeté). Lien valable 48 h.</p>
  <div style="margin:24px 0;">
    ${proposals.map((p, i) => `
    <div style="border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:16px;">
      <h2 style="font-size:1rem;margin:0 0 8px;">${escapeHtml(p.title)}</h2>
      <p style="margin:0 0 12px;color:#666;font-size:0.9rem;">${escapeHtml(p.description.slice(0, 160))}</p>
      <a href="${p.approveUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;">Publier cet article</a>
    </div>
    `).join('')}
  </div>
  <p style="color:#888;font-size:0.85rem;">Cet email est envoyé automatiquement par le système Auto-Blog Carvinguard.</p>
</body>
</html>`;

  const { data, error } = await resend.emails.send({
    from,
    to: merchantEmail,
    subject: 'Carvinguard – 2 propositions d’articles à valider',
    html
  });

  if (error) {
    console.error('Erreur envoi email propositions:', error);
    throw new Error('Envoi email échoué: ' + (error.message || String(error)));
  }

  return { proposals, emailId: data?.id };
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Récupère une proposition par token (vérifie expiration et usage)
 */
async function getProposalByToken(token) {
  const db = getPrisma();
  if (!db) return null;

  const authToken = await db.blogAuthToken.findUnique({
    where: { token },
    include: { proposal: true }
  });
  if (!authToken?.proposal) return null;
  if (authToken.usedAt) return null;
  if (new Date() > authToken.expiresAt) return null;
  if (authToken.proposal.status !== 'PENDING') return null;

  return authToken;
}

/**
 * Approuve l'article (publie en BlogPost) et rejette l'autre du même batch
 */
async function approveArticle(proposalId) {
  const db = getPrisma();
  if (!db) throw new Error('Base de données non configurée');

  const proposal = await db.blogProposal.findUnique({
    where: { id: proposalId },
    include: { token: true }
  });
  if (!proposal || proposal.status !== 'PENDING') {
    throw new Error('Proposition invalide ou déjà traitée');
  }

  let publishedSlug = proposal.slug;
  await db.$transaction(async (tx) => {
    const batchProposals = await tx.blogProposal.findMany({
      where: { batchId: proposal.batchId }
    });

    for (const p of batchProposals) {
      await tx.blogProposal.update({
        where: { id: p.id },
        data: { status: p.id === proposalId ? 'APPROVED' : 'REJECTED' }
      });
    }

    // Évite les collisions de slug (ex: même titre généré 2 fois)
    let candidate = proposal.slug;
    let n = 2;
    while (await tx.blogPost.findUnique({ where: { slug: candidate } })) {
      candidate = `${proposal.slug}-${n}`;
      n += 1;
    }
    publishedSlug = candidate;

    await tx.blogPost.create({
      data: {
        slug: publishedSlug,
        title: proposal.title,
        description: proposal.description,
        bodyHtml: proposal.bodyHtml,
        category: proposal.category,
        readingTime: proposal.readingTime,
        keywords: []
      }
    });

    if (proposal.token) {
      await tx.blogAuthToken.update({
        where: { id: proposal.token.id },
        data: { usedAt: new Date() }
      });
    }
  });

  return { slug: publishedSlug };
}

/**
 * Liste des slugs des articles déjà publiés (pour éviter doublons)
 */
async function getPublishedSlugs() {
  const db = getPrisma();
  if (!db) return [];
  const posts = await db.blogPost.findMany({ select: { slug: true } });
  return posts.map(p => p.slug);
}

/**
 * Point d'entrée CRON : génère 2 articles, les enregistre, envoie l'email
 */
async function runCronGenerateArticles() {
  const slugs = await getPublishedSlugs();
  const articles = await generateTwoArticles(slugs);
  const result = await createProposalsAndSendEmail(articles);
  return result;
}

module.exports = {
  getPrisma,
  getBlogConfig,
  generateTwoArticles,
  createProposalsAndSendEmail,
  getProposalByToken,
  approveArticle,
  getPublishedSlugs,
  runCronGenerateArticles,
  getBlogPosts: async () => {
    const db = getPrisma();
    if (!db) return [];
    return db.blogPost.findMany({
      orderBy: { publishedAt: 'desc' }
    });
  },
  getBlogPostBySlug: async (slug) => {
    const db = getPrisma();
    if (!db) return null;
    return db.blogPost.findUnique({ where: { slug } });
  }
};
