import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { agentAccount } from './chain.js';
import { policy } from './policy.js';
import { listActivity, listProposals, log } from './store.js';
import { expireStale, reject, requestTrade, snapshot, tick } from './agent.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(fileURLToPath(new URL('../../web', import.meta.url))));

const fail = (res: express.Response, err: unknown, status = 400) =>
  res.status(status).json({ error: (err as Error).message });

app.get('/api/status', async (_req, res) => {
  try {
    expireStale();
    const { snap } = await snapshot();
    res.json({
      agent: agentAccount.address,
      chainId: 11155111,
      policy: {
        ...policy,
        autoLimit: policy.autoLimit.toString(),
        hardLimit: policy.hardLimit.toString(),
        dailyLimit: policy.dailyLimit.toString(),
      },
      treasury: snap,
    });
  } catch (err) {
    fail(res, err, 500);
  }
});

app.get('/api/proposals', (_req, res) => {
  expireStale();
  res.json(listProposals());
});

app.get('/api/activity', (_req, res) => res.json(listActivity()));

// Run one agent cycle now (the loop also runs on an interval).
app.post('/api/agent/tick', async (_req, res) => {
  try {
    res.json(await tick());
  } catch (err) {
    fail(res, err, 500);
  }
});

// Ask the agent for a specific trade; the policy still decides whether it may execute.
app.post('/api/proposals', async (req, res) => {
  const { tokenIn, amount, rationale } = req.body ?? {};
  if (tokenIn !== 'ETH' && tokenIn !== 'USDC') return fail(res, new Error('tokenIn must be ETH or USDC'));
  try {
    res.json(await requestTrade(tokenIn, String(amount), rationale || 'Requested from dashboard'));
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/proposals/:id/reject', (req, res) => {
  try {
    res.json(reject(req.params.id, 'rejected by user'));
  } catch (err) {
    fail(res, err);
  }
});

export { app };
