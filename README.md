# SMART Dashboard Docker Service

一个通用的 SMART 硬盘健康采集 + CSV 趋势 WebUI 服务。

## 功能

- 自动扫描硬盘：默认使用 `smartctl --scan-open`
- 支持配置文件手动指定硬盘和 smartctl 参数
- 采集结果写入 CSV：`/data/disk-health-history.csv`
- 保存每次原始 smartctl 输出：`/data/raw/`
- WebUI 展示趋势曲线、最新状态、风险变化
- WebUI 支持“一键检测”，检测完成后自动刷新
- 支持 Docker Compose 部署
- 可选 cron 定时采集

## 快速启动

```bash
cd /vol1/1000/openclaw/disk-health
docker compose up -d --build
```

访问：

```text
http://<机器IP>:8787
```

> 读取 SMART 通常需要访问块设备，所以 compose 默认使用 `privileged: true`，并挂载 `/dev` 与 `/run/udev`。

## 数据与配置

Compose 会创建：

```text
./data/                 # CSV 和 raw 原始输出
./config/config.json    # 采集配置，首次启动自动从 config.example.json 复制
```

## 配置示例

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

### 自动扫描

保留：

```json
"devices": []
```

服务会自动运行：

```bash
smartctl --scan-open
```

然后对扫描到的硬盘执行默认参数：

```bash
smartctl -T permissive -a <device>
```

### 手动指定 USB/SATA 桥参数

```json
{
  "devices": [
    {
      "path": "/dev/sdc",
      "smartctlArgs": ["-T", "permissive", "-d", "sat", "-a"],
      "transport": "usb"
    },
    {
      "path": "/dev/nvme0n1",
      "smartctlArgs": ["-a"],
      "transport": "nvme"
    }
  ]
}
```

### 只扫描部分硬盘

`include` / `exclude` 是正则：

```json
"scan": {
  "enabled": true,
  "commandArgs": ["--scan-open"],
  "include": ["^/dev/sd"],
  "exclude": ["^/dev/sda$"]
}
```

## 定时采集

编辑 `docker-compose.yml`：

```yaml
environment:
  CRON_SCHEDULE: "0 */8 * * *"
```

表示每 8 小时采集一次。

也可以设置启动时先采集一次：

```yaml
environment:
  RUN_ON_START: "true"
```

## 手动执行一次采集

```bash
docker exec smart-dashboard node /app/collector.js
```

或者在 WebUI 点击“一键检测”。

## API

```text
GET  /api/health
GET  /api/data
GET  /api/check
POST /api/check
GET  /api/events
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | Web 服务端口 |
| `DATA_DIR` | `/data` | 数据目录 |
| `CONFIG_FILE` | `/config/config.json` | 采集配置文件 |
| `CSV_FILE` | `/data/disk-health-history.csv` | CSV 路径 |
| `CHECK_COMMAND` | `node /app/collector.js` | WebUI 一键检测执行命令 |
| `DASHBOARD_TITLE` | `SMART 硬盘健康监控` | 页面标题 |
| `RUN_ON_START` | `false` | 容器启动后是否采集一次 |
| `CRON_SCHEDULE` | 空 | cron 定时采集表达式 |

## 从旧数据迁移

如果你已有旧 CSV：

```bash
mkdir -p data
cp disk-health-history.csv data/
```

再启动 compose 即可。
