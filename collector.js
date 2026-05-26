#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const CONFIG_FILE = process.env.CONFIG_FILE || '/config/config.json';
const DATA_DIR = process.env.DATA_DIR || '/data';
const DEFAULT_CONFIG = {
  smartctl: process.env.SMARTCTL || '/usr/sbin/smartctl',
  output: {
    dataDir: DATA_DIR,
    csv: process.env.CSV_FILE || path.join(DATA_DIR, 'disk-health-history.csv'),
    rawDir: path.join(DATA_DIR, 'raw')
  },
  scan: {
    enabled: true,
    commandArgs: ['--scan-open'],
    include: [],
    exclude: []
  },
  defaults: {
    // Use permissive mode because USB/SATA bridges often return partial SMART data.
    args: ['-T', 'permissive', '-a']
  },
  devices: []
};

const HEADER = [
  'timestamp','run_id','host','disk','transport','device_type','model','serial','capacity','health','result','temp_c','power_on_hours',
  'reallocated_sectors','pending_sectors','offline_uncorrectable','udma_crc_errors','ata_error_count','command_timeout','reported_uncorrect',
  'spin_retry_count','power_cycle_count','selftest_latest','smart_exit_code','notes','raw_file'
];

function mergeConfig(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  const out = { ...base, ...extra };
  out.output = { ...base.output, ...(extra.output || {}) };
  out.scan = { ...base.scan, ...(extra.scan || {}) };
  out.defaults = { ...base.defaults, ...(extra.defaults || {}) };
  out.devices = Array.isArray(extra.devices) ? extra.devices : base.devices;
  return out;
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return mergeConfig(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
  } catch (e) {
    console.error(`Failed to read config ${CONFIG_FILE}: ${e.message}`);
    process.exitCode = 2;
  }
  return DEFAULT_CONFIG;
}

function sh(args, opts = {}) {
  return spawnSync(args[0], args.slice(1), { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, ...opts });
}

