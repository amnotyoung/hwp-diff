import { markdownToHwpx } from 'kordoc';
import JSZip from 'jszip';
export async function automaticComparisonPairs() {
  const files = async (texts, prefix) => Promise.all(texts.map(async (text,i)=>({name:`${prefix}-${i}.hwpx`,bytes:new Uint8Array(await markdownToHwpx(text))})));
  const repeated=Array.from({length:600},()=> '반복되는 사업 문장 500');
  const changed=[...repeated];changed[300]='반복되는 사업 문장 501';
  const large=Array.from({length:2101},(_,i)=>`고유 문단 ${i}의 사업 내용을 확인합니다.`);
  const fresh=[...large];fresh[1000]='고유 문단 1000의 사업 내용을 수정합니다.';
  const picture=await files(['본문 사업비 500만원\n\n| 항목 | 금액 |\n| --- | --- |\n| 예산 | 500 |','본문 사업비 501만원\n\n| 항목 | 금액 |\n| --- | --- |\n| 예산 | 501 |'],'auto-picture');
  for(const file of picture){const zip=await JSZip.loadAsync(file.bytes);zip.file('BinData/large.bmp',new Uint8Array(65*1024*1024));file.bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});}
  return {repeated:await files([repeated.join('\n\n'),changed.join('\n\n')],'auto-repeat'),large:await files([large.join('\n\n'),fresh.join('\n\n')],'auto-large'),picture};
}
