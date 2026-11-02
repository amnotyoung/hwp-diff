# 서버 없는 HTML 비교 검증

2026-11-02 검증 결과: **HWPX와 HWP 5.x는 로컬 서버 없이 단일 HTML에서 내용 비교와 첫 쪽 미리보기가 가능했다.** 현재 앱 전체를 이식한 제품이 아니라 기술 가능성 검증이다. Windows 실기기·기관 보안 정책은 아직 검증하지 않았다.

## 검증 방법

- Kordoc **4.24.21** 공식 공개 API와 기존 `src/engine.mjs`, `src/preview.mjs`를 그대로 사용했다. 자체 HWP 바이너리 파서를 만들거나 Kordoc의 파싱·비교 코드를 수정하지 않았다.
- macOS Chrome **156.0.0.0**에서 `file://`로 HTML을 직접 열었다. HTTP 서버, EXE, 로컬 Node 서버를 실행하지 않았다. Node는 사전 HTML 빌드와 기준 결과 생성에만 사용했다.
- 브라우저 컨텍스트를 오프라인으로 설정하고 HTTP/HTTPS 요청을 차단·관찰했다. HTML에도 `connect-src 'none'`을 적용했다. 테스트 중 HTTP/HTTPS 요청은 **0건**이었다.
- HTML 한 파일만 빈 임시 폴더로 복사한 뒤에도 같은 9개 사례를 재실행해 통과했다.
- 실제 파일 선택 입력으로 문서를 전달했다. 생성 시각만 제외한 **전체 비교 결과 JSON의 SHA-256**을 Node 결과와 비교했다. 양쪽 **첫 쪽 SVG 이미지와 전체 쪽 수**도 대조했다.
- 공식 공개 API `patchHwp`로 샘플 HWP의 한 문장을 바꾼 검증용 사본을 만들었다. 원본은 수정하지 않았으며 변경 1건이 적용되고 생략된 변경이 없음을 확인했다.

## 결과

| 사례 | 결과 |
| --- | --- |
| HWPX 내용 변경 | 추가 3·삭제 1·수정 3 검출, Node 결과와 일치 |
| HWPX 동일 문서 | 변경 없음, Node 결과와 일치 |
| HWPX 글자 서식 | 네 가지 속성·부분 구간 변경 결과 일치 |
| HWPX 메모 | 메모 추가 결과 일치 |
| HWP 5.x 문장 수정 | 수정 1건 검출, Node 결과와 일치 |
| HWP/HWPX 혼합 | 내용 비교 결과 일치, 서식·메모 미검사 유지 |
| HWP 중첩 표 포함 문서 | 동일 문서 비교·첫 쪽 SVG 일치 |
| HWP 각주 포함 5쪽 문서 | 39개 블록 비교·5쪽 인식·첫 쪽 SVG 일치 |
| 손상 HWP 입력 | Node와 같은 오류, 변경 없음으로 처리하지 않음 |

**9개 사례 모두 통과했다.** 1440px·960px PC 창에서 HWP 입력·결과·양쪽 미리보기 표시도 확인했다. 정상 8개 비교 사례의 양쪽 첫 쪽 미리보기(16개)도 Node 출력과 일치했다. 이는 한컴 원본과의 픽셀 단위 일치를 보증하지 않는다. 두 실행 환경에서 동일한 파서·렌더러가 같은 결과를 냈다는 의미다.

