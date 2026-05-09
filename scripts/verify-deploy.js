#!/usr/bin/env node
/**
 * Vérifie ce qui peut l’être sans secrets (syntaxe, Prisma).
 * Usage : npm run verify
 */
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);
const prismaBin = path.join(root, 'node_modules', '.bin', 'prisma');

console.log('Carvinguard — vérification déploiement\n');

try {
  execSync(`"${prismaBin}" validate`, { stdio: 'inherit', shell: true });
} catch (e) {
  console.error('\n✗ prisma validate a échoué (npm install d’abord ?).\n');
  process.exit(1);
}

const libChecks = [
  'server.js',
  'lib/site-identity.js',
  'lib/blog-config.js',
  'lib/blog.js',
  'lib/fulfill-vin-order.js',
  'lib/order-emails.js',
  'lib/report-pdf.js',
  'lib/vin-decode-core.js',
  'lib/carapi-client.js',
  'lib/vin-provider.js',
  'lib/vehicledatabases-client.js',
  'scripts/test-vd-report-pdf.js',
  'lib/prisma.js',
  'lib/auth.js',
  'scripts/manual-fulfill-payment.js',
  'scripts/verify-stripe-webhook-url.js',
  'scripts/diag-stripe-webhooks.js'
];
for (const rel of libChecks) {
  try {
    execSync(`node --check "${rel}"`, { stdio: 'inherit', cwd: root });
  } catch (e) {
    console.error(`\n✗ ${rel} : erreur de syntaxe.\n`);
    process.exit(1);
  }
}

if (process.env.VERIFY_WITH_GENERATE === '1') {
  try {
    execSync(`"${prismaBin}" generate`, { stdio: 'inherit', shell: true });
  } catch (e) {
    console.error('\n✗ prisma generate a échoué.\n');
    process.exit(1);
  }
}

console.log('\n✓ prisma validate + syntaxe server.js OK.');
console.log('  Prisma client : déjà généré au npm install, ou lance : npx prisma generate');
console.log('  Variables prod : npm run saas:check:prod\n');
