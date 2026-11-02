Unicode true
Name "한컴 diff"
OutFile "${OUTPUT_EXE}"
RequestExecutionLevel user
SilentInstall normal
AutoCloseWindow false
ShowInstDetails show
Caption "한컴 diff - 실행 상태"
BrandingText " "
Page instfiles
Var StartupLog
Var LogHandle
SetCompressor /SOLID lzma
SetDatablockOptimize on
VIProductVersion "${APP_QUAD_VERSION}"
VIAddVersionKey "ProductName" "한컴 diff"
VIAddVersionKey "FileDescription" "한컴 diff — 문서 비교"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "Third-party notices are included in the application."

Section
  StrCpy $StartupLog "$TEMP\hancom-diff-startup-$HWNDPARENT.log"
  DetailPrint "시작 로그: $StartupLog"
  FileOpen $LogHandle "$StartupLog" w
  IfErrors log_unavailable
  FileWrite $LogHandle "launcher-started$\r$\npayload-extracting$\r$\n"
  FileClose $LogHandle
  Goto extract
log_unavailable:
  DetailPrint "시작 로그를 저장할 수 없습니다. 이 창의 내용을 확인해 주세요."
extract:
  DetailPrint "내부 프로그램을 준비하고 있습니다."
  InitPluginsDir
  SetDetailsPrint none
  SetOutPath "$PLUGINSDIR\app"
  File /r "${PAYLOAD_DIR}/*"
  SetOutPath "$PLUGINSDIR"
  File /oname=node.exe "${NODE_EXE}"
  File /oname=NODE-LICENSE.txt "${NODE_LICENSE}"
  SetDetailsPrint both
  SetOutPath "$TEMP"
  FileOpen $LogHandle "$StartupLog" a
  IfErrors run
  FileWrite $LogHandle "payload-ready$\r$\nruntime-launching$\r$\n"
  FileClose $LogHandle
run:
  DetailPrint "내부 프로그램을 실행합니다. 아래에 server-ready가 나오면 서버가 준비된 것입니다."
  DetailPrint "브라우저가 열리지 않으면 표시된 http://127.0.0.1 주소를 Edge 또는 Chrome에 입력하세요."
  DetailPrint "browser-requested는 열기 요청, browser-connected는 앱 화면 연결을 뜻합니다."
  DetailPrint "5분 동안 앱 화면에 연결되지 않으면 종료합니다. 프로그램 종료 후 이 창을 닫을 수 있습니다."
  nsExec::ExecToLog '"$PLUGINSDIR\node.exe" "$PLUGINSDIR\app\src\diagnostic-start.mjs" --log "$StartupLog"'
  Pop $0
  FileOpen $LogHandle "$StartupLog" a
  IfErrors result
  FileWrite $LogHandle "runtime-exit=$0$\r$\n"
  FileClose $LogHandle
result:
  DetailPrint "내부 프로그램 종료 결과: $0"
  DetailPrint "시작 로그: $StartupLog"
  StrCmp $0 "0" done
  MessageBox MB_OK|MB_ICONSTOP "한컴 diff를 실행하지 못했습니다. 결과: $0$\r$\n실행 상태 창과 시작 로그를 확인해 주세요.$\r$\n$StartupLog"
done:
SectionEnd
