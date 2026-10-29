export const oldMarkdown = `# 지역보건 역량강화 사업계획

## 1. 사업 개요

사업기간은 2026년부터 2028년까지이며, 지역 보건소의 서비스 접근성을 개선한다.

사업 대상은 3개 지역 보건소이며, 연간 교육 인원은 120명으로 한다.

## 2. 예산 계획

| 항목 | 금액(만 달러) | 비고 |
| --- | --- | --- |
| 시설 개선 | 300 | 보건소 3개소 |
| 역량 강화 | 150 | 연수·현장 교육 |
| 성과 관리 | 50 | 기초선·종료선 조사 |
| 합계 | 500 | 총사업비 |

## 3. 추진 체계

사업 진행 상황은 분기별로 보고한다.

종이 설문지를 우편으로 제출한다.
`;

export const newMarkdown = `# 지역보건 역량강화 사업계획

## 1. 사업 개요

사업기간은 2026년부터 2029년까지이며, 지역 보건소의 서비스 접근성을 개선한다.

사업 대상은 3개 지역 보건소이며, 연간 교육 인원은 180명으로 한다.

## 2. 예산 계획

| 항목 | 금액(만 달러) | 비고 |
| --- | --- | --- |
| 시설 개선 | 400 | 보건소 3개소 |
| 역량 강화 | 200 | 연수·현장 교육 |
| 성과 관리 | 50 | 기초선·종료선 조사 |
| 합계 | 650 | 총사업비 |

## 3. 추진 체계

사업 진행 상황은 분기별로 보고한다.

개인정보 동의서를 신규 필수 서류로 지정한다.

## 4. 사후 관리

사업 종료 후 1년간 시설 운영 현황을 점검한다.
`;

export async function sampleFiles() {
  process.env.KORDOC_OFFLINE = '1';
  const { markdownToHwpx } = await import('kordoc');
  return {
    oldFile: { name: '사업계획_구버전.hwpx', bytes: new Uint8Array(await markdownToHwpx(oldMarkdown)) },
    newFile: { name: '사업계획_신버전.hwpx', bytes: new Uint8Array(await markdownToHwpx(newMarkdown)) },
  };
}
