const fallbackLabels = {
  temp_c:'温度 °C', temperature:'温度', power_on_hours:'通电小时', udma_crc_errors:'UDMA CRC 错误', ata_error_count:'ATA 错误', command_timeout:'Command Timeout',
  reallocated_sectors:'重映射扇区', pending_sectors:'待映射扇区', offline_uncorrectable:'离线不可校正', power_cycle_count:'通电次数'
};
const colors = ['#7aa2ff','#45d483','#ffd166','#ff5d73','#b084ff','#4dd7fa','#ff9f43','#ff78c4','#8bd450','#f7768e'];
let state = null, chart = null;

function metricLabel(key) { return state?.metrics?.find(m => m.key === key)?.label || fallbackLabels[key] || key; }
function fmt(v, suffix='') { return v === null || v === undefined || Number.isNaN(v) ? '—' : `${v}${suffix}`; }
function fmtTimeValue(v) { return v ? new Date(v).toLocaleString([], { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'; }
function time(s) { return s ? new Date(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toLocaleString() : '—'; }
function sevClass(r) { return r === 'FAIL' || r === 'BAD' ? 'FAIL' : r === 'WARN' ? 'WARN' : 'OK'; }
function groupKey() { return state?.groupField || 'disk'; }
function timeKey() { return state?.timeField || 'timestamp'; }
function tempKey() { return state?.metrics?.find(m => /^(temp|temperature|temp_c)$/i.test(m.key))?.key || 'temp_c'; }
function hourKey() { return state?.metrics?.find(m => /power_on_hours|hours/i.test(m.key))?.key || 'power_on_hours'; }

async function load() {
  const res = await fetch('/api/data', { cache:'no-store' });
  state = await res.json();
  render();
}

function ensureMetricOptions() {
  const select = document.getElementById('metric');
  const current = select.value;
  const metrics = state.metrics?.length ? state.metrics : Object.keys(fallbackLabels).map(key => ({ key, label: fallbackLabels[key] }));
  select.innerHTML = metrics.map(m => `<option value="${m.key}">${m.label || m.key}</option>`).join('');
  select.value = metrics.some(m => m.key === current) ? current : (metrics.find(m => m.key === tempKey())?.key || metrics[0]?.key || 'temp_c');
}

function renderCards() {
  const cards = document.getElementById('cards');
  const tKey = tempKey();
  const hKey = hourKey();
  cards.innerHTML = (state.groups || state.disks || []).map(d => {
    const l = d.latest || {};
    const name = d.group || d.disk || l[groupKey()] || 'unknown';
    const maxTemp = d.maxTemp ?? null;
    return `<article class="card">
      <div class="top"><div><div class="disk">${name}</div><div class="model" title="${d.model || ''}">${d.model || ''}</div></div><span class="badge ${sevClass(l.result)}">${l.result || '—'}</span></div>
      <div class="stats">
        <div class="stat"><b>${fmt(l[tKey], tKey === 'temp_c' ? '°' : '')}</b><span>${metricLabel(tKey)}</span></div>
        <div class="stat"><b>${fmt(maxTemp, maxTemp != null ? '°' : '')}</b><span>最高温度</span></div>
        <div class="stat"><b>${fmt(l[hKey])}</b><span>${metricLabel(hKey)}</span></div>
        <div class="stat"><b>${d.count}</b><span>采样次数</span></div>
      </div>
      <p class="small" style="margin-top:12px">最后：${time(d.lastSeen)} · ${l.notes || '-'}</p>
    </article>`;
  }).join('');
}

function renderChart() {
  const metric = document.getElementById('metric').value;
  document.getElementById('chartTitle').textContent = `${metricLabel(metric)} 趋势`;
  const byGroup = new Map();
  for (const r of state.records || []) {
    const g = r[groupKey()];
    if (!g) continue;
    if (!byGroup.has(g)) byGroup.set(g, []);
    if (r[metric] !== null && r[metric] !== undefined && r.ts) byGroup.get(g).push({ x: r.ts, y: r[metric] });
  }
  const datasets = [...byGroup.entries()].map(([name, data], i) => ({
    label: name,
    data: data.sort((a, b) => a.x - b.x),
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length],
    borderWidth: 3,
    tension: .42,
    cubicInterpolationMode: 'monotone',
    pointRadius: 2.5,
    pointHoverRadius: 6,
    spanGaps: true
  }));
  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('trend'), {
    type: 'line',
    data: { datasets },
    options: {
      responsive:true, maintainAspectRatio:false, parsing:false,
      scales:{
        x:{ type:'linear', title:{ display:true, text:'时间', color:'#93a4c3' }, ticks:{ color:'#93a4c3', maxTicksLimit: 8, callback(value){ return fmtTimeValue(value); } }, grid:{ color:'#263550' } },
        y:{ title:{ display:true, text:metricLabel(metric), color:'#93a4c3' }, ticks:{ color:'#93a4c3' }, grid:{ color:'#263550' } }
      },
      plugins:{ legend:{ labels:{ color:'#e8eefc', usePointStyle:true } }, tooltip:{ mode:'nearest', intersect:false, callbacks:{ title(items){ return items[0] ? new Date(items[0].parsed.x).toLocaleString() : ''; } } } }
    }
  });
}

function renderTable() {
  const tKey = tempKey();
  const hKey = hourKey();
  const rows = [...(state.groups || state.disks || [])].map(d => d.latest).sort((a,b)=>String(a[groupKey()]).localeCompare(String(b[groupKey()])));
  document.getElementById('latestTable').innerHTML = `<thead><tr><th>${groupKey()}</th><th>结果</th><th>${metricLabel(tKey)}</th><th>${metricLabel(hKey)}</th><th>备注</th><th>时间</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${r[groupKey()]}</td><td><span class="badge ${sevClass(r.result)}">${r.result || '—'}</span></td><td>${fmt(r[tKey], tKey === 'temp_c' ? '°' : '')}</td><td>${fmt(r[hKey])}</td><td>${r.notes || '-'}</td><td>${time(r[timeKey()])}</td></tr>`).join('') + '</tbody>';
}

function renderRisks() {
  const groups = state.groups || state.disks || [];
  const counterKeys = (state.metrics || []).map(m => m.key).filter(k => !/(temp|temperature|hour|time)$/i.test(k));
  const items = [];
  for (const d of groups) {
    const rising = counterKeys.filter(c => d.deltas?.[c] > 0).map(c => `${metricLabel(c)}: +${d.deltas[c]}`);
    if ((d.latest?.result || '') !== 'OK' || rising.length || (d.maxTemp ?? 0) >= 50) {
      items.push(`<div class="risk"><strong>${d.group || d.disk} · <span class="${sevClass(d.latest?.result)}">${d.latest?.result || '—'}</span></strong><div>${rising.length ? rising.join('<br>') : '计数器暂无增长'}</div><div class="small">${d.latest?.notes || '-'} · ${time(d.lastSeen)}</div></div>`);
    }
  }
  document.getElementById('risks').innerHTML = items.join('') || '<p class="small">暂未发现明显恶化趋势。</p>';
}

function render() {
  document.title = state.title || 'CSV 趋势看板';
  document.querySelector('h1').textContent = state.title || 'CSV 趋势看板';
  ensureMetricOptions();
  document.getElementById('subtitle').textContent = `${state.count} 条记录 · CSV 更新时间 ${time(state.updatedAt)} · 页面生成 ${time(state.generatedAt)}`;
  document.getElementById('status').textContent = '已更新';
  document.getElementById('runCheck').hidden = !state.checkEnabled;
  renderCards(); renderChart(); renderTable(); renderRisks();
}

function updateCheckUi(job) {
  const panel = document.getElementById('checkPanel');
  const stateEl = document.getElementById('checkState');
  const logEl = document.getElementById('checkLog');
  const btn = document.getElementById('runCheck');
  if (!job || (!job.running && !job.startedAt)) return;
  panel.hidden = false;
  btn.disabled = !!job.running;
  btn.textContent = job.running ? '检测中…' : '一键检测';
  if (job.running) stateEl.textContent = `检测中，开始于 ${time(job.startedAt)}`;
  else if (job.exitCode === 0) stateEl.textContent = `检测完成，已刷新数据 · ${time(job.finishedAt)}`;
  else stateEl.textContent = `检测失败 exit=${job.exitCode ?? '未知'} · ${job.error || ''}`;
  if (job.log) {
    logEl.textContent = job.log;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

async function pollCheckUntilDone() {
  const res = await fetch('/api/check', { cache:'no-store' });
  const j = await res.json();
  updateCheckUi(j.job);
  if (j.job?.running) setTimeout(pollCheckUntilDone, 2000);
  else await load();
}

async function runCheck() {
  const btn = document.getElementById('runCheck');
  btn.disabled = true;
  btn.textContent = '检测中…';
  document.getElementById('checkPanel').hidden = false;
  document.getElementById('checkLog').textContent = '';
  document.getElementById('checkState').textContent = '正在启动检测命令…';
  try {
    const res = await fetch('/api/check', { method:'POST' });
    const j = await res.json();
    updateCheckUi(j.job);
    if (!res.ok && j.message) document.getElementById('checkState').textContent = j.message;
    pollCheckUntilDone();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '一键检测';
    document.getElementById('checkState').textContent = `启动失败：${e.message}`;
  }
}

document.getElementById('metric').addEventListener('change', renderChart);
document.getElementById('refresh').addEventListener('click', load);
document.getElementById('runCheck').addEventListener('click', runCheck);

load().catch(e => document.getElementById('status').textContent = `加载失败：${e.message}`);
fetch('/api/check', { cache:'no-store' }).then(r => r.json()).then(j => { updateCheckUi(j.job); if (j.job?.running) pollCheckUntilDone(); }).catch(()=>{});
setInterval(load, 15000);
try {
  const es = new EventSource('/api/events');
  es.onopen = () => document.getElementById('status').textContent = '实时连接已建立';
  es.addEventListener('update', () => load());
  es.addEventListener('check', ev => updateCheckUi(JSON.parse(ev.data)));
  es.onerror = () => document.getElementById('status').textContent = '实时连接中断，轮询兜底';
} catch {}
