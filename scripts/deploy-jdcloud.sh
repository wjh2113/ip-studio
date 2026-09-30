#!/usr/bin/env bash
# 部署文案工坊到京东云：rsync + npm + nginx + pm2。
# 不覆盖服务器上的 .env 和 data/（库和密钥留在线上）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${DEPLOY_HOST:-ubuntu@111.228.6.222}"
REMOTE_DIR="${DEPLOY_PATH:-/opt/ip-studio}"
STAGING="/tmp/ip-studio-deploy"
PORT="${DEPLOY_PORT:-5177}"
DOMAIN="${DEPLOY_DOMAIN:-ip.aidigitcloud.cn}"

echo "==> 部署前先跑检查和测试（不通过就不上线）"
(cd "${ROOT}" && npm test)

echo "==> Stage to ${REMOTE}:${STAGING}"
ssh "${REMOTE}" "rm -rf '${STAGING}' && mkdir -p '${STAGING}'"
rsync -az \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'data' \
  --exclude '.DS_Store' \
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
sudo mkdir -p "\${REMOTE_DIR}/data"
sudo chown -R ubuntu:ubuntu "\${REMOTE_DIR}"
cd "\${REMOTE_DIR}"

ENV_FILE="\${REMOTE_DIR}/.env"
if [[ ! -f "\${ENV_FILE}" ]]; then
  cp "\${REMOTE_DIR}/.env.example" "\${ENV_FILE}"
fi

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

npm install --omit=dev

sudo cp "\${REMOTE_DIR}/deploy/nginx-ip-studio.conf" /etc/nginx/conf.d/ip-studio.conf
sudo nginx -t
sudo systemctl reload nginx

if pm2 describe ip-studio >/dev/null 2>&1; then
  pm2 restart ip-studio --update-env
else
  pm2 start "\${REMOTE_DIR}/ecosystem.config.cjs"
fi
pm2 save

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
