const { PrismaClient } = require('@prisma/client');

let prismaSingleton = null;

function getPrisma() {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
}

module.exports = { getPrisma };
