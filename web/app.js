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

async function loadStatus() {
  const s = await api('/api/status');
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

async function loadProposals() {
  const list = await api('/api/proposals');
  $('proposals').innerHTML = list.length ? list.map(renderProposal).join('') : '<p class="empty">No proposals yet.</p>';
}

async function loadActivity() {
  const items = await api('/api/activity');
  $('activity').innerHTML = items
    .map((a) => `<li><time>${fmtTime(a.at)}</time><span class="k k-${a.kind}">${a.kind}</span><span>${esc(a.message)}</span></li>`)
    .join('');
}

async function refresh() {
  await Promise.allSettled([loadStatus(), loadProposals(), loadActivity()]);
}
