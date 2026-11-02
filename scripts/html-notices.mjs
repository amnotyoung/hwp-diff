import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Include complete license texts for packages actually present in the bundle.
export async function htmlNotices(root, builds) {
  const directories = new Set();
  for (const build of builds) for (const input of Object.keys(build.metafile.inputs)) {
    const path = input.replaceAll('\\', '/'), at = path.lastIndexOf('node_modules/');
    if (at < 0) continue;
    const name = path.slice(at + 13).match(/^(?:@[^/]+\/)?[^/]+/)[0];
    directories.add(path.slice(0, at + 13) + name);
  }
  const notices = [await readFile(resolve(root, 'LICENSE'), 'utf8')];
  for (const dir of [...directories].sort()) {
    const full = resolve(root, dir), pkg = JSON.parse(await readFile(resolve(full, 'package.json'), 'utf8'));
    const files = (await readdir(full)).filter(name => /^(?:licen[cs]e|copying|notice)(?:[.\-]|$)/i.test(name));
    notices.push(`\n${pkg.name} ${pkg.version} (${pkg.license ?? 'see license'})`);
    if (!files.length) {
      const readme = (await readdir(full)).find(name => /^readme(?:\.|$)/i.test(name));
      const source = readme ? await readFile(resolve(full, readme), 'utf8') : '';
      const license = source.match(/(?:^|\n)#{1,3}\s*licen[cs]e\b[\s\S]*/i)?.[0];
      if (!license || !/permission|redistribution/i.test(license)) throw new Error(`No license text found for bundled package ${pkg.name}`);
      notices.push(license);
    }
    for (const file of files) notices.push(await readFile(resolve(full, file), 'utf8'));
    if (pkg.name === 'kordoc') for (const file of (await readdir(resolve(full, 'THIRD_PARTY'))).sort()) notices.push(await readFile(resolve(full, 'THIRD_PARTY', file), 'utf8'));
  }
  const text = notices.join('\n\n').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<template id="third-party-notices"><pre>${text}</pre></template>`;
}
