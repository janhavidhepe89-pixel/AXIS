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
