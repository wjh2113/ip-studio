#!/usr/bin/env bash
# 每日备份：数据库（在线一致性快照）+ 配图 + 口播录音，保留最近 14 天。
# 部署脚本会把它装进 crontab（每天 03:17）。手动跑：bash scripts/backup.sh
#
# 只是本机备份：磁盘坏了一样会丢。要做到异地，把 BACKUP_DIR 同步到对象存储，
# 例如在本脚本末尾加一行 ossutil / rclone 命令（凭据放服务器环境变量，不进仓库）。
set -euo pipefail
# 备份里有密码哈希和加密过的配置：只给自己读
umask 077

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA_DIR="${DATA_DIR:-${APP_DIR}/data}"
BACKUP_DIR="${BACKUP_DIR:-/opt/ip-studio-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/${STAMP}"

mkdir -p "${OUT}"

# 连接串只从环境或 .env 读取，不打印
if [[ -z "${DATABASE_URL:-}" && -f "${APP_DIR}/.env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "${APP_DIR}/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "backup failed: DATABASE_URL is empty" >&2
  exit 1
fi

# 连接串拆成 PG* 环境变量：密码不出现在 pg_dump 的命令行参数里（ps 看得见）
eval "$(DATABASE_URL="${DATABASE_URL}" node -e '
  const u = new URL(process.env.DATABASE_URL);
  const q = (v) => `'"'"'${String(v).replace(/'"'"'/g, `'"'"'\\'"'"''"'"'`)}'"'"'`;
  const out = {
    PGHOST: u.hostname || "127.0.0.1",
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username || ""),
    PGPASSWORD: decodeURIComponent(u.password || ""),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1) || ""),
  };
  for (const [k, v] of Object.entries(out)) if (v) console.log(`export ${k}=${q(v)}`);
')"
pg_dump --format=custom --file="${OUT}/app.dump"

for d in images speaks inbox; do
  if [[ -d "${DATA_DIR}/${d}" ]]; then
    tar -czf "${OUT}/${d}.tar.gz" -C "${DATA_DIR}" "${d}"
  fi
done

# 过期清理：只删本目录下按日期命名的子目录
find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"${KEEP_DAYS}" -exec rm -rf {} +

echo "backup ok: ${OUT} ($(du -sh "${OUT}" | cut -f1))"
