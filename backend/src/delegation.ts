/**
 * Delegation: the treasury owner signs an EIP-712 mandate that authorizes the AXIS agent to trade
 * within limits until an expiry. The agent does nothing without an active mandate, and the owner can
 * revoke it at any time with a signature from the same wallet.
 */
import { getAddress, verifyMessage, verifyTypedData, type Address, type Hex } from 'viem';
import { CHAIN_ID } from './config.js';
import { agentAccount } from './chain.js';
import { policy } from './policy.js';
import { log } from './store.js';

export const mandateDomain = { name: 'AXIS', version: '1', chainId: CHAIN_ID } as const;

export const mandateTypes = {
  Mandate: [
    { name: 'owner', type: 'address' },
    { name: 'agent', type: 'address' },
    { name: 'maxTradeWei', type: 'uint256' },
    { name: 'dailyLimitWei', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export interface Mandate {
  owner: Address;
  agent: Address;
  maxTradeWei: string;
  dailyLimitWei: string;
  expiry: string; // unix seconds
  nonce: string;
}

interface ActiveMandate extends Mandate {
  signature: Hex;
  delegatedAt: number;
}

let active: ActiveMandate | null = null;
let nonce = 1;

export function getMandate(): ActiveMandate | null {
  if (active && Number(active.expiry) * 1000 <= Date.now()) {
    log('denied', 'Delegation mandate expired: agent paused until the owner delegates again');
    active = null;
  }
  return active;
}

export const nextNonce = () => nonce;

export function revokeMessage(owner: Address, n: string) {
  return `Revoke AXIS delegation\nowner: ${getAddress(owner)}\nagent: ${agentAccount.address}\nnonce: ${n}`;
}

/** Verify a signed mandate and make it the active delegation. */
export async function delegate(m: Mandate, signature: Hex): Promise<ActiveMandate> {
  const mandate: Mandate = {
    owner: getAddress(m.owner),
    agent: getAddress(m.agent),
    maxTradeWei: String(m.maxTradeWei),
    dailyLimitWei: String(m.dailyLimitWei),
    expiry: String(m.expiry),
    nonce: String(m.nonce),
  };
  if (mandate.agent !== agentAccount.address) throw new Error('mandate is for a different agent');
  if (BigInt(mandate.nonce) !== BigInt(nonce)) throw new Error('stale mandate nonce');
  if (Number(mandate.expiry) * 1000 <= Date.now()) throw new Error('mandate already expired');
  if (BigInt(mandate.maxTradeWei) > policy.hardLimit) throw new Error('max trade exceeds the agent hard limit');
  if (BigInt(mandate.dailyLimitWei) > policy.dailyLimit) throw new Error('daily limit exceeds the agent cap');
  if (active && active.owner !== mandate.owner) throw new Error('treasury already delegated by another owner');

  const valid = await verifyTypedData({
    address: mandate.owner,
    domain: mandateDomain,
    types: mandateTypes,
    primaryType: 'Mandate',
    message: {
      owner: mandate.owner,
      agent: mandate.agent,
      maxTradeWei: BigInt(mandate.maxTradeWei),
      dailyLimitWei: BigInt(mandate.dailyLimitWei),
      expiry: BigInt(mandate.expiry),
      nonce: BigInt(mandate.nonce),
    },
    signature,
  });
  if (!valid) throw new Error('invalid mandate signature');

  nonce += 1;
  active = { ...mandate, signature, delegatedAt: Date.now() };
  log('approval', `Owner ${mandate.owner} delegated trading to the agent until ${new Date(Number(mandate.expiry) * 1000).toISOString()}`);
  return active;
}

/** Revoke the active mandate; must be signed by the owner who granted it. */
export async function revoke(signature: Hex): Promise<void> {
  const m = getMandate();
  if (!m) throw new Error('no active delegation');
  const valid = await verifyMessage({ address: m.owner, message: revokeMessage(m.owner, m.nonce), signature });
  if (!valid) throw new Error('revocation must be signed by the delegating owner');
  active = null;
  log('denied', `Owner ${m.owner} revoked the delegation: agent paused`);
}
