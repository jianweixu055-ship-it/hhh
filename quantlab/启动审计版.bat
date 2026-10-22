@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 18 或更新版本，再重新启动。
  pause
  exit /b 1
)
echo 请在浏览器打开 127.0.0.1:8666/audit.html
echo 关闭本窗口可停止服务。若端口被旧版本占用，请先关闭旧版本。
node server.js
pause
