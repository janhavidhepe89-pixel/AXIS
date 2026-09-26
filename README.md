# AXIS

**An autonomous treasury agent that trades on Uniswap by itself for small moves, and needs a fresh World ID human verification for the moves that matter.**

AI agents that hold money have an uncomfortable choice: either a human signs every transaction (so it isn't autonomous), or the agent can do anything (so one bad prompt or bug drains the wallet). AXIS puts a policy between the two:

| Trade size (ETH-equivalent) | What happens |
| --- | --- |
| ≤ 0.002 ETH | Agent executes on Uniswap immediately |
| 0.002 to 0.02 ETH | Agent proposes. It executes **only** after a *fresh* World ID verification by the treasury's owner, validated on the backend |
| > 0.02 ETH, or over the 24h limit | Blocked. Nobody can approve it |

## How it works

```
             ┌──────────── every 60s ────────────┐
             ▼                                   │
  value treasury with a live       drift > 10% from 50/50 target?
  Uniswap Trading API quote  ───▶  propose ETH⇄USDC rebalance
                                          │
                                   policy.decide()
                 ┌────────────────────────┼─────────────────────────┐
               auto                  needs_human                  blocked
                 │                        │                          │
                 │         World ID OIDC (PKCE + nonce,              ✗ never runs
                 │         prompt=login, max_age=120)
                 │                        │
                 │         backend: code exchange, verify ID token
                 │         (JWKS sig, iss, aud, nonce, auth_time),
                 │         subject must match treasury owner
                 │                  ok │     │ cancelled / denied / expired / wrong human
                 ▼                     ▼     └────────▶ proposal rejected, ✗ never runs
     Uniswap Trading API: quote → Permit2 approve/sign → /swap → broadcast on Sepolia
```

- **Chain:** Ethereum Sepolia. The agent's wallet holds the treasury (ETH + USDC).
- **Routing:** the Trading API picks v3 or **v4** pools. We've seen both routes on-chain.
- **Human layer:** World ID for Agents sandbox (OIDC). Each approval is bound to a single proposal via `state`, and can only be used once.

## Tracks

### Uniswap Foundation: Best Uniswap Stack Contribution

The agent's whole execution path is the Uniswap Trading API:

- Pricing and treasury valuation from a live quote: [`backend/src/agent.ts:34`](backend/src/agent.ts#L34)
- Quote request: [`backend/src/uniswap.ts:40`](backend/src/uniswap.ts#L40)
- Permit2 allowance for ERC-20 input: [`backend/src/uniswap.ts:54`](backend/src/uniswap.ts#L54)
- Signing `permitData` (EIP-712) and calling `/swap`: [`backend/src/uniswap.ts:73`](backend/src/uniswap.ts#L73)
- Broadcasting and confirming the swap: [`backend/src/uniswap.ts:96`](backend/src/uniswap.ts#L96)
- Live test script: [`backend/scripts/smoke-swap.ts`](backend/scripts/smoke-swap.ts)

Example Sepolia transactions made by the agent:
- ETH→USDC via a v3 route: [0x6995…d023](https://sepolia.etherscan.io/tx/0x6995714ae3580c9f87e207b896a4fd28a33b136bd302dbaf9d1ca3b7a8bcd023)
- Permit2 approval: [0x68bc…d29e](https://sepolia.etherscan.io/tx/0x68bc4f970e45b470bf57913b5de7fbd82d5426e0dc52a053292c9fa33661d29e)
- USDC→ETH via v4 pools: [0x8c78…de7f](https://sepolia.etherscan.io/tx/0x8c78bb17281cb7429bd4fd5a4e587ea9bc7cb5ce71d4aa8b68e6173ba99cde7f)
- Autonomous policy-approved trade: [0x475d…e8c3](https://sepolia.etherscan.io/tx/0x475da7b98f6f564a86a4f16be8356f3837433b3015d1a1d9bf5588b4a54be8c3)

Feedback: [FEEDBACK.md](FEEDBACK.md)

### World: Best Use of World ID for Agents

**Protected action:** the agent moving a meaningful share of the treasury. The agent is autonomous for small trades, but it cannot run a large one until a verified human, the *same* human who owns the treasury, completes a fresh verification for that specific trade.

- Start a verification for one proposal (PKCE S256, `state`, `nonce`, `prompt=login`, `max_age`): [`backend/src/worldid.ts:35`](backend/src/worldid.ts#L35)
- Server-side validation (code exchange with the client secret, ID token signature against JWKS, `iss`, `aud`, `nonce`, `auth_time` freshness): [`backend/src/worldid.ts:63`](backend/src/worldid.ts#L63)
- Approval routes, owner binding by pairwise `sub`, rejecting on any failure: [`backend/src/server.ts:90`](backend/src/server.ts#L90)
- Execution refuses `needs_human` proposals without a validated approval: [`backend/src/agent.ts:138`](backend/src/agent.ts#L138)

**Unsuccessful paths (the trade never executes):** the user cancels or World ID returns an error; the 10-minute approval window expires; the authentication is older than 120s; the nonce or state doesn't match or is replayed; the verified human isn't the treasury owner; the user clicks Reject.

### Curvegrid: Best AI Agent Project

AXIS is a **policy-aware transaction agent**: it watches its portfolio, decides when to act, and executes on-chain while respecting spending limits, a hard cap, a daily budget, and required human approvals. The dashboard shows every decision and its reason.

We did not use MultiBaas. We built directly on viem + the Uniswap Trading API.

## Run it

Requirements: Node 20+, pnpm, a Sepolia wallet with some ETH, a Uniswap API key, and a World ID for Agents sandbox client.

```bash
cd backend
pnpm install
cp .env.example .env        # fill in the values
```

World ID needs a public HTTPS redirect URI. For local runs, use a tunnel:

```bash
cloudflared tunnel --url http://localhost:3001
```

Set `PUBLIC_BASE_URL` in `.env` to the tunnel URL, and register `<PUBLIC_BASE_URL>/auth/callback` as the redirect URI in the [World ID portal](http://sandbox.auth.world.org/portal). The sector identifier document is served at `<PUBLIC_BASE_URL>/sector.json`.

```bash
pnpm start                  # dashboard at http://localhost:3001
pnpm smoke:swap 0.001       # optional: one live ETH->USDC swap
```

### Demo script

1. Open the dashboard. The treasury is off target, so click **Run agent cycle**. The agent proposes a rebalance above the autonomous limit, and it waits for approval.
2. Click **Approve with World ID**, complete verification, and you land back on the dashboard with the executed trade and its Etherscan link.
3. Unsuccessful path: create another large proposal and click **Approve with World ID**, then cancel. Or click **Reject**, or wait out the window. The proposal is rejected or expired, and no transaction is sent.
4. Ask for `0.001 ETH`: it runs on its own. Ask for `0.05 ETH`: it's blocked by the hard limit.

## Team

- Janhavi Bajiraodhepe: _add X / GitHub handle_

## World ID integration debrief

_(to fill in after the final run: time to first success, friction, missing docs, top improvement)_
