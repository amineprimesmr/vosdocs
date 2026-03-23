const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'cg_auth';
const BCRYPT_ROUNDS = 11;

function getJwtSecret() {
  return process.env.JWT_SECRET || '';
}

function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function signAuthToken(userId) {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error('JWT_SECRET manquant');
  }
  return jwt.sign({ sub: userId }, secret, { expiresIn: '30d' });
}

function verifyAuthToken(token) {
  const secret = getJwtSecret();
  if (!secret || !token) {
    return null;
  }
  try {
    return jwt.verify(token, secret);
  } catch (_) {
    return null;
  }
}

function getUserIdFromCookies(req) {
  const raw = req.cookies && req.cookies[COOKIE_NAME];
  const payload = verifyAuthToken(raw);
  return payload && payload.sub ? String(payload.sub) : null;
}

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/'
  });
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  signAuthToken,
  verifyAuthToken,
  getUserIdFromCookies,
  setAuthCookie,
  clearAuthCookie,
  normalizeEmail
};
