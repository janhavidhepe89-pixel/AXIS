/**
 * Policy: what the agent may do on its own, what needs a verified human, and what is never allowed.
 * All trade sizes are measured in ETH-equivalent value.
 */
import { parseEther } from 'viem';

export const policy = {
  /** Target share of treasury value held in ETH (rest in USDC). */
  targetEthPct: 50,
  /** Rebalance only when allocation drifts further than this from target. */
  driftThresholdPct: 10,
  /** Trades at or below this value run autonomously. */
  autoLimit: parseEther('0.002'),
  /** Trades above this value are refused outright, even with approval. */
  hardLimit: parseEther('0.02'),
  /** Total value the agent may move per rolling 24h, including approved trades. */
  dailyLimit: parseEther('0.03'),
  /** A proposal waiting for human approval expires after this long. */
  approvalTtlMs: 10 * 60 * 1000,
  /** World ID authentication must be at most this old when approving. */
  maxAuthAgeSec: 120,
};

export type Decision =
  | { kind: 'auto'; reason: string }
  | { kind: 'needs_human'; reason: string }
  | { kind: 'blocked'; reason: string };

/** Limits granted by the owner's signed delegation mandate (always within the agent's own caps). */
export interface MandateLimits {
  maxTradeWei: string;
  dailyLimitWei: string;
}

export function decide(valueEth: bigint, spentLast24h: bigint, mandate: MandateLimits | null): Decision {
  if (!mandate) {
    return { kind: 'blocked', reason: 'no active delegation from the treasury owner' };
  }
  const hardLimit = BigInt(mandate.maxTradeWei) < policy.hardLimit ? BigInt(mandate.maxTradeWei) : policy.hardLimit;
  const dailyLimit = BigInt(mandate.dailyLimitWei) < policy.dailyLimit ? BigInt(mandate.dailyLimitWei) : policy.dailyLimit;
  if (valueEth > hardLimit) {
    return { kind: 'blocked', reason: 'exceeds per-trade limit of the delegation' };
  }
  if (spentLast24h + valueEth > dailyLimit) {
    return { kind: 'blocked', reason: 'would exceed 24h spending limit' };
  }
  if (valueEth <= policy.autoLimit) {
    return { kind: 'auto', reason: 'within autonomous limit' };
  }
  return { kind: 'needs_human', reason: 'above autonomous limit: fresh World ID approval required' };
}
