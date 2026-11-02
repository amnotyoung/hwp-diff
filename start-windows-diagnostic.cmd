@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal
if exist "runtime\node.exe" (
  set "HWP_DIFF_NODE=runtime\node.exe"
) else (
  set "HWP_DIFF_NODE=node"
)
set "HWP_DIFF_LOG=%TEMP%\hancom-diff-startup-%RANDOM%-%RANDOM%.log"
echo 한컴 diff 실행 진단
echo 시작 로그: %HWP_DIFF_LOG%
echo 브라우저가 열리지 않으면 server-ready 옆 주소를 Edge 또는 Chrome에 입력하세요.
echo launcher-started>"%HWP_DIFF_LOG%"
"%HWP_DIFF_NODE%" src\diagnostic-start.mjs --log "%HWP_DIFF_LOG%"
set "HWP_DIFF_EXIT=%ERRORLEVEL%"
echo runtime-exit=%HWP_DIFF_EXIT%>>"%HWP_DIFF_LOG%"
echo 종료 결과: %HWP_DIFF_EXIT%
echo 시작 로그: %HWP_DIFF_LOG%
pause
exit /b %HWP_DIFF_EXIT%
