/**
 * The AXIS agent loop: value the treasury with a live Uniswap quote, detect drift from the
 * target allocation, propose a rebalancing trade, and route it through the policy.
 */
import { formatEther, formatUnits, parseEther } from 'viem';
import { ETH, USDC, type Token } from './config.js';
import { explorerTx, getBalances } from './chain.js';
import { executeSwap, getQuote } from './uniswap.js';
import { decide, policy } from './policy.js';
import {
  createProposal,
  getProposal,
  listProposals,
  log,
  spentLast24h,
  type Proposal,
} from './store.js';

/** ETH kept aside for gas; never counted as tradeable treasury. */
const GAS_RESERVE = parseEther('0.01');
const PROBE = parseEther('0.001');

export interface Snapshot {
  eth: string;
  usdc: string;
  tradeableEth: string;
  usdcPerEth: number;
  ethPct: number;
  targetEthPct: number;
  totalValueEth: string;
}

/** Raw USDC units received per 1 ETH, from a live Trading API quote. */
async function usdcPerEthRaw(): Promise<bigint> {
  const q = await getQuote(ETH, USDC, PROBE);
  return (BigInt(q.quote.output.amount) * 10n ** 18n) / PROBE;
}

export async function snapshot() {
  const [bal, price] = await Promise.all([getBalances(), usdcPerEthRaw()]);
  const tradeableEth = bal.eth > GAS_RESERVE ? bal.eth - GAS_RESERVE : 0n;
  const usdcInEth = (bal.usdc * 10n ** 18n) / price;
  const total = tradeableEth + usdcInEth;
  const ethPct = total === 0n ? 0 : Number((tradeableEth * 10000n) / total) / 100;
  const snap: Snapshot = {
    eth: formatEther(bal.eth),
    usdc: formatUnits(bal.usdc, 6),
    tradeableEth: formatEther(tradeableEth),
    usdcPerEth: Number(formatUnits(price, 6)),
    ethPct,
    targetEthPct: policy.targetEthPct,
    totalValueEth: formatEther(total),
  };
  return { snap, tradeableEth, usdcInEth, total, price };
}

const tokens = { ETH, USDC } as const;

function describe(p: Pick<Proposal, 'tokenIn' | 'tokenOut' | 'amountIn'>): string {
  const t = tokens[p.tokenIn];
  return `${formatUnits(BigInt(p.amountIn), t.decimals)} ${p.tokenIn} -> ${p.tokenOut}`;
}

/** Create a proposal for selling `amountIn` of `tokenIn`, classified by the policy. */
export async function propose(
  tokenIn: 'ETH' | 'USDC',
  amountIn: bigint,
  valueEth: bigint,
  rationale: string,
): Promise<Proposal> {
  const decision = decide(valueEth, spentLast24h());
  const p = createProposal({
    tokenIn,
    tokenOut: tokenIn === 'ETH' ? 'USDC' : 'ETH',
    amountIn: amountIn.toString(),
    valueEth: valueEth.toString(),
    rationale,
    decision: decision.kind,
    decisionReason: decision.reason,
    status: decision.kind === 'blocked' ? 'blocked' : 'pending_approval',
    expiresAt: decision.kind === 'needs_human' ? Date.now() + policy.approvalTtlMs : undefined,
  });
  log('info', `Proposed ${describe(p)} (${formatEther(valueEth)} ETH value): ${decision.reason}`, p.id);
  if (decision.kind === 'blocked') log('denied', `Blocked by policy: ${decision.reason}`, p.id);
  if (decision.kind === 'auto') await execute(p.id);
  return p;
}

/** Manual request, e.g. from the dashboard: "sell X of token". Valued with a live quote. */
export async function requestTrade(tokenIn: 'ETH' | 'USDC', amount: string, rationale: string) {
  const t = tokens[tokenIn];
  const amountIn = BigInt(Math.round(Number(amount) * 10 ** t.decimals));
  if (amountIn <= 0n) throw new Error('amount must be positive');
  const valueEth = tokenIn === 'ETH' ? amountIn : (amountIn * 10n ** 18n) / (await usdcPerEthRaw());
  return propose(tokenIn, amountIn, valueEth, rationale);
}

