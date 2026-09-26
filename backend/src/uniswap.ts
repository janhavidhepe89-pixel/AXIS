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
