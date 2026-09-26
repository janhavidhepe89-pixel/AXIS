import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { agentAccount } from './chain.js';
import { policy } from './policy.js';
import { listActivity, listProposals, log } from './store.js';
import { approveAndExecute, expireStale, reject, requestTrade, snapshot, tick } from './agent.js';
import { beginApproval, completeApproval, redirectUri } from './worldid.js';

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

// ---------------------------------------------------------------------------
// World ID human approval
// ---------------------------------------------------------------------------

/**
 * The first verified human to approve becomes the treasury owner. Later approvals must come
 * from the same World ID pairwise subject, so another person can't approve the agent's trades.
 */
let ownerSubject: string | null = process.env.OWNER_SUBJECT || null;

app.get('/api/owner', (_req, res) => res.json({ bound: !!ownerSubject }));

// Start a fresh World ID verification for one specific proposal.
app.get('/auth/approve/:id', (req, res) => {
  expireStale();
  const p = listProposals().find((x) => x.id === req.params.id);
  if (!p || p.status !== 'pending_approval' || p.decision !== 'needs_human') {
    return res.redirect(`/?result=error&reason=${encodeURIComponent('proposal is not awaiting approval')}`);
  }
  log('info', 'Requested fresh World ID verification for high-value trade', p.id);
  res.redirect(beginApproval(p.id));
});

app.get('/auth/callback', async (req, res) => {
  const result = await completeApproval(req.query as Record<string, unknown>);
  const back = (params: Record<string, string>) => res.redirect(`/?${new URLSearchParams(params)}`);

  if (!result.ok) {
    if (result.proposalId) {
      try {
        reject(result.proposalId, `verification failed: ${result.reason}`);
      } catch {
        // already expired or resolved
      }
    } else {
      log('denied', `Rejected World ID callback: ${result.reason}`);
    }
    return back({ result: 'denied', reason: result.reason });
  }

  if (ownerSubject && ownerSubject !== result.subject) {
    reject(result.proposalId, 'verified human is not the treasury owner');
    return back({ result: 'denied', reason: 'verified human is not the treasury owner' });
  }
  if (!ownerSubject) {
    ownerSubject = result.subject;
    log('approval', 'Bound treasury owner to verified World ID human');
  }

  try {
    const p = await approveAndExecute(result.proposalId, result.subject);
    back({ result: p.status, id: p.id });
  } catch (err) {
    back({ result: 'error', reason: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------

const TICK_MS = parseInt(process.env.TICK_MS || '60000');

app.listen(config.port, () => {
  console.log(`AXIS agent ${agentAccount.address} on Sepolia`);
  console.log(`Dashboard: http://localhost:${config.port}  (public: ${config.publicBaseUrl})`);
  console.log(`World ID redirect URI: ${redirectUri}`);
  setInterval(() => tick().catch((e) => log('error', `tick failed: ${e.message}`)), TICK_MS);
});
