#!/usr/bin/env bash
# 每日备份：数据库（在线一致性快照）+ 配图 + 口播录音，保留最近 14 天。
# 部署脚本会把它装进 crontab（每天 03:17）。手动跑：bash scripts/backup.sh
#
# 只是本机备份：磁盘坏了一样会丢。要做到异地，把 BACKUP_DIR 同步到对象存储，
# 例如在本脚本末尾加一行 ossutil / rclone 命令（凭据放服务器环境变量，不进仓库）。
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA_DIR="${DATA_DIR:-${APP_DIR}/data}"
BACKUP_DIR="${BACKUP_DIR:-/opt/ip-studio-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/${STAMP}"

mkdir -p "${OUT}"

# VACUUM INTO 在服务运行中也能拿到一致的快照（WAL 模式下直接 cp 可能拿到半截）
node --no-warnings -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1], { readOnly: true });
db.exec(\"VACUUM INTO '\" + process.argv[2].replace(/'/g, \"''\") + \"'\");
" "${DATA_DIR}/app.db" "${OUT}/app.db"

for d in images speaks; do
  if [[ -d "${DATA_DIR}/${d}" ]]; then
    tar -czf "${OUT}/${d}.tar.gz" -C "${DATA_DIR}" "${d}"
  fi
done

# 过期清理：只删本目录下按日期命名的子目录
find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"${KEEP_DAYS}" -exec rm -rf {} +

echo "backup ok: ${OUT} ($(du -sh "${OUT}" | cut -f1))"
