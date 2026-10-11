const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const scripts = ['affiliate.js','account-pages.js','production-api.js','local-demo-auth.js','admin-production.js','block-cash/game.js'];
let count = 0;
for (const file of scripts) {
  new vm.Script(fs.readFileSync(path.join(root,file),'utf8'), {filename:file});
  count++;
}
for (const file of ['index.htm','deposit-v2.html','panel.html','admin.html']) {
  const html = fs.readFileSync(path.join(root,file),'utf8');
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|application\/(?:ld\+)?json|type\s*=\s*["']module/.test(match[1]) || !match[2].trim()) continue;
    new vm.Script(match[2], {filename:file});
    count++;
  }
}
console.log(`${count} browser scripts: syntax OK (not an end-to-end test).`);
