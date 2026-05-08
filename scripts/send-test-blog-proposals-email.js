#!/usr/bin/env node
/**
 * Même flux que le CRON auto-blog : Groq génère 2 articles, enregistrement des propositions + tokens, email Resend.
 * Usage : node scripts/send-test-blog-proposals-email.js [destinataire@email.com]
 * Variables : DATABASE_URL, GROQ_API_KEY, RESEND_API_KEY, BASE_URL (liens « Publier »), MAIL_FROM (optionnel).
 */
require('dotenv').config();

const dest = (process.argv[2] || process.env.MERCHANT_EMAIL || process.env.MAIL_TO || '').trim();
if (!dest) {
  console.error('Usage: node scripts/send-test-blog-proposals-email.js destinataire@example.com');
  process.exit(1);
}

process.env.MERCHANT_EMAIL = dest;

const blog = require('../lib/blog');

async function main() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY manquant dans .env');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL manquant dans .env');
  }
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY manquant dans .env');
  }

  const result = await blog.runCronGenerateArticles();
  console.log('Email envoyé à', dest);
  console.log('Resend id :', result.emailId || '(n/a)');
  console.log('Propositions :', result.proposals?.length || 0);
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
