#!/usr/bin/env node
/**
 * Même flux que le CRON auto-blog : Groq génère 2 articles, propositions + email Resend.
 *
 * 1) Variables locales : `npx vercel env pull .env.local --environment=production`
 *    (le fichier `.env` seul n’a souvent pas Resend — les secrets sont sur Vercel).
 * 2) Expéditeur : ce script force par défaut `MAIL_FROM=onboarding@resend.dev` pour éviter
 *    l’erreur « domain not verified » si ton `.env` contient encore un `@carvinguard.fr` non vérifié.
 *    Pour tester ton vrai expéditeur : `BLOG_TEST_MAIL_FROM=noreply@ton-domaine-verifie.fr` avant la commande.
 * 3) Destinataire avec Resend « test » : tu ne peux envoyer qu’à l’email du compte Resend
 *    (souvent infos.vosdocs@gmail.com) tant qu’aucun domaine n’est vérifié.
 *    Pour amine.ennasri.pro@gmail.com : vérifie **carvingard.fr** (ou autre) sur https://resend.com/domains
 *    puis `BLOG_TEST_MAIL_FROM=…` + domaine vérifié.
 *
 * Usage : npm run blog:test-email -- destinataire@email.com
 * Option : GROQ_MODEL=llama-3.1-8b-instant (moins de quota TPM que le 70B).
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

// Moins de risque de 429 Groq sur les tests (surcharge possible via env).
if (!process.env.GROQ_MODEL) {
  process.env.GROQ_MODEL = 'llama-3.1-8b-instant';
}

// Expéditeur test Resend par défaut (évite 403 domaine non vérifié avec les vars Vercel).
process.env.MAIL_FROM =
  process.env.BLOG_TEST_MAIL_FROM || process.env.MAIL_FROM || 'onboarding@resend.dev';

const dest = (process.argv[2] || process.env.MERCHANT_EMAIL || process.env.MAIL_TO || '').trim();
if (!dest) {
  console.error('Usage: npm run blog:test-email -- destinataire@example.com');
  process.exit(1);
}

process.env.MERCHANT_EMAIL = dest;

const blog = require('../lib/blog');

async function main() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error(
      'RESEND_API_KEY manquant. Lance : npx vercel env pull .env.local --environment=production'
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL manquant (idem, ou .env.local depuis Vercel).');
  }
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY manquant (idem).');
  }

  const result = await blog.runCronGenerateArticles();
  console.log('Email envoyé à', dest);
  console.log('Resend id :', result.emailId || '(n/a)');
  console.log('Propositions :', result.proposals?.length || 0);
  console.log('MAIL_FROM utilisé :', process.env.MAIL_FROM);
  if (String(process.env.MAIL_FROM).includes('resend.dev')) {
    console.log(
      'Note : avec l’expéditeur test Resend, seules certaines adresses sont autorisées tant que le domaine n’est pas vérifié.'
    );
  }
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  })
  .finally(() => {
    const db = blog.getPrisma && blog.getPrisma();
    if (db && typeof db.$disconnect === 'function') {
      db.$disconnect().catch(() => {});
    }
  });
