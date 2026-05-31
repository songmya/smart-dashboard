# SMART Dashboard Docker Service

A general-purpose SMART disk health collector and CSV-based trend dashboard.

## Features

- Automatically discovers disks with `smartctl --scan-open` by default
- Supports manually configured disks and custom `smartctl` arguments
- Writes collection history to CSV: `/data/disk-health-history.csv`
- Saves raw `smartctl` output for each run under `/data/raw/`
- Web UI for trend charts, latest disk status, and risk changes
- One-click disk check from the Web UI, with automatic refresh after completion
- Collapsible and readable disk-check output panel, with raw output still available
- Docker Compose deployment
- Optional cron-based scheduled collection

## Quick Start

```bash
cd /vol1/1000/openclaw/disk-health
docker compose up -d --build
```

Then open:

```text
http://<server-ip>:8787
```

> Reading SMART data usually requires access to block devices. The default Compose file uses `privileged: true` and mounts `/dev` and `/run/udev`.

## Data and Configuration

Docker Compose creates and uses:

```text
./data/                 # CSV history and raw smartctl output
./config/config.json    # Collector configuration; copied from config.example.json on first start
```

## Example Configuration

```json
{
  "smartctl": "/usr/sbin/smartctl",
  "output": {
    "dataDir": "/data",
    "csv": "/data/disk-health-history.csv",
    "rawDir": "/data/raw"
  },
  "scan": {
    "enabled": true,
    "commandArgs": ["--scan-open"],
    "include": [],
    "exclude": []
  },
  "defaults": {
    "args": ["-T", "permissive", "-a"]
  },
  "devices": []
}
```

### Automatic Disk Scan

Keep `devices` empty:

```json
"devices": []
```

The collector runs:

```bash
smartctl --scan-open
```

Then it checks each discovered disk with the default arguments:

```bash
smartctl -T permissive -a <device>
```

### Manually Configure USB/SATA Bridge Arguments

Some USB/SATA bridges need explicit `-d sat` or separate commands for identity and SMART data.

```json
{
  "devices": [
    {
      "path": "/dev/sdc",
      "smartctlArgs": ["-T", "permissive", "-d", "sat", "-a"],
      "transport": "usb",
      "type": "sat"
    },
    {
      "path": "/dev/nvme0n1",
      "smartctlArgs": ["-a"],
      "transport": "nvme"
    }
  ]
}
```

You can also split a disk check into multiple `smartctl` commands:

```json
{
  "devices": [
    {
      "path": "/dev/sdc",
      "commands": [
        ["-T", "permissive", "-d", "sat", "-i"],
        ["-T", "permissive", "-d", "sat", "-H", "-A", "-l", "error", "-l", "selftest"]
      ],
      "transport": "usb",
      "type": "sat"
    }
  ]
}
```

### Include or Exclude Disks During Scan

`include` and `exclude` are regular expressions:

```json
"scan": {
  "enabled": true,
  "commandArgs": ["--scan-open"],
  "include": ["^/dev/sd"],
  "exclude": ["^/dev/sda$"]
}
```

## Scheduled Collection

Edit `docker-compose.yml`:

```yaml
environment:
  CRON_SCHEDULE: "0 */8 * * *"
```

This collects SMART data every 8 hours.

To collect once when the container starts:

```yaml
environment:
  RUN_ON_START: "true"
```

## Run a Manual Collection

From the host:

```bash
docker exec smart-dashboard node /app/collector.js
```

Or click **Run check** in the Web UI.

## Web UI

The dashboard shows:

- Disk status cards
- Temperature and SMART metric trend charts
- Latest records table
- Risk changes, such as rising counters or high temperatures
- Disk check output panel

The disk check panel can be expanded or collapsed. The UI stores this preference in the browser's `localStorage`.

## API

```text
GET  /api/health
GET  /api/data
GET  /api/check
POST /api/check
GET  /api/events
```

### API Overview

- `GET /api/health` — service status and configuration summary
- `GET /api/data` — parsed CSV records, metrics, and grouped disk summaries
- `GET /api/check` — current or latest disk-check job status
- `POST /api/check` — start a disk check
- `GET /api/events` — Server-Sent Events stream for live updates

## Environment Variables

| Variable | Default | Description |
|---|---:|---|
| `HOST` | `0.0.0.0` | Web server bind address |
| `PORT` | `8787` | Web server port |
| `DATA_DIR` | `/data` | Data directory |
| `CONFIG_FILE` | `/config/config.json` | Collector configuration file |
| `CSV_FILE` | `/data/disk-health-history.csv` | CSV history file |
| `CHECK_COMMAND` | `node /app/collector.js` | Command executed by the Web UI check button |
| `DASHBOARD_TITLE` | `SMART 硬盘健康监控` | Dashboard page title |
| `RUN_ON_START` | `false` | Run one collection when the container starts |
| `CRON_SCHEDULE` | empty | Cron expression for scheduled collection |
| `WATCH_INTERVAL_MS` | `2000` | CSV watch interval used by the dashboard server |
| `CHECK_TIMEOUT_MS` | `600000` | Web UI check timeout in milliseconds |
| `ALLOW_CHECK` | `true` | Enable or disable Web UI disk checks |

## CSV Columns

The collector writes one row per disk per collection run. Common columns include:

```text
timestamp, run_id, host, disk, transport, device_type, model, serial, capacity,
health, result, temp_c, power_on_hours, reallocated_sectors, pending_sectors,
offline_uncorrectable, udma_crc_errors, ata_error_count, command_timeout,
reported_uncorrect, spin_retry_count, power_cycle_count, selftest_latest,
smart_exit_code, notes, raw_file
```

`result` is derived from SMART health and key counters:

- `OK` — no obvious issue detected
- `WARN` — warning condition, such as high temperature or CRC/ATA errors
- `BAD` — serious condition, such as failed health status, reallocated sectors, pending sectors, or offline uncorrectable sectors
- `UNKNOWN` — `smartctl` returned no usable SMART data

## Migrate Existing Data

If you already have an old CSV file:

```bash
mkdir -p data
cp disk-health-history.csv data/
```

Then start Docker Compose normally.

## Troubleshooting

### No disks are found

Make sure the container has access to block devices:

- Use `privileged: true`
- Mount `/dev:/dev`
- Mount `/run/udev:/run/udev:ro`

You can also manually configure disks in `config/config.json`.

### USB disks show incomplete SMART data

Try adding `-d sat` and permissive mode:

```json
{
  "path": "/dev/sdc",
  "smartctlArgs": ["-T", "permissive", "-d", "sat", "-a"]
}
```

### The Web UI check button is unavailable

Check whether `ALLOW_CHECK` is disabled:

```yaml
environment:
  ALLOW_CHECK: "true"
```

### Permission denied when reading disks

SMART access usually requires elevated privileges. For Docker deployments, keep the default privileged and device mounts unless you have a more restrictive host-specific setup.