function csvEscape(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }
function safeName(v) { return String(v).replace(/^\/dev\//, '').replace(/[^A-Za-z0-9_.-]/g, '_'); }
function nowRunId(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function isoLocal(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = pad(Math.floor(Math.abs(off) / 60));
  const mm = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}${mm}`;
}

function firstMatch(text, re, group = 1) { const m = text.match(re); return m ? (m[group] || '').trim() : ''; }
function attrRaw(text, id, name) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] === String(id) && (!name || cols[1] === name)) return cols[9] || '';
  }
  return '';
}
function latestSelftest(text) {
  const line = text.split(/\r?\n/).find(l => /^#\s*1\s+/.test(l));
  if (!line) return 'Unknown';
  return line.replace(/^#\s*1\s+/, '').trim();
}
function numish(v) { return v && v !== 'Unknown' && /^-?\d+$/.test(String(v)) ? Number(v) : null; }

function classify(health, vals) {
  let bad = false, warn = false;
  if (health && health !== 'PASSED' && health !== 'OK') bad = true;
  for (const k of ['reallocated_sectors','pending_sectors','offline_uncorrectable']) if ((numish(vals[k]) || 0) > 0) bad = true;
  if ((numish(vals.temp_c) || 0) >= 50) warn = true;
  for (const k of ['udma_crc_errors','ata_error_count','command_timeout']) if ((numish(vals[k]) || 0) > 0) warn = true;
  return bad ? 'BAD' : warn ? 'WARN' : 'OK';
}
function notesFor(health, vals) {
  const notes = [];
  if (health && health !== 'PASSED' && health !== 'OK') notes.push(`health=${health}`);
  if ((numish(vals.temp_c) || 0) >= 50) notes.push('temp>=50C');
  if ((numish(vals.udma_crc_errors) || 0) > 0) notes.push(`crc_errors=${vals.udma_crc_errors}`);
  if ((numish(vals.ata_error_count) || 0) > 0) notes.push(`ata_errors=${vals.ata_error_count}`);
  if ((numish(vals.command_timeout) || 0) > 0) notes.push(`command_timeout=${vals.command_timeout}`);
  return notes.length ? `${notes.join('; ')};` : '-';
}

function smartScan(config) {
  const devices = [];
  if (Array.isArray(config.devices) && config.devices.length) {
    return config.devices.map(d => typeof d === 'string' ? { path: d } : d).filter(d => d.path);
  }
  if (config.scan?.enabled !== false) {
    const r = sh([config.smartctl, ...(config.scan?.commandArgs || ['--scan-open'])]);
    const scanText = `${r.stdout || ''}\n${r.stderr || ''}`;
    for (const line of scanText.split(/\r?\n/)) {
      const clean = line.split('#')[0].trim();
      if (!clean.startsWith('/dev/')) continue;
      const parts = clean.split(/\s+/);
      devices.push({ path: parts[0], args: parts.slice(1) });
    }
  }
  if (!devices.length) {
    try {
      for (const name of fs.readdirSync('/dev')) {
        if (/^(sd[a-z]|hd[a-z]|vd[a-z]|xvd[a-z]|nvme\d+n\d+)$/.test(name)) devices.push({ path: `/dev/${name}` });
      }
    } catch {}
  }
  const include = (config.scan?.include || []).map(s => new RegExp(s));
  const exclude = (config.scan?.exclude || []).map(s => new RegExp(s));
  return devices.filter(d => (!include.length || include.some(re => re.test(d.path))) && !exclude.some(re => re.test(d.path)));
}

function parseSmart(text, devicePath, rc) {
  const model = firstMatch(text, /^(?:Device Model|Product|Model Number):\s*(.+)$/m) || 'Unknown';
  const serial = firstMatch(text, /^Serial Number:\s*(.+)$/m) || 'Unknown';
  const capacity = firstMatch(text, /^(?:User Capacity|Namespace 1 Size\/Capacity):\s*(.+)$/m) || 'Unknown';
  const health = firstMatch(text, /^(?:SMART overall-health self-assessment test result|SMART Health Status):\s*(.+)$/m) || firstMatch(text, /^SMART overall-health.*?:\s*(.+)$/m) || 'Unknown';
  const vals = {
    temp_c: attrRaw(text, 194) || attrRaw(text, 190) || firstMatch(text, /^Temperature:\s*(\d+)/m) || firstMatch(text, /^Current Drive Temperature:\s*(\d+)/m) || 'Unknown',
    power_on_hours: attrRaw(text, 9) || firstMatch(text, /^Power On Hours:\s*(\d+)/m) || 'Unknown',
    reallocated_sectors: attrRaw(text, 5) || 'Unknown',
    pending_sectors: attrRaw(text, 197) || 'Unknown',
    offline_uncorrectable: attrRaw(text, 198) || 'Unknown',
    udma_crc_errors: attrRaw(text, 199, 'UDMA_CRC_Error_Count') || attrRaw(text, 199) || 'Unknown',
    ata_error_count: firstMatch(text, /^ATA Error Count:\s*(\d+)/m) || '0',
    command_timeout: attrRaw(text, 188) || 'Unknown',
    reported_uncorrect: attrRaw(text, 187) || 'Unknown',
    spin_retry_count: attrRaw(text, 10) || 'Unknown',
    power_cycle_count: attrRaw(text, 12) || firstMatch(text, /^Power Cycles:\s*(\d+)/m) || 'Unknown'
  };
  const usable = /SMART|Device Model|Model Number|START OF|NVMe/i.test(text);
  const result = usable ? classify(health, vals) : 'UNKNOWN';
  const notes = usable ? notesFor(health, vals) : (text.trim().split(/\r?\n/).slice(-1)[0] || 'smartctl returned no usable data');
  return { model, serial, capacity, health, result, vals, selftest: latestSelftest(text), rc, notes };
}

async function ensureCsv(csv) {
  await fsp.mkdir(path.dirname(csv), { recursive: true });
  try { await fsp.access(csv); } catch { await fsp.writeFile(csv, `${HEADER.join(',')}\n`); }
}

async function main() {
  const config = loadConfig();
  const dataDir = config.output?.dataDir || DATA_DIR;
  const csv = config.output?.csv || path.join(dataDir, 'disk-health-history.csv');
  const rawDir = config.output?.rawDir || path.join(dataDir, 'raw');
  await fsp.mkdir(rawDir, { recursive: true });
  await ensureCsv(csv);

  const d = new Date();
  const timestamp = isoLocal(d);
  const runId = nowRunId(d);
  const host = process.env.HOSTNAME || sh(['hostname']).stdout?.trim() || 'unknown';
  const devices = smartScan(config);
  if (!devices.length) console.error('No disks found. Try privileged mode and mount /dev, or configure devices manually.');

  const rows = [];
  for (const dev of devices) {
    const devPath = dev.path;
    const commandSets = Array.isArray(dev.commands) && dev.commands.length
      ? dev.commands
      : [dev.smartctlArgs || [...(config.defaults?.args || ['-T','permissive','-a']), ...(dev.args || [])]];
    const outputs = [];
    let rc = 0;
    for (const args of commandSets) {
      const r = sh([config.smartctl, ...args, devPath]);
      rc = Math.max(rc, r.status ?? 0);
      outputs.push(`$ ${config.smartctl} ${args.join(' ')} ${devPath}\n${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}`);
    }
    const text = outputs.join('\n\n');
    const rawFile = path.join(rawDir, `${runId}_${safeName(devPath)}.txt`);
    await fsp.writeFile(rawFile, text);
    const p = parseSmart(text, devPath, rc);
    if ((!p.model || p.model === 'Unknown') && dev.model) p.model = dev.model;
    if ((!p.serial || p.serial === 'Unknown') && dev.serial) p.serial = dev.serial;
    if ((!p.capacity || p.capacity === 'Unknown') && dev.capacity) p.capacity = dev.capacity;
    const transport = dev.transport || (String(dev.args || '').includes('usb') || String(dev.args || '').includes('sat') ? 'usb' : 'auto');
    const row = [timestamp, runId, host, devPath, transport, dev.type || 'auto', p.model, p.serial, p.capacity, p.health, p.result,
      p.vals.temp_c, p.vals.power_on_hours, p.vals.reallocated_sectors, p.vals.pending_sectors, p.vals.offline_uncorrectable,
      p.vals.udma_crc_errors, p.vals.ata_error_count, p.vals.command_timeout, p.vals.reported_uncorrect, p.vals.spin_retry_count,
      p.vals.power_cycle_count, p.selftest, p.rc, p.notes, rawFile];
    rows.push(row);
    console.log(`${devPath}: ${p.result} ${p.model} temp=${p.vals.temp_c}C hours=${p.vals.power_on_hours} rc=${p.rc}`);
  }
  if (rows.length) await fsp.appendFile(csv, rows.map(r => r.map(csvEscape).join(',')).join('\n') + '\n');
  console.log(`Wrote ${rows.length} rows to ${csv}`);
}

main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
