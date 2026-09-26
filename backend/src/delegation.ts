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
