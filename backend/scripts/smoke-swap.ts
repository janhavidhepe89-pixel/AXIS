/** Smoke test: swap a tiny amount of ETH -> USDC from the agent wallet via the Trading API. */
import { formatEther, formatUnits, parseEther } from 'viem';
import { agentAccount, explorerTx, getBalances } from '../src/chain.js';
import { ETH, USDC } from '../src/config.js';
import { executeSwap, getQuote } from '../src/uniswap.js';

const amount = parseEther(process.argv[2] || '0.001');
console.log('agent', agentAccount.address);
const before = await getBalances();
console.log('before', formatEther(before.eth), 'ETH', formatUnits(before.usdc, 6), 'USDC');

const q = await getQuote(ETH, USDC, amount);
console.log('quote', q.routing, q.quote.routeString, '->', formatUnits(BigInt(q.quote.output.amount), 6), 'USDC');

const res = await executeSwap(ETH, amount, q);
console.log(res.status, explorerTx(res.swapTx));

const after = await getBalances();
console.log('after', formatEther(after.eth), 'ETH', formatUnits(after.usdc, 6), 'USDC');
