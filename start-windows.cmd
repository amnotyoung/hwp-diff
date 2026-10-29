@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "runtime\node.exe" (
  set "HWP_DIFF_NODE=runtime\node.exe"
) else (
  set "HWP_DIFF_NODE=node"
)
echo 브라우저에서 http://127.0.0.1:3210 주소를 여세요.
echo 창을 닫거나 Ctrl+C를 누르면 종료합니다.
"%HWP_DIFF_NODE%" src\server.mjs
pause
