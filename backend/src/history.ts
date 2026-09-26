/** Time series of treasury snapshots for the dashboard charts. In-memory, resets on restart. */
import type { Snapshot } from './agent.js';

export interface HistoryPoint {
  at: number;
  ethPct: number;
  totalValueEth: number;
  usdcPerEth: number;
  eth: number;
  usdc: number;
}

const MIN_GAP_MS = 10_000;
const MAX_POINTS = 2000;
const points: HistoryPoint[] = [];

export function record(snap: Snapshot, force = false) {
  const last = points[points.length - 1];
  if (!force && last && Date.now() - last.at < MIN_GAP_MS) return;
  points.push({
    at: Date.now(),
    ethPct: snap.ethPct,
    totalValueEth: Number(snap.totalValueEth),
    usdcPerEth: snap.usdcPerEth,
    eth: Number(snap.eth),
    usdc: Number(snap.usdc),
  });
  if (points.length > MAX_POINTS) points.shift();
}

export const listHistory = () => points;
