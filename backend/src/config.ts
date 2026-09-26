import 'dotenv/config';
import type { Address, Hex } from 'viem';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}

export const CHAIN_ID = 11155111; // Sepolia

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3001').replace(/\/$/, ''),
  rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
  agentPrivateKey: required('AGENT_PRIVATE_KEY') as Hex,
  uniswapApiKey: required('UNISWAP_API_KEY'),
  world: {
    issuer: process.env.WORLD_ISSUER || 'https://sandbox.auth.world.org',
    clientId: required('WORLD_CLIENT_ID'),
    clientSecret: required('WORLD_CLIENT_SECRET'),
  },
};

export interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

// Native ETH is represented by the zero address in the Uniswap Trading API.
export const ETH: Token = {
  symbol: 'ETH',
  address: '0x0000000000000000000000000000000000000000',
  decimals: 18,
};

export const USDC: Token = {
  symbol: 'USDC',
  address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  decimals: 6,
};
