#!/usr/bin/env node
/**
 * Seed la table BlogPost à partir de content/blog-articles.json
 * Usage: DATABASE_URL=... node scripts/seed-blog-db.js
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const contentPath = path.join(ROOT, 'content', 'blog-articles.json');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL manquant. Ex: DATABASE_URL=postgresql://... node scripts/seed-blog-db.js');
  process.exit(1);
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  let articles = [];
  if (fs.existsSync(contentPath)) {
    articles = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
  }
  if (articles.length === 0) {
    console.log('Aucun article dans blog-articles.json.');
    await prisma.$disconnect();
    return;
  }

  for (const a of articles) {
    const slug = a.slug || ('article-' + a.id);
    const existing = await prisma.blogPost.findUnique({ where: { slug } });
    if (existing) {
      console.log('Déjà en base:', slug);
      continue;
    }
    await prisma.blogPost.create({
      data: {
        slug,
        title: a.title || 'Sans titre',
        description: a.description || '',
        bodyHtml: a.bodyHtml || '<p>Contenu à venir.</p>',
        category: a.category || 'rapport-vin',
        readingTime: a.readingTime || '4 min',
        keywords: a.keywords || [],
        publishedAt: a.date ? new Date(a.date) : new Date()
      }
    });
    console.log('Importé:', slug);
  }

  await prisma.$disconnect();
  console.log('Seed terminé. Total:', articles.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
