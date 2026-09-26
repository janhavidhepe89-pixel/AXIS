/** Delegation card: connect an injected wallet, sign the EIP-712 mandate, revoke it. */
const $ = (id) => document.getElementById(id);
const SEPOLIA = '0xaa36a7';
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const toWei = (eth) => BigInt(Math.round(Number(eth) * 1e6)) * 10n ** 12n;
const fromWei = (wei) => `${(Number(wei) / 1e18).toFixed(4)} ETH`;

let account = null;
let provider = null;
let onChange = () => {};

// EIP-6963: discover injected wallets and prefer the Uniswap Wallet extension.
const UNISWAP_RDNS = 'org.uniswap.app';
const discovered = new Map();
window.addEventListener('eip6963:announceProvider', (e) => discovered.set(e.detail.info.rdns, e.detail));
window.dispatchEvent(new Event('eip6963:requestProvider'));

function pickProvider() {
  const uniswap = discovered.get(UNISWAP_RDNS);
  if (uniswap) return { provider: uniswap.provider, name: uniswap.info.name };
  if (window.ethereum?.isUniswapWallet) return { provider: window.ethereum, name: 'Uniswap Wallet' };
  throw new Error('Uniswap Wallet not found. Install the Uniswap Wallet extension (wallet.uniswap.org) and reload.');
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

async function connect() {
  const picked = pickProvider();
  provider = picked.provider;
  [account] = await provider.request({ method: 'eth_requestAccounts' });
  const chainId = await provider.request({ method: 'eth_chainId' });
  if (chainId !== SEPOLIA) {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA }] });
  }
  $('d-account').textContent = `Connected ${picked.name} ${short(account)}`;
  $('d-connect').hidden = true;
  $('d-sign').hidden = false;
}

async function signAndDelegate() {
  const { template } = await api('/api/delegation');
  const mandate = {
    owner: account,
    agent: template.agent,
    maxTradeWei: toWei($('d-max').value).toString(),
    dailyLimitWei: toWei($('d-daily').value).toString(),
    expiry: String(Math.floor(Date.now() / 1000) + Number($('d-hours').value) * 3600),
    nonce: template.nonce,
  };
  const typedData = {
    domain: template.domain,
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      ...template.types,
    },
    primaryType: 'Mandate',
    message: mandate,
  };
  const signature = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [account, JSON.stringify(typedData)],
  });
  await api('/api/delegate', { mandate, signature });
}

async function revoke(message, owner) {
  if (!account) await connect();
  if (account.toLowerCase() !== owner.toLowerCase()) throw new Error(`Switch your wallet to the owner ${short(owner)} to revoke.`);
  const hex = `0x${[...new TextEncoder().encode(message)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const signature = await provider.request({ method: 'personal_sign', params: [hex, account] });
  await api('/api/delegation/revoke', { signature });
}

export async function loadDelegation() {
  const { active, revokeMessage } = await api('/api/delegation');
  $('d-none').hidden = !!active;
  $('d-active').hidden = !active;
  $('d-state').textContent = active ? 'active' : 'not delegated';
  $('d-state').className = `status ${active ? 's-executed' : 's-blocked'}`;
  if (!active) return;
  $('d-owner').textContent = short(active.owner);
  $('d-agent').textContent = short(active.agent);
  $('d-amax').textContent = fromWei(active.maxTradeWei);
  $('d-adaily').textContent = fromWei(active.dailyLimitWei);
  $('d-exp').textContent = new Date(Number(active.expiry) * 1000).toLocaleString();
  $('d-revoke').onclick = () => run(() => revoke(revokeMessage, active.owner), 'Delegation revoked: the agent is paused.');
}

async function run(fn, success) {
  try {
    await fn();
    if (success) onChange('ok', success);
  } catch (err) {
    onChange('bad', err.message || String(err));
  }
  loadDelegation().catch(() => {});
}

export function initDelegation(notify) {
  onChange = notify;
  $('d-connect').onclick = () => run(connect);
  $('d-sign').onclick = () => run(signAndDelegate, 'Delegation signed and verified: the agent is now active within your limits.');
}
