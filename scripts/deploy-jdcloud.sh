#!/usr/bin/env bash
# 部署自媒体助手到京东云：rsync + npm + nginx + pm2。
# 不覆盖服务器上的 .env 和 data/（库和密钥留在线上）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${DEPLOY_HOST:-ubuntu@111.228.6.222}"
REMOTE_DIR="${DEPLOY_PATH:-/opt/ip-studio}"
STAGING="/tmp/ip-studio-deploy"
PORT="${DEPLOY_PORT:-5177}"
DOMAIN="${DEPLOY_DOMAIN:-ip.aidigitcloud.cn}"

echo "==> 构建 Vue 前端，再跑检查和测试（不通过就不上线）"
(cd "${ROOT}" && npm run build:web && npm test)

echo "==> Stage to ${REMOTE}:${STAGING}"
ssh "${REMOTE}" "rm -rf '${STAGING}' && mkdir -p '${STAGING}'"
rsync -az \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'data' \
  --exclude '.DS_Store' \
  --exclude 'export' \
  --exclude 'export.zip' \
  --exclude 'mobile/node_modules' \
  --exclude 'mobile/dist' \
  --exclude 'mobile/unpackage' \
  "${ROOT}/" "${REMOTE}:${STAGING}/"

echo "==> Install into ${REMOTE_DIR}, nginx, pm2"
ssh "${REMOTE}" bash -s <<REMOTE
set -euo pipefail
STAGING='${STAGING}'
REMOTE_DIR='${REMOTE_DIR}'
PORT='${PORT}'
DOMAIN='${DOMAIN}'

sudo mkdir -p "\${REMOTE_DIR}"
sudo rsync -a \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude 'data' \
  "\${STAGING}/" "\${REMOTE_DIR}/"
# 前端构建产物整目录替换（--delete），旧的带哈希文件不会越积越多
sudo rsync -a --delete "\${STAGING}/dist/" "\${REMOTE_DIR}/dist/"
sudo mkdir -p "\${REMOTE_DIR}/data"
sudo chown -R ubuntu:ubuntu "\${REMOTE_DIR}"
cd "\${REMOTE_DIR}"

ENV_FILE="\${REMOTE_DIR}/.env"
if [[ ! -f "\${ENV_FILE}" ]]; then
  cp "\${REMOTE_DIR}/.env.example" "\${ENV_FILE}"
fi
# .env 里有数据库密码、网关 Key、加密密钥：只给运行服务的用户读
chmod 600 "\${ENV_FILE}"

set_kv() {
  local k="\$1" v="\$2"
  if grep -q "^\${k}=" "\${ENV_FILE}"; then
    sed -i "s|^\${k}=.*|\${k}=\${v}|" "\${ENV_FILE}"
  else
    echo "\${k}=\${v}" >> "\${ENV_FILE}"
  fi
}
set_if_empty() {
  local k="\$1" v="\$2"
  if grep -qE "^\${k}=.+" "\${ENV_FILE}"; then
    return 0
  fi
  sed -i "/^\${k}=/d" "\${ENV_FILE}"
  echo "\${k}=\${v}" >> "\${ENV_FILE}"
}

set_kv NODE_ENV production
set_kv HOST 127.0.0.1
set_kv PORT "\${PORT}"
set_kv TRUST_PROXY 1
set_kv COOKIE_SECURE 1
set_kv REGISTER_OPEN 0
set_kv LLM_PROVIDER gateway
set_kv LLM_GATEWAY_URL https://aiapimgrapi.aidigitcloud.cn
set_kv LLM_TENANT_ID IP
set_kv LLM_CAPABILITY quality-chat
set_kv LLM_CAPABILITY_JSON fast-chat
set_kv LLM_CAPABILITY_IMAGE image-gen
set_kv IMAGE_PROVIDER gateway
set_kv PAY_NOTIFY_BASE "https://\${DOMAIN}"

if ! grep -qE '^SECRET_KEY=.+' "\${ENV_FILE}"; then
  sed -i '/^SECRET_KEY=/d' "\${ENV_FILE}"
  echo "SECRET_KEY=\$(openssl rand -hex 32)" >> "\${ENV_FILE}"
fi
set_if_empty ADMIN_USERNAME admin
if ! grep -qE '^ADMIN_PASSWORD=.+' "\${ENV_FILE}"; then
  sed -i '/^ADMIN_PASSWORD=/d' "\${ENV_FILE}"
  echo "ADMIN_PASSWORD=\$(openssl rand -base64 18 | tr -d '/+=' | head -c 16)Aa1" >> "\${ENV_FILE}"
fi
# 网关 Key 只在空时占位，已配置的不要被别的项目 Key 覆盖
if ! grep -qE '^LLM_GATEWAY_API_KEY=.+' "\${ENV_FILE}"; then
  echo 'LLM_GATEWAY_API_KEY=' >> "\${ENV_FILE}"
  echo 'WARN: LLM_GATEWAY_API_KEY 为空，上线后请写入租户 IP 的 Key' >&2
fi
# 访问密码与 API 网关管理台同一份；已有值不覆盖
if ! grep -qE '^ACCESS_PASSWORD=.+' "\${ENV_FILE}"; then
  GW_PW=\$(grep '^ADMIN_PASSWORD=' /opt/AIapiMgr/backend/.env 2>/dev/null | head -1 | cut -d= -f2- || true)
  if [[ -n "\${GW_PW}" ]]; then
    set_kv ACCESS_PASSWORD "\${GW_PW}"
    set_kv ADMIN_PASSWORD "\${GW_PW}"
  fi