/** One agent cycle: check drift and propose a rebalance if needed. */
export async function tick(): Promise<{ snap: Snapshot; proposal?: Proposal }> {
  expireStale();
  const { snap, tradeableEth, usdcInEth, total, price } = await snapshot();
  if (listProposals().some((p) => p.status === 'pending_approval' || p.status === 'executing')) {
    return { snap };
  }
  const drift = snap.ethPct - policy.targetEthPct;
  if (total === 0n || Math.abs(drift) <= policy.driftThresholdPct) {
    log('info', `Allocation ${snap.ethPct.toFixed(1)}% ETH is within ${policy.driftThresholdPct}% of target`);
    return { snap };
  }
  const targetEth = (total * BigInt(policy.targetEthPct)) / 100n;
  const rationale = `Allocation drifted to ${snap.ethPct.toFixed(1)}% ETH (target ${policy.targetEthPct}%)`;
  if (tradeableEth > targetEth) {
    const value = tradeableEth - targetEth;
    return { snap, proposal: await propose('ETH', value, value, rationale) };
  }
  const value = targetEth - tradeableEth;
  const usdcIn = (value * price) / 10n ** 18n;
  if (usdcIn > 0n && usdcInEth > 0n) {
    return { snap, proposal: await propose('USDC', usdcIn, value, rationale) };
  }
  return { snap };
}

export function expireStale() {
  for (const p of listProposals()) {
    if (p.status === 'pending_approval' && p.expiresAt && Date.now() > p.expiresAt) {
      p.status = 'expired';
      log('denied', `Approval window expired, trade not executed: ${describe(p)}`, p.id);
    }
  }
}

/** Execute a proposal on Uniswap. Only reachable via auto-policy or a validated human approval. */
export async function execute(id: string): Promise<Proposal> {
  const p = getProposal(id);
  if (!p) throw new Error('unknown proposal');
  if (p.status !== 'pending_approval') throw new Error(`proposal is ${p.status}`);
  if (p.decision === 'needs_human' && !p.approvedBy) throw new Error('human approval required');
  p.status = 'executing';
  const tokenIn: Token = tokens[p.tokenIn];
  const tokenOut: Token = tokens[p.tokenOut];
  try {
    const q = await getQuote(tokenIn, tokenOut, BigInt(p.amountIn));
    const res = await executeSwap(tokenIn, BigInt(p.amountIn), q);
    if (res.approvalTx) p.txs.push({ label: 'Permit2 approval', hash: res.approvalTx });
    p.txs.push({ label: `Swap via ${q.quote.routeString?.slice(0, 4) ?? q.routing}`, hash: res.swapTx });
    if (res.status !== 'success') throw new Error(`swap reverted: ${explorerTx(res.swapTx)}`);
    p.status = 'executed';
    log('trade', `Executed ${describe(p)}: ${explorerTx(res.swapTx)}`, p.id);
  } catch (err) {
    p.status = 'failed';
    p.error = (err as Error).message;
    log('error', `Execution failed for ${describe(p)}: ${p.error}`, p.id);
  }
  return p;
}

/** Called only after the backend has validated a fresh World ID authentication. */
export async function approveAndExecute(id: string, subject: string): Promise<Proposal> {
  const p = getProposal(id);
  if (!p) throw new Error('unknown proposal');
  expireStale();
  if (p.status !== 'pending_approval') throw new Error(`proposal is ${p.status}, cannot approve`);
  p.approvedBy = subject;
  p.approvedAt = Date.now();
  log('approval', `Verified human approved ${describe(p)}`, p.id);
  return execute(id);
}

export function reject(id: string, reason: string): Proposal {
  const p = getProposal(id);
  if (!p) throw new Error('unknown proposal');
  if (p.status !== 'pending_approval') throw new Error(`proposal is ${p.status}`);
  p.status = 'rejected';
  p.error = reason;
  log('denied', `Trade not executed (${reason}): ${describe(p)}`, p.id);
  return p;
}
