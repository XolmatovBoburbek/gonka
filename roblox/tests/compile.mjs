// Проверка синтаксиса всех .lua: компиляция в luau-web без запуска.
import { LuauState } from '/tmp/claude-0/luautest/node_modules/luau-web/src/index.js';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.lua')) files.push(p); } };
walk(path.join(ROOT, 'src'));
const L = await LuauState.createAsync({});
let bad = 0;
for (const f of files) {
  try { L.loadstring(fs.readFileSync(f, 'utf8'), path.basename(f), true); }
  catch (e) { bad++; console.log('FAIL', path.relative(ROOT, f), String(e.message || e).slice(0, 300)); }
}
console.log(`${files.length - bad}/${files.length} files compile`);
process.exit(bad ? 1 : 0);
