#!/bin/bash
# 知涯 ZHIYA · 本地后端启动脚本
#
# 密钥不写在本文件里 —— 从 .env.local 读取（该文件已在 .gitignore 中）。
# 首次使用：
#   cp .env.example .env.local && 填入 WB_CLOUD_PUBLISHABLE_KEY
#
set -e
cd "$(dirname "$0")"

# 读取 .env.local（存在才读，不存在时后续会给出清晰报错）
if [ -f .env.local ]; then
  set -a
  . ./.env.local
  set +a
fi

if [ -z "$WB_CLOUD_PUBLISHABLE_KEY" ]; then
  echo ""
  echo "  [配置缺失] 请先创建 .env.local 并填入云服务配置："
  echo ""
  echo "    cp .env.example .env.local"
  echo "    然后编辑 .env.local，填入 WB_CLOUD_PUBLISHABLE_KEY"
  echo ""
  exit 1
fi

export WB_CLOUD_ENDPOINT="${WB_CLOUD_ENDPOINT:-https://zhiya-career.app.workbuddy.host}"
export ZHIYA_MODEL="${ZHIYA_MODEL:-deepseek-v4.1-flash}"
export PORT="${PORT:-5178}"

exec node server/index.js
