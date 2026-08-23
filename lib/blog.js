/**
 * Auto-Blog SEO - Logique métier
 * Génération d'articles via Groq, propositions, tokens, email Resend
 */

const crypto = require('crypto');
const { Resend } = require('resend');
const { getBlogConfig } = require('./blog-config');
const { getMerchantRecipients } = require('./email-recipients');
const { sendResendEmail } = require('./resend-send');

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

function isRetryableDbError(err) {
  const msg = String((err && err.message) || err || '');
  return /Can't reach database|P1001|P1017|Timed out fetching|Server has closed the connection|Connection reset/i.test(msg);
}

async function withDbRetry(fn, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryableDbError(e) || i === attempts - 1) throw e;
      const wait = 2000 * (i + 1);
      console.warn(`Base Neon injoignable, nouvel essai dans ${wait}ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastErr;
}

const CATEGORIES_LIST = [
  'rapport-vin',
  'carte-grise',
  'vente-vehicule',
  'achat-occasion',
  'demarches',
  'documents'
];

/** Remplaçant officiel Groq de llama-3.3-70b-versatile (retiré le 16 août 2026). */
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';
const GROQ_FALLBACK_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
const GROQ_RETIRED_MODELS = new Set([
  'llama-3.3-70b-versatile',
  'llama-3.3-70b-specdec',
  'llama-3.1-8b-instant',
  'llama-3.1-70b-versatile',
  'llama-3.1-70b-specdec',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'qwen/qwen3-32b',
  'meta-llama/llama-4-scout-17b-16e-instruct'
]);

function preferredGroqModel(options = {}) {
  if (typeof options.model === 'string' && options.model.trim()) return options.model.trim();
  if (typeof process.env.GROQ_MODEL === 'string' && process.env.GROQ_MODEL.trim()) {
    return process.env.GROQ_MODEL.trim();
  }
  return GROQ_DEFAULT_MODEL;
}

function groqModelCandidates(options = {}) {
  const preferred = preferredGroqModel(options);
  const list = [];
  if (!GROQ_RETIRED_MODELS.has(preferred)) {
    list.push(preferred);
  } else {
    console.warn('Modèle Groq retiré ignoré:', preferred);
  }
  for (const model of GROQ_FALLBACK_MODELS) {
    if (!list.includes(model)) list.push(model);
  }
  return list;
}

function isMissingGroqModelError(status, body) {
  if (status === 404) return true;
  const text = String(body || '').toLowerCase();
  return text.includes('does not exist') || text.includes('do not have access') || text.includes("n'existe pas");
}

function isTokenLimitError(status, body) {
  if (status === 413) return true;
  const text = String(body || '').toLowerCase();
  return text.includes('rate_limit_exceeded') || text.includes('request too large') || text.includes('tokens per minute');
}

/**
 * Appelle l'API Groq pour générer du contenu (modèle actuel + repli si retiré).
 */
async function callGroq(messages, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY manquant');

  const candidates = groqModelCandidates(options);
  const requestedTokens = options.max_tokens ?? 3500;
  const tokenLadder = [...new Set([requestedTokens, Math.min(requestedTokens, 3500), 2500])];
  let lastErr = null;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    for (let t = 0; t < tokenLadder.length; t++) {
      const maxTokens = tokenLadder[t];
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature: options.temperature ?? 0.7,
          ...(options.jsonObject ? { response_format: { type: 'json_object' } } : {}),
          ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {})
        })
      });

      if (!res.ok) {
        const err = await res.text();
        lastErr = new Error(`Groq API: ${res.status} ${err}`);
        if (isTokenLimitError(res.status, err) && t < tokenLadder.length - 1) {
          console.warn('Groq plafond tokens, nouvel essai plus petit:', model, maxTokens);
          continue;
        }
        if (isMissingGroqModelError(res.status, err) && i < candidates.length - 1) {
          console.warn('Groq modèle indisponible, essai suivant:', model);
          break;
        }
        throw lastErr;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        lastErr = new Error('Réponse Groq vide');
        if (t < tokenLadder.length - 1 || i < candidates.length - 1) {
          console.warn('Réponse Groq vide, nouvel essai:', model);
          continue;
        }
        throw lastErr;
      }
      if (i > 0 || t > 0) console.warn('Groq: OK avec', model, 'max_tokens', maxTokens);
      return content;
    }
  }

  throw lastErr || new Error('Aucun modèle Groq disponible');
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

function normalizeArticle(a) {
  return {
    title: String(a.title || '').trim(),
    slug: String(a.slug || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'article-' + Date.now(),
    description: String(a.description || '').trim(),
    category: CATEGORIES_LIST.includes(a.category) ? a.category : CATEGORIES_LIST[0],
    readingTime: String(a.readingTime || '4 min').trim(),
    bodyHtml: String(a.bodyHtml || '').trim() || '<p>Contenu à venir.</p>'
  };
}

async function generateOneArticle(existingSlugs = []) {
  const blogCfg = getBlogConfig();
  const brand = blogCfg.brandName || 'Carvingard';
  const siteUrl = blogCfg.baseUrl || 'https://www.carvingard.fr';
  const slugsHint = existingSlugs.length
    ? `Slugs déjà utilisés à NE PAS réutiliser : ${existingSlugs.slice(0, 20).join(', ')}.`
    : '';

  const systemPrompt = `Tu es un rédacteur SEO senior pour ${brand} (rapport VIN, carte grise, vente/achat d'occasion).
Écris en français naturel, utile et factuel. Pas d'affirmation juridique risquée.
Article complet (900 à 1300 mots), HTML valide : intro <p>, 5 à 7 <h2>, listes, erreurs fréquentes, mini FAQ (2-3 questions), conclusion.
Catégories : ${CATEGORIES_LIST.join(', ')}.
Aucun prix en euros dans le bodyHtml ; renvoie vers ${siteUrl}.`;

  const userPrompt = `Génère exactement 1 article de blog SEO pour ${brand}.
${slugsHint}
Réponds UNIQUEMENT par un JSON valide :
{"title":"...","slug":"...","description":"...","category":"...","readingTime":"...","bodyHtml":"..."}
slug : minuscules, tirets, sans accents. description : 140-160 caractères. bodyHtml : HTML complet (p, h2, ul, a).`;

  const raw = await callGroq(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    { max_tokens: 3500, jsonObject: true }
  );

  const parsed = parseJsonSafely(raw);
  const article = parsed.article || parsed.articles?.[0] || parsed;
  if (!article || !article.title) throw new Error('Groq n’a pas renvoyé d’article valide');
  return normalizeArticle(article);
}

/**
 * Génère 2 articles SEO via Groq (un appel chacun pour rester sous le plafond TPM).
 */
async function generateTwoArticles(existingSlugs = []) {
  const first = await generateOneArticle(existingSlugs);
  const second = await generateOneArticle([...existingSlugs, first.slug]);
  return [first, second];
}

/**
 * Crée 2 propositions + 2 tokens en base et envoie l'email de choix
 */
async function createProposalsAndSendEmail(articles) {
  const db = getPrisma();
  if (!db) throw new Error('Base de données non configurée (DATABASE_URL)');

  const cfg = getBlogConfig();
  const baseUrl = cfg.baseUrl || 'https://www.carvingard.fr';
  const brand = cfg.brandName || 'Carvingard';
  const batchId = Date.now().toString();
  const merchantRecipients = getMerchantRecipients();
  const merchantEmail = merchantRecipients[0] || 'infos.carvinguard@gmail.com';

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

  const plainLines = [
    `${brand} — 2 propositions d’articles à valider`,
    '',
    'Choisissez l’article à publier (l’autre sera rejeté). Liens valables 48 h.',
    ...proposals.map((p, i) => `\n${i + 1}. ${p.title}\n   ${p.approveUrl}\n`)
  ];

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
  <h1 style="font-size:1.25rem;">${escapeHtml(brand)} – Nouvelles propositions d'articles</h1>
  <p>Deux articles ont été générés. Choisissez celui à publier en cliquant sur <strong>Publier</strong> (l'autre sera rejeté). Lien valable 48 h.</p>
  <p style="font-size:0.85rem;color:#555;">Si les boutons ne s’affichent pas, copiez-collez les URLs affichées en texte brut (version texte de cet email).</p>
  <div style="margin:24px 0;">
    ${proposals.map((p, i) => `
    <div style="border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:16px;">
      <h2 style="font-size:1rem;margin:0 0 8px;">${escapeHtml(p.title)}</h2>
      <p style="margin:0 0 12px;color:#666;font-size:0.9rem;">${escapeHtml(p.description.slice(0, 160))}</p>
      <p style="margin:0 0 10px;font-size:0.8rem;word-break:break-all;"><a href="${p.approveUrl}">${escapeHtml(p.approveUrl)}</a></p>
      <a href="${p.approveUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;">Publier cet article</a>
    </div>
    `).join('')}
  </div>
  <p style="color:#888;font-size:0.85rem;">Cet email est envoyé automatiquement par le système Auto-Blog ${escapeHtml(brand)} (${escapeHtml(baseUrl)}).</p>
</body>
</html>`;

  const sendResult = await sendResendEmail(resend, {
    from,
    to: merchantRecipients.length ? merchantRecipients : [merchantEmail],
    replyTo: process.env.MERCHANT_REPLY_TO || merchantEmail,
    subject: `${brand} – 2 propositions d’articles à valider`,
    html,
    text: plainLines.join('\n')
  });

  if (!sendResult.sent) {
    console.error('Erreur envoi email propositions:', sendResult.error, sendResult.skipped || '');
    throw new Error('Envoi email échoué: ' + (sendResult.error || 'inconnu'));
  }
  if (sendResult.partial) {
    console.warn('Blog email partiel — destinataires ignorés:', sendResult.skipped);
  }

  return { proposals, emailId: sendResult.emailId, partial: sendResult.partial, skipped: sendResult.skipped };
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
  const posts = await withDbRetry(() => db.blogPost.findMany({ select: { slug: true } }));
  return posts.map(p => p.slug);
}

/**
 * Point d'entrée CRON : génère 2 articles, les enregistre, envoie l'email
 */
async function runCronGenerateArticles() {
  const slugs = await getPublishedSlugs();
  const articles = await generateTwoArticles(slugs);
  const result = await withDbRetry(() => createProposalsAndSendEmail(articles));
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
