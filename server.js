#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const APP_ROOT = __dirname;
const PUBLIC = path.join(APP_ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || process.env.DISK_HEALTH_DIR || APP_ROOT;
const CSV_FILE = process.env.CSV_FILE || process.env.DISK_HEALTH_CSV || path.join(DATA_DIR, 'disk-health-history.csv');
const CHECK_COMMAND = process.env.CHECK_COMMAND || process.env.DISK_HEALTH_CHECK_COMMAND || process.env.DISK_HEALTH_CHECK_SCRIPT || `node ${path.join(APP_ROOT, 'collector.js')}`;
const GROUP_FIELD = process.env.GROUP_FIELD || 'disk';
const TIME_FIELD = process.env.TIME_FIELD || 'timestamp';
const TITLE = process.env.DASHBOARD_TITLE || '硬盘健康趋势';
const PORT = Number(process.env.PORT || process.env.DISK_HEALTH_PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const WATCH_INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS || 2000);
const CHECK_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 10 * 60 * 1000);
const ALLOW_CHECK = !/^(0|false|no)$/i.test(String(process.env.ALLOW_CHECK ?? 'true'));

let cache = { mtimeMs: 0, size: -1, payload: null };
let checkJob = null;
const clients = new Set();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

function parseTime(v) {
  if (!v) return null;
  const s = String(v).trim();
  const fixed = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const n = Date.parse(fixed);
  if (Number.isFinite(n)) return n;
  if (/^\d{8}-\d{6}$/.test(s)) {
    const d = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}`;
    const m = Date.parse(d);
    return Number.isFinite(m) ? m : null;
  }
  return null;
}

function num(v) {
  if (v == null || v === '' || v === '-' || /^unknown$/i.test(v)) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function severity(result) {
  if (result === 'FAIL' || result === 'BAD') return 3;
  if (result === 'WARN') return 2;
  if (result === 'OK') return 1;
  return 0;
}

function inferMetrics(headers, records) {
  const deny = new Set([TIME_FIELD, GROUP_FIELD, 'run_id', 'host', 'model', 'serial', 'capacity', 'health', 'result', 'notes', 'raw_file', 'selftest_latest', 'device_type', 'transport']);
  const metrics = [];
  for (const h of headers) {
    if (deny.has(h)) continue;
    const numericCount = records.reduce((n, r) => n + (r[h] != null ? 1 : 0), 0);
    if (numericCount > 0) metrics.push({ key: h, label: h });
  }
  return metrics;
}

function summarize(records, metrics) {
  const groups = new Map();
  for (const r of records) {
    const key = r[GROUP_FIELD] || r.serial || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const counters = metrics.map(m => m.key).filter(k => !/(temp|temperature|hour|time)$/i.test(k));
  const out = [];
  for (const [group, list] of groups) {
    list.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const latest = list[list.length - 1] || {};
    const first = list[0] || {};
    const deltas = {};
    for (const c of counters) {
      const a = first[c], b = latest[c];
      deltas[c] = a != null && b != null ? b - a : null;
    }
    const tempKey = metrics.find(m => /^(temp|temperature|temp_c)$/i.test(m.key))?.key;
    const maxTemp = tempKey ? Math.max(...list.map(r => r[tempKey]).filter(v => v != null)) : null;
    out.push({
      group,
      disk: latest.disk || group,
      label: `${latest[GROUP_FIELD] || group} · ${latest.model || ''}`.trim(),
      model: latest.model,
      serial: latest.serial,
      transport: latest.transport,
      capacity: latest.capacity,
      count: list.length,
      firstSeen: first[TIME_FIELD],
      lastSeen: latest[TIME_FIELD],
      latest,
      maxTemp: Number.isFinite(maxTemp) ? maxTemp : null,
      worstResult: list.reduce((w, r) => severity(r.result) > severity(w) ? r.result : w, 'OK'),
      deltas
    });
  }
  return out.sort((a, b) => String(a.group).localeCompare(String(b.group)));
}

async function loadData(force = false) {
  const st = await fsp.stat(CSV_FILE);
  if (!force && cache.payload && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.payload;
  const text = await fsp.readFile(CSV_FILE, 'utf8');
  const rows = parseCsv(text);
  const headers = rows.shift() || [];
  const rawRecords = rows.map(cols => Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ''])));
  const numericHeaders = headers.filter(h => h !== TIME_FIELD && h !== GROUP_FIELD);
  const records = rawRecords.map(r => {
    const out = { ...r, ts: parseTime(r[TIME_FIELD]) };
    for (const h of numericHeaders) {
      const n = num(r[h]);
      if (n !== null) out[h] = n;
    }
    return out;
  }).filter(r => r[TIME_FIELD] && r[GROUP_FIELD]);
  const metrics = inferMetrics(headers, records);
  const payload = {
    title: TITLE,
    source: CSV_FILE,
    groupField: GROUP_FIELD,
    timeField: TIME_FIELD,
    checkEnabled: ALLOW_CHECK,
    checkCommand: CHECK_COMMAND,
    updatedAt: new Date(st.mtimeMs).toISOString(),
    generatedAt: new Date().toISOString(),
    count: records.length,
    metrics,
    groups: summarize(records, metrics),
    disks: summarize(records, metrics),
    records
  };
  cache = { mtimeMs: st.mtimeMs, size: st.size, payload };
  return payload;
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendSse(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

function sendUpdate(data) {
  sendSse('update', { updatedAt: data.updatedAt, count: data.count });
}

function runCheck() {
  if (!ALLOW_CHECK) throw new Error('Check command is disabled');
  if (checkJob?.running) return checkJob;
  const startedAt = new Date().toISOString();
  checkJob = { running: true, startedAt, finishedAt: null, exitCode: null, error: null, log: '' };
  sendSse('check', { ...checkJob, log: undefined });

  const child = spawn(CHECK_COMMAND, [], {
    cwd: DATA_DIR,
    env: { ...process.env, DATA_DIR, DISK_HEALTH_DIR: DATA_DIR, CSV_FILE, DISK_HEALTH_CSV: CSV_FILE },
    shell: true
  });
  const timer = setTimeout(() => child.kill('SIGTERM'), CHECK_TIMEOUT_MS);

  const appendLog = chunk => {
    checkJob.log += chunk.toString();
    if (checkJob.log.length > 20000) checkJob.log = checkJob.log.slice(-20000);
  };
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  child.on('error', err => {
    clearTimeout(timer);
    checkJob.running = false;
    checkJob.finishedAt = new Date().toISOString();
    checkJob.error = err.message;
    sendSse('check', { ...checkJob, log: undefined });
  });
  child.on('close', async code => {
    clearTimeout(timer);
    checkJob.running = false;
    checkJob.finishedAt = new Date().toISOString();
    checkJob.exitCode = code;
    sendSse('check', { ...checkJob, log: undefined });
    try { sendUpdate(await loadData(true)); } catch (e) { console.error(e); }
  });
  return checkJob;
}

fs.watchFile(CSV_FILE, { interval: WATCH_INTERVAL_MS }, async () => {
  try { sendUpdate(await loadData(true)); } catch (e) { console.error(e); }
});

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = url.parse(req.url, true);
    if (pathname === '/api/health') return sendJson(res, { ok: true, title: TITLE, csv: CSV_FILE, dataDir: DATA_DIR, groupField: GROUP_FIELD, timeField: TIME_FIELD, checkEnabled: ALLOW_CHECK, checkCommand: CHECK_COMMAND, clients: clients.size });
    if (pathname === '/api/data') return sendJson(res, await loadData());
    if (pathname === '/api/check' && req.method === 'GET') return sendJson(res, { ok: true, enabled: ALLOW_CHECK, job: checkJob || { running: false } });
    if (pathname === '/api/check' && req.method === 'POST') {
      if (!ALLOW_CHECK) return sendJson(res, { ok: false, message: '检测命令已禁用。' }, 403);
      if (checkJob?.running) return sendJson(res, { ok: false, running: true, message: '检测正在运行中，请稍候。', job: checkJob }, 409);
      return sendJson(res, { ok: true, job: runCheck() });
    }
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const safePath = pathname === '/' ? '/index.html' : pathname;
    const file = path.normalize(path.join(PUBLIC, safePath));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
    const ext = path.extname(file).toLowerCase();
    const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'application/javascript; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).on('error', () => { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }).pipe(res);
  } catch (e) {
    console.error(e);
    sendJson(res, { ok: false, error: e.message }, 500);
  }
});

server.listen(PORT, HOST, () => console.log(`${TITLE}: http://${HOST}:${PORT}`));
