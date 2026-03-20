const SESSION_COOKIE_NAME = 'clawchating_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type SessionPayload = {
  u: string;
  exp: number;
};

function toBase64(value: string) {
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  throw new Error('btoa is not available in current runtime');
}

function fromBase64(value: string) {
  if (typeof atob === 'function') {
    return atob(value);
  }
  throw new Error('atob is not available in current runtime');
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return toBase64(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = fromBase64(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isAuthEnabled() {
  return !!process.env.CLAWCHATING_ADMIN_PASSWORD;
}

function getAuthSecret() {
  const password = process.env.CLAWCHATING_ADMIN_PASSWORD || '';
  const explicit = process.env.CLAWCHATING_AUTH_SECRET || '';
  return explicit || `clawchating-secret:${password}`;
}

function getAdminUsername() {
  return process.env.CLAWCHATING_ADMIN_USERNAME || 'admin';
}

function getAdminPassword() {
  return process.env.CLAWCHATING_ADMIN_PASSWORD || '';
}

async function signData(data: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(getAuthSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(data));
  return toBase64Url(new Uint8Array(signature));
}

async function verifySignature(data: string, signatureB64Url: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(getAuthSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    'HMAC',
    key,
    fromBase64Url(signatureB64Url),
    textEncoder.encode(data)
  );
}

export async function createSessionToken(username: string) {
  const payload: SessionPayload = {
    u: username,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(textEncoder.encode(payloadJson));
  const signatureB64 = await signData(payloadB64);
  return `${payloadB64}.${signatureB64}`;
}

export async function verifySessionToken(token: string | undefined | null) {
  if (!token) return null;
  const [payloadB64, signatureB64] = token.split('.');
  if (!payloadB64 || !signatureB64) return null;

  const ok = await verifySignature(payloadB64, signatureB64);
  if (!ok) return null;

  try {
    const payloadRaw = textDecoder.decode(fromBase64Url(payloadB64));
    const payload = JSON.parse(payloadRaw) as SessionPayload;
    if (!payload?.u || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getAuthCookieName() {
  return SESSION_COOKIE_NAME;
}

export function getSessionMaxAge() {
  return SESSION_MAX_AGE_SECONDS;
}

export function getAuthConfigSummary() {
  return {
    enabled: isAuthEnabled(),
    username: getAdminUsername(),
  };
}

export function verifyLoginCredential(username: string, password: string) {
  if (!isAuthEnabled()) {
    return { ok: false as const, reason: 'auth_disabled' as const };
  }
  if (!password || password !== getAdminPassword()) {
    return { ok: false as const, reason: 'invalid_password' as const };
  }

  const expectedUsername = getAdminUsername();
  const normalizedUsername = (username || expectedUsername).trim() || expectedUsername;
  if (normalizedUsername !== expectedUsername) {
    return { ok: false as const, reason: 'invalid_username' as const };
  }

  return {
    ok: true as const,
    username: expectedUsername,
  };
}
