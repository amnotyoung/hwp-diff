import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { parse, patchHwp } from 'kordoc';
import { sampleFiles } from '../../src/sample-data.mjs';
import { compareDocuments } from '../../src/engine.mjs';
import { previewDocument } from '../../src/preview.mjs';
import { formatSamples } from '../../tests/helpers/format-fixture.mjs';
import { memoFixture } from '../../tests/helpers/memo-fixture.mjs';
const dir=resolve('samples/generated/browser-probe');
await mkdir(dir,{recursive:true});
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=result=>{const copy=structuredClone(result);delete copy.createdAt;return JSON.stringify(copy);};
const pairs=[];
async function pair(id,files){const paths=[];for(let i=0;i<2;i++){const path=join(dir,`${id}-${i}${files[i].name.endsWith('.hwp')?'.hwp':'.hwpx'}`);await writeFile(path,files[i].bytes);paths.push(path);}pairs.push({id,paths});}
const sample=await sampleFiles();await pair('hwpx-content',[sample.oldFile,sample.newFile]);await pair('hwpx-identical',[sample.oldFile,sample.oldFile]);
await pair('hwpx-format',await formatSamples());await pair('hwpx-memo',await memoFixture());
const hwpDir=process.argv[2];if(!hwpDir)throw Error('Pass a directory containing the rhwp public HWP samples.');
for(const name of ['shift-return.hwp','BlogForm_BookReview.hwp','footnote-01.hwp']){
 const bytes=new Uint8Array(await readFile(join(hwpDir,name)));const file={name,bytes};
 if(name==='shift-return.hwp'){
 const parsed=await parse(bytes,{ocr:false,images:false});const patched=await patchHwp(bytes,parsed.markdown.replace('이 있습니다.','이 없습니다.'));
 if(!patched.success||patched.applied!==1||patched.skipped.length)throw Error('Controlled HWP change not created');
 await pair('hwp-content',[file,{name,bytes:patched.data}]);await pair('mixed',[file,sample.newFile]);
 }else await pair(name.startsWith('Blog')?'hwp-table':'hwp-footnote',[file,file]);
}
await pair('corrupt-hwp',[{name:'bad.hwp',bytes:new TextEncoder().encode('not a document')},sample.newFile]);
for(const c of pairs){
 const files=await Promise.all(c.paths.map(async path=>({name:basename(path),bytes:new Uint8Array(await readFile(path))})));
 c.inputSha256=files.map(f=>digest(f.bytes));
 try{const r=await compareDocuments(...files);c.expected={hash:digest(canonical(r)),stats:r.stats,formats:Object.values(r.documents).map(d=>d.format),formatAvailable:r.formatting.available,memoAvailable:r.annotations.available,previews:[]};
 for(const f of files){try{const p=await previewDocument(f,1);c.expected.previews.push({imageSha256:digest(p.image),pages:p.pages??p.totalPages,format:p.format});}catch(e){c.expected.previews.push({error:e.message});}}
 }catch(e){c.expected={error:e.message};}
 console.log(c.id,JSON.stringify(c.expected));
}
await mkdir('artifacts/browser-probe',{recursive:true});await writeFile('artifacts/browser-probe/cases.json',JSON.stringify(pairs,null,2));
