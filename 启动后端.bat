@echo off
chcp 65001 >nul
title 知涯 ZHIYA · 后端服务
cd /d "%~dp0"

echo.
echo   ============================================
echo     知涯 ZHIYA  ·  本地后端服务
echo   ============================================
echo.
echo   启动中... 首次启动约需 3 秒
echo   关闭本窗口 = 停止服务
echo.

rem 密钥不写在本文件里 —— 从 .env.local 读取（该文件已在 .gitignore 中）。
rem 首次使用：先复制 .env.example 为 .env.local 并填入 WB_CLOUD_PUBLISHABLE_KEY
if exist ".env.local" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
    if not "%%A"=="" (
      if "%%A" neq "#" set "%%A=%%B"
    )
  )
)

if "%WB_CLOUD_PUBLISHABLE_KEY%"=="" (
  echo.
  echo   [配置缺失] 请先创建 .env.local 并填入云服务配置：
  echo.
  echo     copy .env.example .env.local
  echo     然后编辑 .env.local，填入 WB_CLOUD_PUBLISHABLE_KEY
  echo.
  pause
  exit /b 1
)

if "%WB_CLOUD_ENDPOINT%"=="" set WB_CLOUD_ENDPOINT=https://zhiya-career.app.workbuddy.host
if "%ZHIYA_MODEL%"=="" set ZHIYA_MODEL=deepseek-v4.1-flash
if "%PORT%"=="" set PORT=5178

node server/index.js

echo.
echo   服务已停止。按任意键关闭窗口。
pause >nul
