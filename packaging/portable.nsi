Unicode true
Name "HWP diff"
OutFile "${OUTPUT_EXE}"
RequestExecutionLevel user
SilentInstall normal
AutoCloseWindow false
ShowInstDetails show
Caption "HWP diff"
SubCaption 3 " - 실행 상태"
SubCaption 4 " - 종료"
InstallColors 19202C FFFFFF
SetFont "맑은 고딕" 9
CompletedText "프로그램이 종료되었습니다."
BrandingText " "
Page instfiles
Var StartupLog
Var StartupLogName
Var LogHandle
SetCompressor /SOLID lzma
SetDatablockOptimize on
VIProductVersion "${APP_QUAD_VERSION}"
VIAddVersionKey "ProductName" "HWP diff"
VIAddVersionKey "FileDescription" "HWP diff — 문서 비교"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "Third-party notices are included in the application."

Section
  SetDetailsPrint textonly
  DetailPrint "실행 상태를 확인해 주세요."
  SetDetailsPrint listonly
  StrCpy $StartupLogName "hwp-diff-$HWNDPARENT.log"
  StrCpy $StartupLog "$TEMP\$StartupLogName"
  DetailPrint "로그 폴더: Win+R → %TEMP%"
  DetailPrint "$StartupLogName"
  FileOpen $LogHandle "$StartupLog" w
  IfErrors log_unavailable
  FileWrite $LogHandle "launcher-started$\r$\npayload-extracting$\r$\n"
  FileClose $LogHandle
  Goto extract
log_unavailable:
  DetailPrint "로그를 저장할 수 없습니다."
  DetailPrint "이 창의 내용을 확인해 주세요."
extract:
  DetailPrint "내부 프로그램을 준비하고 있습니다."
  InitPluginsDir
  SetDetailsPrint none
  SetOutPath "$PLUGINSDIR\app"
  File /r "${PAYLOAD_DIR}/*"
  SetOutPath "$PLUGINSDIR"
  File /oname=node.exe "${NODE_EXE}"
  File /oname=NODE-LICENSE.txt "${NODE_LICENSE}"
  SetOutPath "$TEMP"
  SetDetailsPrint listonly
  FileOpen $LogHandle "$StartupLog" a
  IfErrors run
  FileWrite $LogHandle "payload-ready$\r$\nruntime-launching$\r$\n"
  FileClose $LogHandle
run:
  DetailPrint "내부 프로그램을 실행합니다."
  DetailPrint "server-ready: 서버 준비 완료"
  DetailPrint "바로 아래 줄이 접속 주소입니다."
  DetailPrint "안 열리면 Edge·Chrome에 입력하세요."
  DetailPrint "browser-requested: 열기 요청"
  DetailPrint "browser-connected: 화면 연결 완료"
  DetailPrint "5분 동안 연결이 없으면 종료합니다."
  nsExec::ExecToLog '"$PLUGINSDIR\node.exe" "$PLUGINSDIR\app\src\diagnostic-start.mjs" --log "$StartupLog"'
  Pop $0
  FileOpen $LogHandle "$StartupLog" a
  IfErrors result
  FileWrite $LogHandle "runtime-exit=$0$\r$\n"
  FileClose $LogHandle
result:
  DetailPrint "내부 프로그램 종료 결과: $0"
  DetailPrint "로그 폴더: Win+R → %TEMP%"
  DetailPrint "$StartupLogName"
  StrCmp $0 "0" done
  MessageBox MB_OK|MB_ICONSTOP "HWP diff를 실행하지 못했습니다. 결과: $0$\r$\n실행 상태 창과 시작 로그를 확인해 주세요.$\r$\n$StartupLog"
done:
SectionEnd
