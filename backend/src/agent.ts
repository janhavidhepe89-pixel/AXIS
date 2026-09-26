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
