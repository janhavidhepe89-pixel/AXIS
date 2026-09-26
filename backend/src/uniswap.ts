/**
 * Uniswap Trading API client: quote -> (approve Permit2 + sign permit) -> swap -> broadcast.
 * Docs: https://developers.uniswap.org/
 */
import { erc20Abi, maxUint256, type Address, type Hex } from 'viem';
import { config, CHAIN_ID, type Token } from './config.js';
import { agentAccount, publicClient, walletClient } from './chain.js';

const API = 'https://trade-api.gateway.uniswap.org/v1';
const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

interface TxRequest {
  to: Address;
  data: Hex;
  value?: string;
  gasLimit?: string;
}

export interface QuoteResult {
  requestId: string;
  routing: string;
  quote: any;
  permitData: any | null;
  swapTransaction?: TxRequest;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.uniswapApiKey },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Uniswap API ${path} ${res.status}: ${json.detail || json.errorCode || JSON.stringify(json)}`);
  }
  return json as T;
}

export async function getQuote(tokenIn: Token, tokenOut: Token, amountIn: bigint, slippage = 2.5) {
  return post<QuoteResult>('/quote', {
    type: 'EXACT_INPUT',
    amount: amountIn.toString(),
    tokenInChainId: CHAIN_ID,
    tokenOutChainId: CHAIN_ID,
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    swapper: agentAccount.address,
    slippageTolerance: slippage,
  });
}

/** ERC-20 inputs go through Permit2: make sure Permit2 can pull the agent's tokens. */
async function ensurePermit2Allowance(token: Token, amount: bigint): Promise<Hex | null> {
  if (token.address === '0x0000000000000000000000000000000000000000') return null;
  const allowance = await publicClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [agentAccount.address, PERMIT2],
  });
  if (allowance >= amount) return null;
  const hash = await walletClient.writeContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'approve',
    args: [PERMIT2, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function buildSwapTx(q: QuoteResult): Promise<TxRequest> {
  const body: Record<string, unknown> = { quote: q.quote };
  if (q.permitData) {
    const { domain, types, values } = q.permitData;
    body.signature = await agentAccount.signTypedData({
      domain,
      types,
      primaryType: 'PermitSingle',
      message: values,
    });
    body.permitData = q.permitData;
  }
  const res = await post<{ swap: TxRequest }>('/swap', body);
  return res.swap;
}

export interface SwapResult {
  approvalTx: Hex | null;
  swapTx: Hex;
  status: 'success' | 'reverted';
}

/** Execute a quote from the agent wallet and wait for the receipt. */
export async function executeSwap(tokenIn: Token, amountIn: bigint, q: QuoteResult): Promise<SwapResult> {
  const approvalTx = await ensurePermit2Allowance(tokenIn, amountIn);
  const tx = await buildSwapTx(q);
  const swapTx = await walletClient.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value ? BigInt(tx.value) : 0n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapTx });
  return { approvalTx, swapTx, status: receipt.status };
}
