/** In-memory state: trade proposals and an activity log. Resets on restart. */
import { randomUUID } from 'node:crypto';

export type ProposalStatus =
  | 'pending_approval'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'rejected'
  | 'expired'
  | 'blocked';

export interface Proposal {
  id: string;
  createdAt: number;
  tokenIn: 'ETH' | 'USDC';
  tokenOut: 'ETH' | 'USDC';
  amountIn: string; // raw units
  valueEth: string; // wei
  rationale: string;
  decision: 'auto' | 'needs_human' | 'blocked';
  decisionReason: string;
  status: ProposalStatus;
  expiresAt?: number;
  approvedBy?: string; // World ID pairwise subject
  approvedAt?: number;
  txs: { label: string; hash: string }[];
  executedAt?: number;
  ethPctBefore?: number;
  ethPctAfter?: number;
  error?: string;
}

export interface Activity {
  at: number;
  kind: 'info' | 'trade' | 'approval' | 'denied' | 'error';
  message: string;
  proposalId?: string;
}

const proposals = new Map<string, Proposal>();
const activity: Activity[] = [];

export function createProposal(p: Omit<Proposal, 'id' | 'createdAt' | 'txs'>): Proposal {
  const proposal: Proposal = { ...p, id: randomUUID(), createdAt: Date.now(), txs: [] };
  proposals.set(proposal.id, proposal);
  return proposal;
}

export const getProposal = (id: string) => proposals.get(id);

export function listProposals(): Proposal[] {
  return [...proposals.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function log(kind: Activity['kind'], message: string, proposalId?: string) {
  activity.unshift({ at: Date.now(), kind, message, proposalId });
  if (activity.length > 200) activity.pop();
  console.log(`[${kind}] ${message}`);
}

export const listActivity = () => activity;

/** Value moved by executed trades in the last 24h, in wei of ETH-equivalent. */
export function spentLast24h(): bigint {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  return listProposals()
    .filter((p) => p.status === 'executed' && p.createdAt >= since)
    .reduce((sum, p) => sum + BigInt(p.valueEth), 0n);
}
