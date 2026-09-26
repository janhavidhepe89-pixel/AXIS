/* global Chart */
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

let alloc;
let value;

function baseOptions(yTitle, yFmt) {
  const grid = css('--line');
  const muted = css('--muted');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { display: true, position: 'bottom', labels: { color: muted, boxWidth: 10, font: { size: 11 } } },
      tooltip: { callbacks: { title: (items) => time(items[0].parsed.x) } },
    },
    scales: {
      x: {
        type: 'linear',
        ticks: { color: muted, maxTicksLimit: 6, callback: (v) => time(v) },
        grid: { color: grid },
      },
      y: {
        title: { display: false, text: yTitle },
        ticks: { color: muted, callback: yFmt },
        grid: { color: grid },
      },
    },
  };
}

function createCharts() {
  const eth = css('--eth');
  const accent = css('--accent');
  const ok = css('--ok');

  alloc = new Chart(document.getElementById('chart-alloc'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Band high', data: [], borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: `${ok}22` },
        { label: 'Band low', data: [], borderWidth: 0, pointRadius: 0, fill: false },
        { label: 'ETH %', data: [], borderColor: eth, backgroundColor: eth, borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: 'Rebalance', type: 'scatter', data: [], pointRadius: 5, pointStyle: 'rectRot', backgroundColor: accent, borderColor: accent },
      ],
    },
    options: {
      ...baseOptions('ETH %', (v) => `${v}%`),
      plugins: {
        ...baseOptions().plugins,
        legend: {
          ...baseOptions().plugins.legend,
          labels: { ...baseOptions().plugins.legend.labels, filter: (item) => !item.text.startsWith('Band') },
        },
      },
    },
  });
  alloc.options.scales.y.min = 0;
  alloc.options.scales.y.max = 100;

  value = new Chart(document.getElementById('chart-value'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Treasury value', data: [], borderColor: accent, backgroundColor: `${accent}22`, fill: true, borderWidth: 2, pointRadius: 0, tension: 0.2 },
      ],
    },
    options: baseOptions('ETH', (v) => Number(v).toFixed(5)),
  });
}

/** history: [{at, ethPct, totalValueEth}], proposals: executed trades, policy: {targetEthPct, driftThresholdPct} */
export function updateCharts(history, proposals, policy) {
  if (typeof Chart === 'undefined') return;
  if (!alloc) createCharts();
  if (!history.length) return;

  const first = history[0].at;
  const last = history[history.length - 1].at;
  const hi = policy.targetEthPct + policy.driftThresholdPct;
  const lo = policy.targetEthPct - policy.driftThresholdPct;

  alloc.data.datasets[0].data = [{ x: first, y: hi }, { x: last, y: hi }];
  alloc.data.datasets[1].data = [{ x: first, y: lo }, { x: last, y: lo }];
  alloc.data.datasets[2].data = history.map((h) => ({ x: h.at, y: h.ethPct }));
  alloc.data.datasets[3].data = proposals
    .filter((p) => p.status === 'executed' && p.executedAt && p.ethPctAfter != null)
    .map((p) => ({ x: p.executedAt, y: p.ethPctAfter }));
  alloc.update();

  value.data.datasets[0].data = history.map((h) => ({ x: h.at, y: h.totalValueEth }));
  value.update();
}