fi

if ! redis-cli ping >/dev/null 2>&1; then
  echo "==> 安装并启动 Redis（BullMQ 用）"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y redis-server
  sudo systemctl enable --now redis-server || sudo systemctl enable --now redis
fi
redis-cli ping
if ! grep -qE '^REDIS_URL=.+' "\${ENV_FILE}"; then
  set_kv REDIS_URL redis://127.0.0.1:6379
fi

PG_PORT=\$(sudo -u postgres psql -tAc "SHOW port" 2>/dev/null | tr -d '[:space:]' || true)
if ! [[ "\${PG_PORT}" =~ ^[0-9]+\$ ]]; then
  echo "==> 安装并启动 PostgreSQL"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql
  sudo systemctl enable --now postgresql
  PG_PORT=\$(sudo -u postgres psql -tAc "SHOW port" | tr -d '[:space:]')
fi
if ! grep -qE '^DATABASE_URL=.+' "\${ENV_FILE}"; then
  echo "==> 创建 PostgreSQL 库 ip_studio（端口 \${PG_PORT}）"
  PG_PASS=\$(openssl rand -hex 24)
  # 密码走标准输入，不放在命令行参数里（ps 看得见）；出错时也不让 PostgreSQL 把这条语句连同密码写进日志
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
SET log_min_error_statement = panic;
DO \\\$\\\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ip_studio') THEN CREATE ROLE ip_studio LOGIN PASSWORD '\${PG_PASS}';
  ELSE ALTER ROLE ip_studio WITH PASSWORD '\${PG_PASS}'; END IF;
END \\\$\\\$;
SQL
  sudo -u postgres psql -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_database WHERE datname = 'ip_studio'" | grep -q 1 \
    || sudo -u postgres createdb -O ip_studio ip_studio
  set_kv DATABASE_URL "postgres://ip_studio:\${PG_PASS}@127.0.0.1:\${PG_PORT}/ip_studio"
fi

npm install --omit=dev
if [[ -f "\${REMOTE_DIR}/data/app.db" && ! -f "\${REMOTE_DIR}/data/app.db.imported" ]]; then
  # 先停旧服务再导入：旧服务还开着的话，导入期间写进 SQLite 的数据会丢；
  # pm2 要是在导入中途把新代码拉起来，新服务会往 PostgreSQL 里写管理员和提示词，和导入撞车。
  echo "==> 停服务，从原来的 SQLite 导入 PostgreSQL（只做一次，成功后写 app.db.imported 标记）"
  pm2 stop ip-studio >/dev/null 2>&1 || true
  if ! node --env-file="\${ENV_FILE}" "\${REMOTE_DIR}/scripts/import-sqlite.js" "\${REMOTE_DIR}/data/app.db"; then
    echo "!! 导入失败，PostgreSQL 已回滚，服务保持停止（SQLite 原库没动）。看上面的报错修好后重新部署；" >&2
    echo "!! 确定不要导入的话，touch \${REMOTE_DIR}/data/app.db.imported 再部署。" >&2
    exit 1
  fi
fi

sudo cp "\${REMOTE_DIR}/deploy/nginx-ip-studio.conf" /etc/nginx/conf.d/ip-studio.conf
sudo nginx -t
sudo systemctl reload nginx

if pm2 describe ip-studio >/dev/null 2>&1; then
  pm2 restart ip-studio --update-env
else
  pm2 start "\${REMOTE_DIR}/ecosystem.config.cjs"
fi
pm2 save
# 页面、样式、脚本以前在 public/，现在全部由 Vite 构建进 dist/，public/ 已经没有用了。
# 新服务起来以后再删：删早了旧服务在重启前会白屏
rm -rf "\${REMOTE_DIR}/public"

# 每日备份（幂等：已装过就不重复加）
sudo mkdir -p /opt/ip-studio-backups && sudo chown ubuntu:ubuntu /opt/ip-studio-backups
CRON_LINE="17 3 * * * APP_DIR=\${REMOTE_DIR} bash \${REMOTE_DIR}/scripts/backup.sh >> /opt/ip-studio-backups/backup.log 2>&1"
( { crontab -l 2>/dev/null | grep -v 'ip-studio.*/scripts/backup.sh'; } || true ; echo "\${CRON_LINE}" ) | crontab -

sleep 2
echo "==> Health"
curl -fsS "http://127.0.0.1:\${PORT}/health"
echo
curl -fsS -o /dev/null -w "HTTPS %{http_code}\\n" --resolve "\${DOMAIN}:443:127.0.0.1" "https://\${DOMAIN}/health" || true
pm2 status ip-studio
echo "==> 管理员用户名：\$(grep '^ADMIN_USERNAME=' "\${ENV_FILE}" | cut -d= -f2-)"
echo "    密码在服务器 \${ENV_FILE} 的 ADMIN_PASSWORD（不会打印）"
rm -rf "\${STAGING}"
REMOTE

echo "==> 部署完成。域名 https://${DOMAIN}"
echo "    若浏览器打不开，请在阿里云 DNS 加一条 A 记录：${DOMAIN} → 111.228.6.222"
