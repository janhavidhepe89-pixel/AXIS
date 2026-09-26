/**
 * World ID for Agents (sandbox) via OpenID Connect.
 *
 * Each high-value agent action gets its own authorization request, bound to the proposal id via
 * `state`, protected with PKCE (S256) and a `nonce`, and forced fresh with `prompt=login` +
 * `max_age`. The ID token is only trusted after the backend verifies its signature against
 * World's JWKS and checks issuer, audience, nonce and auth_time. The client secret never leaves
 * the server.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from './config.js';
import { policy } from './policy.js';

const issuer = config.world.issuer;
const endpoints = {
  authorize: `${issuer}/api/v1/authorize`,
  token: `${issuer}/api/v1/token`,
  jwks: `${issuer}/.well-known/jwks.json`,
};
const jwks = createRemoteJWKSet(new URL(endpoints.jwks));
export const redirectUri = `${config.publicBaseUrl}/auth/callback`;

interface PendingAuth {
  proposalId: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

const pending = new Map<string, PendingAuth>();
const b64url = (buf: Buffer) => buf.toString('base64url');

/** Build the World ID authorization URL for approving one specific proposal. */
export function beginApproval(proposalId: string): string {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
  pending.set(state, { proposalId, nonce, codeVerifier, createdAt: Date.now() });

  const url = new URL(endpoints.authorize);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.world.clientId,
    redirect_uri: redirectUri,
    scope: 'openid',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'login',
    max_age: String(policy.maxAuthAgeSec),
  }).toString();
  return url.toString();
}

export type ApprovalResult =
  | { ok: true; proposalId: string; subject: string; claims: JWTPayload }
  | { ok: false; proposalId?: string; reason: string };

/** Handle the redirect back from World ID. Never trusts anything the browser says without checks. */
export async function completeApproval(query: Record<string, unknown>): Promise<ApprovalResult> {
  const state = typeof query.state === 'string' ? query.state : '';
  const auth = pending.get(state);
  pending.delete(state); // single use
  if (!auth) return { ok: false, reason: 'unknown or already-used state' };
  const { proposalId } = auth;

  if (typeof query.error === 'string') {
    const desc = typeof query.error_description === 'string' ? `: ${query.error_description}` : '';
    return { ok: false, proposalId, reason: `World ID returned ${query.error}${desc}` };
  }
  if (Date.now() - auth.createdAt > policy.approvalTtlMs) {
    return { ok: false, proposalId, reason: 'verification request expired' };
  }
  if (typeof query.code !== 'string') return { ok: false, proposalId, reason: 'missing code' };

  // Exchange the code server-side (client_secret_basic + PKCE verifier).
  const basic = Buffer.from(
    `${encodeURIComponent(config.world.clientId)}:${encodeURIComponent(config.world.clientSecret)}`,
  ).toString('base64');
  const res = await fetch(endpoints.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: query.code,
      redirect_uri: redirectUri,
      code_verifier: auth.codeVerifier,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.id_token !== 'string') {
    return { ok: false, proposalId, reason: `token exchange failed (${res.status} ${body.error ?? ''})` };
  }

  try {
    const { payload } = await jwtVerify(body.id_token, jwks, {
      issuer,
      audience: config.world.clientId,
      algorithms: ['RS256'],
    });
    if (payload.nonce !== auth.nonce) return { ok: false, proposalId, reason: 'nonce mismatch' };
    const authTime = typeof payload.auth_time === 'number' ? payload.auth_time : 0;
    const age = Math.floor(Date.now() / 1000) - authTime;
    if (age > policy.maxAuthAgeSec) {
      return { ok: false, proposalId, reason: `authentication not fresh (${age}s old)` };
    }
    if (!payload.sub) return { ok: false, proposalId, reason: 'missing subject' };
    return { ok: true, proposalId, subject: payload.sub, claims: payload };
  } catch (err) {
    return { ok: false, proposalId, reason: `invalid ID token: ${(err as Error).message}` };
  }
}
