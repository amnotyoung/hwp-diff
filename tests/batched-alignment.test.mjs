import test from 'node:test';
import assert from 'node:assert/strict';
import { diffBlocks, markdownToHwpx } from 'kordoc';
import JSZip from 'jszip';
import { boundedDiff, assertCoverage } from '../src/batched-alignment.mjs';
import { compareBlocks, compareDocuments } from '../src/engine.mjs';
import { preflight } from '../browser/preflight.js';
import { formatSamples } from './helpers/format-fixture.mjs';
import { memoFixture } from './helpers/memo-fixture.mjs';

const p = text => ({type:'paragraph',text});
const table = text => ({type:'table',table:{rows:2,cols:2,sourceId:'tbl-kept',cells:[[{text,rowSpan:2,colSpan:1,blocks:[p(text)]},{text:'right',rowSpan:1,colSpan:1}], [null,{text:'bottom',rowSpan:1,colSpan:1}]]}});
const positions=(result,a,b)=>result.diffs.map(d=>[d.before?a.indexOf(d.before):-1,d.after?b.indexOf(d.after):-1]);

test('packed global alignment matches official whole alignment with boundaries inside insertions and tables', () => {
  const a=[p('반복 제목'),p('사업 500만원'),table('원래 셀'),p('반복 제목'),p('없어진 문장'),p('끝')];
  const b=[p('추가된 첫 문장'),p('반복 제목'),p('사업 501만원'),table('수정 셀'),p('반복 제목'),p('끝')];
  const expected=positions(diffBlocks(a,b),a,b);
  for(const size of [1,3,8,17]) {
    let batches=0;
    const actual=boundedDiff(a,b,{maxBatchCells:size,onBatch:()=>batches++});
    assert.deepEqual(positions(actual,a,b),expected);assert.ok(batches>1);
    assert.equal(actual.diffs.find(d=>d.before===a[2]).before,a[2]);
    assertCoverage(actual.diffs,a,b);
  }
});

test('deterministic repeated-text fuzz keeps official pairing and every occurrence exactly once', () => {
  let state=51;const random=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/2**32);
  const text=['같은 제목','반복 문장','사업비 500','사업비 501','완전히 다른 항목','', 'x'];
  for(let trial=0;trial<150;trial++){
    const a=Array.from({length:1+Math.floor(random()*12)},()=>p(text[Math.floor(random()*text.length)]));
    const b=Array.from({length:1+Math.floor(random()*12)},()=>p(text[Math.floor(random()*text.length)]));
    assert.deepEqual(positions(boundedDiff(a,b,{maxBatchCells:2}),a,b),positions(diffBlocks(a,b),a,b));
  }
});

test('complete comparison keeps cross-batch moves, cell spans, footnotes, global indexes and final IDs', () => {
  const note={...p('각주 연결 문장'),footnoteText:'각주 원문',footnoteBlocks:[p('각주 원문')]};
  const a=[p('1. 제목'),table('이동 대상 표의 충분히 긴 본문입니다'),note,p('본문 A'),p('2. 제목'),p('본문 B')];
  const b=[p('1. 제목'),{...note,footnoteText:'각주 수정',footnoteBlocks:[p('각주 수정')]},p('삽입 문단'),p('본문 A'),p('2. 제목'),table('이동 대상 표의 충분히 긴 본문입니다'),p('본문 B')];
  assert.deepEqual(compareBlocks(a,b,{}, {maxBatchCells:2}),compareBlocks(a,b,{}, {maxBatchCells:Infinity}));
});

test('large repeated paragraphs no longer require user splitting', () => {
  const a=Array.from({length:1500},()=>p('반복되는 사업 문장 500'));
  const b=a.map(x=>({...x}));b[750]=p('반복되는 사업 문장 501');
  const result=compareBlocks(a,b);
  assert.equal(result.stats.modified,1);assert.equal(result.stats.unchanged,1499);
  assert.equal(new Set(result.diffs.map(d=>d.oldIndex)).size,1500);
});

test('coverage validation rejects loss and duplication instead of publishing partial output', () => {
  const a=[p('a'),p('b')],b=[p('c')];
  assert.throws(()=>assertCoverage([{before:a[0],after:b[0]}],a,b),/일부 문단/);
  assert.throws(()=>assertCoverage([{before:a[0]},{before:a[0]},{before:a[1],after:b[0]}],a,b),/중복/);
});

test('automatic picture separation preserves all non-picture bytes and comparison of formatting and cross-paragraph memos', async () => {
  for(const pair of [await formatSamples(),await memoFixture(3,1)]) {
    const enriched=[];
    for(const file of pair){
      const zip=await JSZip.loadAsync(file.bytes);
      zip.file('BinData/oversized.bmp',new Uint8Array(65*1024*1024));
      const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
      enriched.push({name:file.name,bytes});
    }
    const original=enriched.map(f=>Buffer.from(f.bytes));
    const light=[];
    for(const file of enriched){
      await assert.rejects(preflight(file),/그림/);
      const prepared=await preflight(file,{automatic:true});assert.equal(prepared.automaticImagesOmitted,true);
      const before=await JSZip.loadAsync(file.bytes),after=await JSZip.loadAsync(prepared.bytes);
      for(const name of Object.keys(before.files).filter(n=>!before.files[n].dir&&!n.startsWith('BinData/')))
        assert.deepEqual(await after.file(name).async('uint8array'),await before.file(name).async('uint8array'));
      light.push(prepared);
    }
    const expected=await compareDocuments(...enriched),actual=await compareDocuments(...light);
    delete expected.createdAt;delete actual.createdAt;assert.deepEqual(actual,expected);
    enriched.forEach((f,i)=>assert.deepEqual(Buffer.from(f.bytes),original[i]));
  }
});

test('automatic mode does not omit oversized text or SVG as if it were a raster picture', async () => {
  const zip=await JSZip.loadAsync(await markdownToHwpx('본문'));
  zip.file('Contents/section0.xml',new Uint8Array(33*1024*1024));
  zip.file('BinData/large.bmp',new Uint8Array(65*1024*1024));
  const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  await assert.rejects(preflight({name:'text.hwpx',bytes},{automatic:true}),/본문·서식/);
});

test('partial parser success is rejected so a damaged section cannot disappear from comparison', async () => {
  const zip=await JSZip.loadAsync(await markdownToHwpx('정상 본문'));
  const manifest=await zip.file('Contents/content.hpf').async('string');
  zip.file('Contents/content.hpf',manifest.replace('</opf:manifest>','<opf:item id="section1" href="Contents/section1.xml" media-type="application/xml"/></opf:manifest>').replace('</opf:spine>','<opf:itemref idref="section1"/></opf:spine>'));
  zip.file('Contents/section1.xml','<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"><hp:p BROKEN');
  const file={name:'partial.hwpx',bytes:await zip.generateAsync({type:'uint8array'})};
  await assert.rejects(compareDocuments(file,file),/일부 본문이나 표/);
});
