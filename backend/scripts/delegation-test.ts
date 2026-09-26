/**
 * End-to-end check of the delegation API against a running server, using a throwaway owner key:
 * delegate -> status -> revoke with wrong key (rejected) -> revoke with owner key.
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const BASE = process.env.BASE || 'http://localhost:3001';
const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

const get = (p: string) => fetch(BASE + p).then((r) => r.json());
const post = (p: string, body: unknown) =>
  fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(
    async (r) => ({ status: r.status, body: await r.json() }),
  );

const { template } = await get('/api/delegation');
const mandate = {
  owner: owner.address,
  agent: template.agent,
  maxTradeWei: template.caps.maxTradeWei,
  dailyLimitWei: template.caps.dailyLimitWei,
  expiry: String(Math.floor(Date.now() / 1000) + 3600),
  nonce: template.nonce,
};
const signature = await owner.signTypedData({
  domain: template.domain,
  types: template.types,
  primaryType: 'Mandate',
  message: { ...mandate, maxTradeWei: BigInt(mandate.maxTradeWei), dailyLimitWei: BigInt(mandate.dailyLimitWei), expiry: BigInt(mandate.expiry), nonce: BigInt(mandate.nonce) },
});

const forged = await post('/api/delegate', { mandate: { ...mandate, maxTradeWei: '1' }, signature });
console.log('tampered mandate  ->', forged.status, forged.body.error);

const ok = await post('/api/delegate', { mandate, signature });
console.log('delegate          ->', ok.status, ok.body.ok ? `active for ${ok.body.active.owner}` : ok.body.error);

if (process.argv.includes('--keep')) process.exit(0);

const { revokeMessage } = await get('/api/delegation');
const bad = await post('/api/delegation/revoke', { signature: await stranger.signMessage({ message: revokeMessage }) });
console.log('revoke (stranger) ->', bad.status, bad.body.error);
const good = await post('/api/delegation/revoke', { signature: await owner.signMessage({ message: revokeMessage }) });
console.log('revoke (owner)    ->', good.status, good.body.ok ? 'revoked' : good.body.error);
