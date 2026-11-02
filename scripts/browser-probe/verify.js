async page => {
  const cases = /*CASES*/[];
  const requests = [];
  const context = page.context();
  await context.setOffline(true);
  context.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  await context.route(/^https?:/, route => route.abort());
  const results = [];
  for (const c of cases) {
    await page.getByRole('button', {name:'구버전',exact:true}).setInputFiles(c.paths[0]);
    await page.getByRole('button', {name:'신버전',exact:true}).setInputFiles(c.paths[1]);
    await page.getByRole('button', {name:'비교 실행',exact:true}).click();
    await page.waitForFunction(() => window.probe.done || window.probe.error, {}, {timeout:65000});
    const actual = await page.evaluate(async () => {
      const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
      const p=window.probe;
      if(p.error)return {error:p.error};
      const r=structuredClone(p.result);delete r.createdAt;
      const previews=[];for(const side of ['before','after']){const v=p.previews[side];previews.push(v.previewError?{error:v.previewError}:{imageSha256:await digest(v.preview.image),pages:v.preview.totalPages,format:v.preview.format});}
      return {hash:await digest(JSON.stringify(r)),stats:r.stats,formats:Object.values(r.documents).map(d=>d.format),formatAvailable:r.formatting.available,memoAvailable:r.annotations.available,previews};
    });
    results.push({id:c.id,pass:JSON.stringify(actual)===JSON.stringify(c.expected),actual,expected:c.expected});
  }
  return {url:page.url(),browser:await page.evaluate(()=>navigator.userAgent),httpRequests:requests,results};
}
