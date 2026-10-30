Unicode true
Name "한컴 diff"
OutFile "${OUTPUT_EXE}"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
SetCompressor /SOLID lzma
SetDatablockOptimize on
VIProductVersion "${APP_QUAD_VERSION}"
VIAddVersionKey "ProductName" "한컴 diff"
VIAddVersionKey "FileDescription" "한컴 diff — 문서 비교"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "Third-party notices are included in the application."

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\app"
  File /r "${PAYLOAD_DIR}/*"
  SetOutPath "$PLUGINSDIR"
  File /oname=node.exe "${NODE_EXE}"
  File /oname=NODE-LICENSE.txt "${NODE_LICENSE}"
  SetOutPath "$TEMP"
  nsExec::ExecToStack '"$PLUGINSDIR\node.exe" "$PLUGINSDIR\app\src\portable.mjs"'
  Pop $0
  Pop $1
  StrCmp $0 "0" done
  MessageBox MB_OK|MB_ICONSTOP "한컴 diff를 실행하지 못했습니다.$\r$\n$1"
done:
SectionEnd
