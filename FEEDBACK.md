# Uniswap Developer Feedback: AXIS

We built an autonomous treasury agent on Sepolia that uses the Uniswap Trading API (`/quote` and `/swap`) for pricing and execution, with Permit2 for ERC-20 input.

## What worked well

- **Time to first swap was short.** We went from API key to a confirmed Sepolia swap in a few minutes. `/quote` on chain 11155111 just worked with native ETH (zero address) and Sepolia USDC.
- **Routing across versions for free.** Without any extra work, our USDC→ETH trades routed through v4 pools and ETH→USDC through a v3 pool. `routeString` made it easy to show the route in our UI.
- **`permitData` is ready to sign.** The quote returns the EIP-712 `domain`, `types` and `values`, so signing with viem's `signTypedData` and passing it to `/swap` needed no transformation.
- **`isTokenApprovalApplicable`** on the quote is a helpful hint for agents deciding whether an approval transaction is needed.

## Friction we hit

- **Response shapes differ by flow.** For a native-ETH input, the `/quote` response already included a `swapTransaction`, while the ERC-20 flow needs `/swap` with a signed permit. It wasn't obvious from the response whether calling `/swap` was still required. A single documented field like `nextStep` would help agent builders.
- **Testnet price asymmetry is surprising.** On Sepolia, 0.001 ETH→USDC quoted about 32,300 USDC/ETH, while 1 USDC→ETH implied about 23,200 USDC/ETH (different pools). That's expected on thin testnet liquidity, but an agent valuing a portfolio can't tell. A pool-liquidity or "thin market" flag on the quote would help.
- **Permit amounts default to max uint160** with a ~30-day expiration. For an autonomous agent, we'd rather request an exact-amount, short-lived permit to limit blast radius. A request parameter for that would be very useful.
- **Error bodies vary** (`detail`, `errorCode`, or plain objects), so we had to handle several shapes.

## Feature requests

1. An "agent mode" quote option: exact-amount permits, a short expiry, and simulation results returned inline.
2. A documented, stable way to get a mid-price for valuation without executing a quote for a probe amount.
3. Sepolia examples in the docs, since hackathon agents mostly live on testnets.
