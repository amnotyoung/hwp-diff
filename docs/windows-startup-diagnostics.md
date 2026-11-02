# Windows 실행 진단

작업관리자에 EXE가 보이더라도 내부 Node 프로그램이나 로컬 서버가 준비됐다는 뜻은 아닙니다. 실행 단계별로 확인합니다.

2026-11-02 사용자 요청으로 진단 기능을 포함한 Windows EXE 패키징을 재개했습니다. 이전 EXE는 바뀌지 않으므로 새로 빌드한 `dist/HWP diff.exe`를 사용합니다. Windows 실기기 검증은 별도로 필요합니다.

## 실행 상태 창

EXE를 실행하면 내부 파일 준비 단계부터 상태 창을 표시하고, 종료 후에도 창을 유지합니다. 실행 중에는 비교 화면의 **프로그램 종료**로 종료합니다. 앱 화면에 5분 동안 연결되지 않으면 서버를 종료합니다. 마지막 앱 탭을 닫으면 기존과 같이 약 10초 후 종료합니다.

서버가 준비되면 `server-ready` 옆에 실제 접속 주소가 표시됩니다. 브라우저가 자동으로 열리지 않으면 그 주소 전체를 Edge 또는 Chrome 주소창에 입력합니다. 포트는 실행할 때마다 바뀔 수 있습니다.

시작 로그는 창에 표시된 `%TEMP%\hancom-diff-startup-….log`에 남습니다. 로그 저장에 실패하면 창의 내용을 확인합니다. 로그에는 실행 단계, Node·OS 버전·CPU 종류, 로컬 접속 주소, 시작 오류 코드, 종료 이유를 기록합니다. 문서 이름·본문·비교 결과·전체 환경변수는 기록하지 않습니다. 임시 폴더 정리 시 로그도 삭제될 수 있습니다.

| 마지막 단계 | 확인할 내용 |
| --- | --- |
| 창과 로그가 모두 없음 | EXE 실행 전 차단 또는 실행 준비 문제일 수 있습니다. 작업관리자 상태와 기관 보안 차단 기록을 확인합니다. |
| `payload-extracting` | 임시 폴더 압축 해제 중입니다. 오래 멈추면 디스크 공간·권한·보안 검사 기록을 확인합니다. |
| `runtime-launching` 이후 `runtime-started` 없음 | 내부 Node 시작이 확인되지 않았습니다. 임시 폴더의 실행 파일 차단 여부와 종료 결과를 확인합니다. |
| `runtime-started` 이후 `server-ready` 없음 | 모듈 로딩 또는 서버 시작 문제입니다. `startup-failed`의 오류 코드를 확인합니다. |
| `browser-opening` 또는 `browser-requested` | 브라우저 열기 시도·요청 단계이며 화면 접속 성공은 아닙니다. 표시된 주소에 직접 접속합니다. |
| `browser-open-failed` | 자동 열기에 실패했습니다. 서버는 수동 접속을 위해 유지됩니다. |
| `browser-connected` | 앱 화면 연결이 확인됐습니다. 문서 비교·렌더링 성공을 뜻하지는 않습니다. |
| `stopped`의 `no-browser-connection` | 5분 동안 앱 화면 연결이 없어 종료했습니다. 다시 실행하고 새 주소로 접속합니다. |

기관 보안 정책의 허용 여부는 관리자에게 확인합니다. 이 기능은 차단을 우회하지 않습니다.

## 소스 실행 진단

Node 런타임과 의존성이 준비된 프로젝트에서는 `start-windows-diagnostic.cmd`를 실행합니다. 콘솔을 유지하고 동일한 시작 로그를 기록합니다. 이 CMD 파일만 기존 단일 EXE 옆에 복사해서 실행할 수는 없습니다.

개발 환경의 localhost 확인:

```sh
node src/diagnostic-start.mjs --log /tmp/hancom-diff-startup.log
```

실행 상태 창은 NSIS의 [상세 표시](https://nsis.sourceforge.io/Docs/Chapter4.html)와 [ExecToLog](https://nsis.sourceforge.io/NsExec_plug-in)를 사용합니다. Node가 시작하기 전 단계는 EXE가, 시작한 후 단계는 앱이 기록합니다. Node 자체가 로딩되지 못한 경우 OS 오류의 모든 상세가 로그에 기록된다고 보장하지 않습니다.

## 빌드 캐시 위치

동기화되는 작업 폴더에서 파일 준비가 느리면 `HWP_DIFF_BUILD_CACHE` 환경변수로 로컬 임시 폴더를 지정할 수 있습니다. 기본값은 프로젝트의 `.build-cache`이며, 완성된 EXE는 항상 프로젝트의 `dist`에 생성합니다. 오프라인 빌드는 지정한 캐시에 `packaging/inputs.json`의 Node·NSIS 원본 압축 파일을 미리 복사해 둬야 합니다. 체크섬 검증은 동일하게 수행합니다.
