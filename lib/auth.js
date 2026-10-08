const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    // Un lien d’invitation n’est jamais une session de connexion.
    return payload && !payload.typ && typeof payload.sub === 'string' ? payload : null;
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

const INVITE_TOKEN_TYP = 'acct_invite';

/** Jeton 7 jours : premier mot de passe après paiement sans compte. */
function passwordFingerprint(passwordHash) {
  return crypto.createHash('sha256').update(String(passwordHash)).digest('hex');
}

function signAccountInviteToken(userId, passwordHash, expiresIn = '7d') {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error('JWT_SECRET manquant');
  }
  if (!passwordHash) throw new Error('Empreinte de mot de passe requise');
  return jwt.sign({ sub: String(userId), typ: INVITE_TOKEN_TYP, pwd: passwordFingerprint(passwordHash) }, secret, { expiresIn });
}

/** @returns {string|null} userId */
function verifyAccountInviteToken(token, passwordHash) {
  const secret = getJwtSecret();
  if (!secret || !token) {
    return null;
  }
  try {
    const p = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (!p || p.typ !== INVITE_TOKEN_TYP || !p.sub || typeof p.pwd !== 'string') {
      return null;
    }
    if (passwordHash !== undefined && p.pwd !== passwordFingerprint(passwordHash)) return null;
    return String(p.sub);
  } catch (_) {
    return null;
  }
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
  normalizeEmail,
  signAccountInviteToken,
  verifyAccountInviteToken
};
