import { updateCharts } from './charts.js';
import { initDelegation, loadDelegation } from './delegation.js';

const $ = (id) => document.getElementById(id);
const fmtEth = (wei) => `${(Number(wei) / 1e18).toFixed(4)} ETH`;
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const tx = (hash) => `https://sepolia.etherscan.io/tx/${hash}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function showBanner(kind, text) {
  const b = $('banner');
  b.className = kind;
  b.textContent = text;
  b.hidden = false;
}

let status = null;
let proposals = [];

async function loadStatus() {
  const s = await api('/api/status');
  status = s;
  const t = s.treasury;
  $('agent-addr').textContent = `${s.agent.slice(0, 6)}…${s.agent.slice(-4)}`;
  $('eth').textContent = Number(t.eth).toFixed(4);
  $('usdc').textContent = Number(t.usdc).toFixed(2);
  $('price').textContent = `${Math.round(t.usdcPerEth).toLocaleString()} USDC`;
  $('alloc-eth').style.width = `${t.ethPct}%`;
  $('alloc-target').style.left = `${t.targetEthPct}%`;
  $('alloc-label').textContent = `${t.ethPct.toFixed(1)}% ETH / ${(100 - t.ethPct).toFixed(1)}% USDC`;
  $('target-label').textContent = `target ${t.targetEthPct}% ETH (±${s.policy.driftThresholdPct}%)`;
  $('p-auto').textContent = fmtEth(s.policy.autoLimit);
  $('p-human').textContent = fmtEth(s.policy.autoLimit);
  $('p-hard').textContent = fmtEth(s.policy.hardLimit);
  $('p-daily').textContent = fmtEth(s.policy.dailyLimit);
  $('p-ttl').textContent = `${s.policy.approvalTtlMs / 60000} min`;
}

function amountLabel(p) {
  const dec = p.tokenIn === 'ETH' ? 18 : 6;
  const n = Number(p.amountIn) / 10 ** dec;
  return `${n.toFixed(p.tokenIn === 'ETH' ? 5 : 2)} ${p.tokenIn} → ${p.tokenOut}`;
}

function renderProposal(p) {
  const waiting = p.status === 'pending_approval' && p.decision === 'needs_human';
  const left = waiting && p.expiresAt ? ` · expires ${fmtTime(p.expiresAt)}` : '';
  const txs = p.txs.map((t) => `<a href="${tx(t.hash)}" target="_blank" rel="noopener">${esc(t.label)} ↗</a>`).join('');
  return `
    <div class="proposal">
      <div class="title">${esc(amountLabel(p))}
        <span class="status s-${p.status}">${p.status.replace('_', ' ')}</span></div>
      <div class="btns">${
        waiting
          ? `<a class="button" href="/auth/approve/${p.id}">Approve with World ID</a>
             <button class="ghost" data-reject="${p.id}">Reject</button>`
          : ''
      }</div>
      <div class="sub">${esc(p.rationale)} · ${fmtEth(p.valueEth)} value · ${esc(p.decisionReason)}${left}
        ${p.approvedBy ? ' · approved by verified human' : ''}${p.error ? ` · ${esc(p.error)}` : ''}</div>
      ${txs ? `<div class="txs">${txs}</div>` : ''}
    </div>`;
}

function renderRebalances(list) {
  const done = list.filter((p) => p.status === 'executed');
  $('k-count').textContent = done.length;
  $('k-human').textContent = done.filter((p) => p.approvedBy).length;
  $('k-denied').textContent = list.filter((p) => ['blocked', 'rejected', 'expired'].includes(p.status)).length;
  if (!done.length) return;
  $('rebalances').tBodies[0].innerHTML = done
    .map((p) => {
      const swap = p.txs[p.txs.length - 1];
      const allocation =
        p.ethPctBefore != null && p.ethPctAfter != null
          ? `${p.ethPctBefore.toFixed(1)}% → ${p.ethPctAfter.toFixed(1)}% <span class="delta">ETH</span>`
          : '–';
      const by = p.approvedBy
        ? '<span class="tag human">World ID human</span>'
        : '<span class="tag auto">Agent (auto)</span>';
      return `<tr>
        <td>${fmtTime(p.executedAt || p.createdAt)}</td>
        <td>${esc(amountLabel(p))}</td>
        <td>${fmtEth(p.valueEth)}</td>
        <td>${allocation}</td>
        <td>${by}</td>
        <td>${swap ? `<a href="${tx(swap.hash)}" target="_blank" rel="noopener">${swap.hash.slice(0, 10)}… ↗</a>` : '–'}</td>
      </tr>`;
    })
    .join('');
}

async function loadHistory() {
  const history = await api('/api/history');
  if (status) updateCharts(history, proposals, status.policy);
}

async function loadProposals() {
  const list = await api('/api/proposals');
  proposals = list;
  renderRebalances(list);
  $('proposals').innerHTML = list.length ? list.map(renderProposal).join('') : '<p class="empty">No proposals yet.</p>';
}

async function loadActivity() {
  const items = await api('/api/activity');
  $('activity').innerHTML = items
    .map((a) => `<li><time>${fmtTime(a.at)}</time><span class="k k-${a.kind}">${a.kind}</span><span>${esc(a.message)}</span></li>`)
    .join('');
}

async function refresh() {
  await Promise.allSettled([loadStatus(), loadProposals(), loadActivity(), loadDelegation()]);
  await loadHistory().catch(() => {});
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

$('tick').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('/api/agent/tick', { method: 'POST' });
    if (!r.proposal) showBanner('ok', 'Agent cycle done: allocation within target, no trade needed.');
  } catch (err) {
    showBanner('bad', err.message);
  } finally {
    e.target.disabled = false;
    refresh();
  }
});

$('request').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const p = await api('/api/proposals', {
      method: 'POST',
      body: JSON.stringify({ tokenIn: $('req-token').value, amount: $('req-amount').value }),
    });
    const msg = {
      auto: 'Within the autonomous limit, so the agent executed it.',
      needs_human: 'Above the autonomous limit: approve it with World ID to execute.',
      blocked: `Blocked by policy: ${p.decisionReason}.`,
    }[p.decision];
    showBanner(p.decision === 'blocked' ? 'bad' : 'ok', msg);
  } catch (err) {
    showBanner('bad', err.message);
  } finally {
    btn.disabled = false;
    refresh();
  }
});

$('proposals').addEventListener('click', async (e) => {
  const id = e.target.dataset?.reject;
  if (!id) return;
  try {
    await api(`/api/proposals/${id}/reject`, { method: 'POST' });
  } catch (err) {
    showBanner('bad', err.message);
  }
  refresh();
});

// Result of a World ID round trip, passed back by /auth/callback.
const q = new URLSearchParams(location.search);
if (q.has('result')) {
  const r = q.get('result');
  if (r === 'executed') showBanner('ok', 'Verified human approval accepted. The agent executed the trade on Uniswap.');
  else if (r === 'denied') showBanner('bad', `Approval denied, trade not executed: ${q.get('reason')}`);
  else showBanner('bad', `Trade ${r}${q.get('reason') ? `: ${q.get('reason')}` : ''}`);
  history.replaceState(null, '', '/');
}

initDelegation((kind, msg) => {
  showBanner(kind, msg);
  refresh();
});
refresh();
setInterval(refresh, 10000);
