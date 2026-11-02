import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createBuildInfo,runtimeBuildInfo} from '../src/app-info.mjs';
import {versionFeedback} from '../public/app-version.js';

test('build identity records version, exact revision, time and uncommitted changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hwp-version-'));
 const git=args=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try{
  await writeFile(join(root,'package.json'),JSON.stringify({version:'0.2.0',dependencies:{kordoc:'4.24.21'}}));
  git(['init','--quiet']);git(['add','package.json']);git(['-c','user.name=Version Test','-c','user.email=version@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','fixture']);
  const a=await createBuildInfo(root,{target:'standalone-html',builtAt:'2026-11-02T00:00:00.000Z',payloadHash:'a'.repeat(64)});
  assert.equal(a.version,'0.2.0');assert.equal(a.dirty,false);assert.match(a.revision,/^[a-f0-9]{40}$/);assert.ok(a.buildId.includes(a.revision.slice(0,8)));
  await writeFile(join(root,'change.txt'),'change');
  const b=await createBuildInfo(root,{target:'standalone-html',builtAt:'2026-11-02T00:00:01.000Z',payloadHash:'b'.repeat(64)});
  assert.equal(b.dirty,true);assert.notEqual(a.buildId,b.buildId);assert.match(b.buildId,/dirty/);
  await writeFile(join(root,'BUILD-MANIFEST.json'),JSON.stringify({appBuild:a}));
  assert.deepEqual(await runtimeBuildInfo(root),a,'a packaged build keeps its captured identity');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('feedback contains only explicit app identity and marks unknown fields honestly',()=>{
 const info={app:'HWP diff',version:'0.2.0',buildId:'test-build',target:'standalone-html',builtAt:'2026-11-02T00:00:00.000Z',revision:'abc123',dirty:false,engine:'Kordoc 4.24.21',documents:{name:'private-document.hwp',text:'private content'}};
 const text=versionFeedback(info);
 assert.match(text,/앱 버전: 0.2.0/);assert.match(text,/빌드 ID: test-build/);assert.match(text,/단일 HTML/);
 assert.ok(!text.includes('private'));assert.match(versionFeedback({}),/확인 불가/);assert.match(versionFeedback({}),/기록 없음/);
});