HWP 샘플은 로컬에 있던 [rhwp 공개 샘플](https://github.com/edwardkim/rhwp/tree/main/rhwp-studio/public/samples)의 `shift-return.hwp`, `BlogForm_BookReview.hwp`, `footnote-01.hwp`를 사용했다. HWPX는 기존 프로젝트의 내용·서식·메모 테스트 생성기를 사용했다. 입력 문서와 생성된 사본, 실행 결과는 Git에 포함하지 않는다.

## 필요한 호환 작업

Kordoc의 공식 안내는 [Node 실행 환경](https://github.com/chrisryugj/kordoc)을 기준으로 한다. 브라우저 전용 공식 배포본을 사용한 것이 아니다. 일반 browser 번들 시도는 `fs/promises`, `zlib`, `crypto` 등에서 실패했다.

검증본은 esbuild **0.25.12**와 JSPM core **2.1.0**으로 다음을 연결했다.

- Buffer·process·압축·스트림 등 Node 기능의 브라우저 호환 구현.
- Kordoc의 `createRequire('cfb')`를 이미 사용 중인 동일 버전 `cfb` 라이브러리에 연결. HWP 파싱은 계속 Kordoc 공식 API가 담당한다.
- JSZip의 기본 브라우저 배포본은 `nodeStream`을 제공하지 않아 실패했다. 기존 스트림 지원 엔트리를 번들에 넣어 Kordoc의 제한된 ZIP 읽기 경로를 유지했다.
- 이 검증 환경의 `file://`에서는 모듈 Blob Worker도 초기화에 실패했다. 일반 Blob Worker와 초기화 완료 메시지를 사용하니 작동했다. HTML에는 Worker 코드까지 내장된다.
- PDF·OCR·암호화 문서는 검증 범위에서 제외한다. 미지원 보안 함수·모듈을 성공한 것처럼 흉내 내지 않고 오류로 처리한다. 브라우저의 동등한 보안·자원 한도 보장은 별도 검토 대상이다.

초기 실험에서 사용한 유지보수 중단 번들 플러그인은 최종 빌드 코드에서 제거했다. 최종 검증은 Kordoc 소스의 임시 예외 출력 패치 없이 수행했다.

## 제한과 다음 단계

- 검증 HTML은 파일 선택, 비교 결과 JSON, 양쪽 첫 쪽 미리보기를 제공한다. 기존 결과 탐색·검색·변경 강조·전체 쪽 이동 UI는 아직 이식하지 않았다.
- HWP의 글자 서식·메모 미검사와 Kordoc 미리보기 누락 등 기존 제한이 그대로 남는다. HWP 3.x·배포용·암호·DRM·큰 문서·대규모 업무 코퍼스는 이번 성공 범위에 포함하지 않는다.
- HTML 파일 한 개에 코드와 의존성을 내장했다. 사용자는 파일을 열고 문서를 선택하면 되며 Node·EXE·CDN·인터넷은 필요하지 않다.
- Worker 60초 취소와 입력 20MB 제한은 있으나, Node Worker의 512MB 힙 제한을 브라우저에서 동일하게 적용한 것은 아니다. 압축 폭탄·메모리·호환 계층의 한도 옵션 준수도 제품화 전에 검증해야 한다.
- 회사의 HTML 실행·JavaScript·Worker 정책에 따라 차단될 수 있다. localhost 접속 자체는 사용하지 않으므로 로컬 서버 방화벽 문제와는 분리된다.

## 재현

기존 프로젝트 의존성을 준비한 뒤 검증용 빌드 도구만 별도 캐시에 설치한다.

```sh
npm install --prefix .build-cache/html-tools --no-audit --no-fund esbuild@0.25.12 @jspm/core@2.1.0
node scripts/browser-probe/build.mjs
node scripts/browser-probe/prepare.mjs /path/to/rhwp/rhwp-studio/public/samples
```

산출물은 `artifacts/browser-probe/HWP diff HTML 검증.html`이다. `--plain` 빌드는 호환 계층 없이 실패하는 원인을 확인하는 용도다.

Playwright CLI로 별도 `htmlfile` 세션에서 위 HTML을 `file://`로 연다. CLI 자체는 기본적으로 file URL 탐색을 막으므로, 사용자가 지정한 로컬 파일을 여는 문서화된 `PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=1` 설정을 사용했다. 브라우저 보안을 끄는 실행 옵션은 추가하지 않았다.

```sh
PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=1 playwright-cli -s=htmlfile open 'file:///absolute/path/to/probe.html' --headed
node scripts/browser-probe/verify.mjs /absolute/path/to/playwright-cli
```

`verification.json`, `cases.json`, `build-info.json`과 원시 CLI 결과는 `artifacts/browser-probe/`에 기록한다. 검증 입력은 `samples/generated/browser-probe/`, 화면 캡처는 `output/playwright/`에 두고 모두 Git에서 제외한다.
