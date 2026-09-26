import { createPublicClient, createWalletClient, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { config, ETH, USDC } from './config.js';

export const agentAccount = privateKeyToAccount(config.agentPrivateKey);

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(config.rpcUrl),
});

export const walletClient = createWalletClient({
  account: agentAccount,
  chain: sepolia,
  transport: http(config.rpcUrl),
});

export interface Balances {
  eth: bigint;
  usdc: bigint;
}

export async function getBalances(): Promise<Balances> {
  const [eth, usdc] = await Promise.all([
    publicClient.getBalance({ address: agentAccount.address }),
    publicClient.readContract({
      address: USDC.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [agentAccount.address],
    }),
  ]);
  return { eth, usdc };
}

export const explorerTx = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

export { ETH, USDC };
