const dictionaries = {
  zh: {
    appTitle: 'SMART 硬盘健康监控', metric: '指标', language: '语言', runCheck: '一键检测', running: '检测中…', refresh: '立即刷新',
    connecting: '连接中…', connected: '实时连接已建立', updated: '已更新', loadFailed: '加载失败', startCheck: '正在启动检测命令…',
    checkTitle: '硬盘检测', ready: '准备中…', checkRunning: '检测中，开始于', checkDone: '检测完成，已刷新数据', checkFailed: '检测失败',
    autoRefreshHint: '新 CSV 写入后会通过 SSE 自动刷新；失败时 15 秒轮询兜底。', sseFallback: '实时连接中断，轮询兜底',
    trend: '趋势', time: '时间', latestRecords: '最近记录', riskChanges: '风险变化', noRisk: '暂未发现明显恶化趋势。',
    recordCount: '条记录', csvUpdated: 'CSV 更新时间', pageGenerated: '页面生成', sampleCount: '采样次数', latest: '最后',
    currentTemp: '当前温度', maxTemp: '最高温度', result: '结果', notes: '备注', noCounterIncrease: '计数器暂无增长',
    themeDark: '暗黑', themeLight: '白天', disk: '硬盘', status: '状态', capacity: '容量', serial: '序列号', model: '型号',
    temp_c: '温度 °C', temperature: '温度', power_on_hours: '通电小时', reallocated_sectors: '重映射扇区', pending_sectors: '待映射扇区',
    offline_uncorrectable: '离线不可校正', udma_crc_errors: 'UDMA CRC 错误', ata_error_count: 'ATA 错误', command_timeout: '命令超时',
    reported_uncorrect: '已报告不可校正', spin_retry_count: '主轴重试次数', power_cycle_count: '通电次数', smart_exit_code: 'smartctl 返回码', collapseCheck: '收起', expandCheck: '展开', rawOutput: '原始输出', noCheckOutput: '暂无检测输出', checkSummary: '检测摘要', duration: '耗时'
  },
  en: {
    appTitle: 'SMART Disk Health Monitor', metric: 'Metric', language: 'Language', runCheck: 'Run check', running: 'Checking…', refresh: 'Refresh',
    connecting: 'Connecting…', connected: 'Live connection ready', updated: 'Updated', loadFailed: 'Load failed', startCheck: 'Starting check command…',
    checkTitle: 'Disk check', ready: 'Ready', checkRunning: 'Running since', checkDone: 'Check completed, data refreshed', checkFailed: 'Check failed',
    autoRefreshHint: 'New CSV writes refresh automatically by SSE; polling is used as fallback.', sseFallback: 'Live connection lost; polling fallback active',
    trend: 'trend', time: 'Time', latestRecords: 'Latest records', riskChanges: 'Risk changes', noRisk: 'No obvious worsening trend found.',
    recordCount: 'records', csvUpdated: 'CSV updated', pageGenerated: 'page generated', sampleCount: 'samples', latest: 'Latest',
    currentTemp: 'Current temp', maxTemp: 'Max temp', result: 'Result', notes: 'Notes', noCounterIncrease: 'No counter increase',
    themeDark: 'Dark', themeLight: 'Light', disk: 'Disk', status: 'Status', capacity: 'Capacity', serial: 'Serial', model: 'Model',
    temp_c: 'Temperature °C', temperature: 'Temperature', power_on_hours: 'Power-on hours', reallocated_sectors: 'Reallocated sectors', pending_sectors: 'Pending sectors',
    offline_uncorrectable: 'Offline uncorrectable', udma_crc_errors: 'UDMA CRC errors', ata_error_count: 'ATA errors', command_timeout: 'Command timeout',
    reported_uncorrect: 'Reported uncorrectable', spin_retry_count: 'Spin retry count', power_cycle_count: 'Power cycles', smart_exit_code: 'smartctl exit code', collapseCheck: 'Collapse', expandCheck: 'Expand', rawOutput: 'Raw output', noCheckOutput: 'No check output yet', checkSummary: 'Check summary', duration: 'Duration'
  }
};
const colors = ['#7aa2ff','#45d483','#ffd166','#ff5d73','#b084ff','#4dd7fa','#ff9f43','#ff78c4','#8bd450','#f7768e'];
let state = null, chart = null;
let lang = localStorage.getItem('lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
let theme = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

function t(key) { return dictionaries[lang]?.[key] || dictionaries.en[key] || key; }
function metricLabel(key) { return t(key) || state?.metrics?.find(m => m.key === key)?.label || key; }
function fmt(v, suffix='') { return v === null || v === undefined || Number.isNaN(v) ? '—' : `${v}${suffix}`; }
function fmtTimeValue(v) { return v ? new Date(v).toLocaleString([], { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'; }
function time(s) { return s ? new Date(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toLocaleString() : '—'; }
function sevClass(r) { return r === 'FAIL' || r === 'BAD' ? 'FAIL' : r === 'WARN' ? 'WARN' : 'OK'; }
function groupKey() { return state?.groupField || 'disk'; }
function timeKey() { return state?.timeField || 'timestamp'; }
function tempKey() { return state?.metrics?.find(m => /^(temp|temperature|temp_c)$/i.test(m.key))?.key || 'temp_c'; }
function hourKey() { return state?.metrics?.find(m => /power_on_hours|hours/i.test(m.key))?.key || 'power_on_hours'; }
function tempSuffix(key) { return /temp|temperature/i.test(key) ? '°' : ''; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }
function formatDuration(start, end) {
  const a = start ? Date.parse(start) : NaN;
  const b = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '—';
  const total = Math.round((b - a) / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min ? `${min}m ${sec}s` : `${sec}s`;
}
function setCheckCollapsed(collapsed) {
  const panel = document.getElementById('checkPanel');
  const body = document.getElementById('checkBody');
  const header = document.getElementById('checkHeader');
  const toggle = document.getElementById('checkToggle');
  if (!panel || !body || !header || !toggle) return;
  panel.classList.toggle('collapsed', collapsed);
  body.hidden = collapsed;
  header.setAttribute('aria-expanded', String(!collapsed));
  toggle.textContent = collapsed ? t('expandCheck') : t('collapseCheck');
  localStorage.setItem('checkCollapsed', collapsed ? '1' : '0');
}
function renderPrettyLog(job) {
  const wrap = document.getElementById('checkLogPretty');
  if (!wrap) return;
  const log = String(job?.log || '').trim();
  const status = job?.running ? 'running' : job?.exitCode === 0 ? 'ok' : job?.startedAt ? 'fail' : 'idle';
  const lines = log ? log.split(/\r?\n/).filter(Boolean) : [];
  const important = lines.filter(line => /\b(FAIL|BAD|WARN|ERROR|critical|uncorrect|pending|reallocated|timeout|CRC|完成|失败|错误|警告|Exception)\b/i.test(line)).slice(-10);
  const chips = [
    `<span class="check-chip ${status}">${job?.running ? t('running') : job?.exitCode === 0 ? t('checkDone') : job?.startedAt ? t('checkFailed') : t('ready')}</span>`,
    job?.startedAt ? `<span class="check-chip">${t('duration')}: ${formatDuration(job.startedAt, job.finishedAt)}</span>` : '',
    job?.exitCode != null ? `<span class="check-chip">exit ${job.exitCode}</span>` : ''
  ].filter(Boolean).join('');
  const body = log ? `
    ${important.length ? `<div class="check-section-title">${t('checkSummary')}</div><ul class="check-summary">${important.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : `<div class="check-success">✅ ${t('noRisk')}</div>`}
    ` : `<p class="empty">${t('noCheckOutput')}</p>`;
  wrap.innerHTML = `<div class="check-chips">${chips}</div>${body}`;
}

function applyChrome() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.theme = theme;
  document.getElementById('language').value = lang;
  document.getElementById('themeToggle').textContent = theme === 'dark' ? t('themeDark') : t('themeLight');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  const panel = document.getElementById('checkPanel');
  if (panel) setCheckCollapsed(panel.classList.contains('collapsed'));
  if (!state) document.getElementById('status').textContent = t('connecting');
}

async function load() {
  const res = await fetch('/api/data', { cache:'no-store' });
  state = await res.json();
  render();
}

function ensureMetricOptions() {
  const select = document.getElementById('metric');
  const current = select.value;
  const metrics = state.metrics?.length ? state.metrics : ['temp_c','power_on_hours','reallocated_sectors','pending_sectors','offline_uncorrectable','udma_crc_errors','ata_error_count','command_timeout','power_cycle_count'].map(key => ({ key }));
  select.innerHTML = metrics.map(m => `<option value="${m.key}">${metricLabel(m.key)}</option>`).join('');
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
        <div class="stat"><b>${fmt(l[tKey], tempSuffix(tKey))}</b><span>${metricLabel(tKey)}</span></div>
        <div class="stat"><b>${fmt(maxTemp, maxTemp != null ? '°' : '')}</b><span>${t('maxTemp')}</span></div>
        <div class="stat"><b>${fmt(l[hKey])}</b><span>${metricLabel(hKey)}</span></div>
        <div class="stat"><b>${d.count}</b><span>${t('sampleCount')}</span></div>
      </div>
      <p class="small" style="margin-top:12px">${t('latest')}: ${time(d.lastSeen)} · ${l.notes || '-'}</p>
    </article>`;
  }).join('');
}

function chartColors() {
  const css = getComputedStyle(document.documentElement);
  return { text: css.getPropertyValue('--text').trim(), muted: css.getPropertyValue('--muted').trim(), line: css.getPropertyValue('--line').trim() };
}

function renderChart() {
  const metric = document.getElementById('metric').value;
  document.getElementById('chartTitle').textContent = `${metricLabel(metric)} ${t('trend')}`;
  const byGroup = new Map();
  for (const r of state.records || []) {
    const g = r[groupKey()];
    if (!g) continue;
    if (!byGroup.has(g)) byGroup.set(g, []);
    if (r[metric] !== null && r[metric] !== undefined && r.ts) byGroup.get(g).push({ x: r.ts, y: r[metric] });
  }
  const datasets = [...byGroup.entries()].map(([name, data], i) => ({
    label: name, data: data.sort((a, b) => a.x - b.x), borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length],
    borderWidth: 3, tension: .42, cubicInterpolationMode: 'monotone', pointRadius: 2.5, pointHoverRadius: 6, spanGaps: true
  }));
  if (chart) chart.destroy();
  const c = chartColors();
  chart = new Chart(document.getElementById('trend'), {
    type: 'line', data: { datasets },
    options: {
      responsive:true, maintainAspectRatio:false, parsing:false,
      scales:{
        x:{ type:'linear', title:{ display:true, text:t('time'), color:c.muted }, ticks:{ color:c.muted, maxTicksLimit: 8, callback(value){ return fmtTimeValue(value); } }, grid:{ color:c.line } },
        y:{ title:{ display:true, text:metricLabel(metric), color:c.muted }, ticks:{ color:c.muted }, grid:{ color:c.line } }
      },
      plugins:{ legend:{ labels:{ color:c.text, usePointStyle:true } }, tooltip:{ mode:'nearest', intersect:false, callbacks:{ title(items){ return items[0] ? new Date(items[0].parsed.x).toLocaleString() : ''; } } } }
    }
  });
}

function renderTable() {
  const tKey = tempKey();
  const hKey = hourKey();
  const rows = [...(state.groups || state.disks || [])].map(d => d.latest).sort((a,b)=>String(a[groupKey()]).localeCompare(String(b[groupKey()])));
  document.getElementById('latestTable').innerHTML = `<thead><tr><th>${t('disk')}</th><th>${t('result')}</th><th>${metricLabel(tKey)}</th><th>${metricLabel(hKey)}</th><th>${t('notes')}</th><th>${t('time')}</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${r[groupKey()]}</td><td><span class="badge ${sevClass(r.result)}">${r.result || '—'}</span></td><td>${fmt(r[tKey], tempSuffix(tKey))}</td><td>${fmt(r[hKey])}</td><td>${r.notes || '-'}</td><td>${time(r[timeKey()])}</td></tr>`).join('') + '</tbody>';
}

function renderRisks() {
  const groups = state.groups || state.disks || [];
  const counterKeys = (state.metrics || []).map(m => m.key).filter(k => !/(temp|temperature|hour|time)$/i.test(k));
  const items = [];
  for (const d of groups) {
    const rising = counterKeys.filter(c => d.deltas?.[c] > 0).map(c => `${metricLabel(c)}: +${d.deltas[c]}`);
    if ((d.latest?.result || '') !== 'OK' || rising.length || (d.maxTemp ?? 0) >= 50) {
      items.push(`<div class="risk"><strong>${d.group || d.disk} · <span class="${sevClass(d.latest?.result)}">${d.latest?.result || '—'}</span></strong><div>${rising.length ? rising.join('<br>') : t('noCounterIncrease')}</div><div class="small">${d.latest?.notes || '-'} · ${time(d.lastSeen)}</div></div>`);
    }
  }
  document.getElementById('risks').innerHTML = items.join('') || `<p class="empty">${t('noRisk')}</p>`;
}

function render() {
  applyChrome();
  document.title = t('appTitle');
  document.getElementById('pageTitle').textContent = t('appTitle');
  ensureMetricOptions();
  document.getElementById('subtitle').textContent = `${state.count} ${t('recordCount')} · ${t('csvUpdated')} ${time(state.updatedAt)} · ${t('pageGenerated')} ${time(state.generatedAt)}`;
  document.getElementById('status').textContent = t('updated');
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
  btn.textContent = job.running ? t('running') : t('runCheck');
  if (job.running) stateEl.textContent = `${t('checkRunning')} ${time(job.startedAt)} · ${t('duration')} ${formatDuration(job.startedAt)}`;
  else if (job.exitCode === 0) stateEl.textContent = `${t('checkDone')} · ${time(job.finishedAt)} · ${t('duration')} ${formatDuration(job.startedAt, job.finishedAt)}`;
  else stateEl.textContent = `${t('checkFailed')} exit=${job.exitCode ?? 'unknown'} · ${job.error || ''}`;
  renderPrettyLog(job);
  if (job.log) { logEl.textContent = job.log; logEl.scrollTop = logEl.scrollHeight; }
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
  btn.textContent = t('running');
  document.getElementById('checkPanel').hidden = false;
  document.getElementById('checkLog').textContent = '';
  renderPrettyLog({ running: true, startedAt: new Date().toISOString(), log: '' });
  document.getElementById('checkState').textContent = t('startCheck');
  try {
    const res = await fetch('/api/check', { method:'POST' });
    const j = await res.json();
    updateCheckUi(j.job);
    if (!res.ok && j.message) document.getElementById('checkState').textContent = j.message;
    pollCheckUntilDone();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = t('runCheck');
    document.getElementById('checkState').textContent = `${t('checkFailed')}: ${e.message}`;
  }
}

document.getElementById('metric').addEventListener('change', renderChart);
document.getElementById('refresh').addEventListener('click', load);
document.getElementById('runCheck').addEventListener('click', runCheck);
document.getElementById('checkHeader').addEventListener('click', () => {
  setCheckCollapsed(!document.getElementById('checkPanel').classList.contains('collapsed'));
});
setCheckCollapsed(localStorage.getItem('checkCollapsed') === '1');
document.getElementById('language').addEventListener('change', e => { lang = e.target.value; localStorage.setItem('lang', lang); render(); });
document.getElementById('themeToggle').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('theme', theme); render(); });

applyChrome();
load().catch(e => document.getElementById('status').textContent = `${t('loadFailed')}: ${e.message}`);
fetch('/api/check', { cache:'no-store' }).then(r => r.json()).then(j => { updateCheckUi(j.job); if (j.job?.running) pollCheckUntilDone(); }).catch(()=>{});
setInterval(load, 15000);
try {
  const es = new EventSource('/api/events');
  es.onopen = () => document.getElementById('status').textContent = t('connected');
  es.addEventListener('update', () => load());
  es.addEventListener('check', ev => updateCheckUi(JSON.parse(ev.data)));
  es.onerror = () => document.getElementById('status').textContent = t('sseFallback');
} catch {}
