// Запуск Luau-модулей вне Роблокса: node tests/run.mjs <test.lua>. require(script.Parent.X) ищет X.lua
// в src/shared (и подпапках), глобалы Роблокса — заглушки из tests/mock.lua.
import { LuauState } from '/tmp/claude-0/luautest/node_modules/luau-web/src/index.js';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const find = (name) => {
  for (const d of ['src/shared', 'src/shared/TrackData', 'src/server', 'src/client', 'tests']) {
    const f = path.join(ROOT, d, name + '.lua');
    if (fs.existsSync(f)) return f;
  }
  throw new Error('module not found: ' + name);
};
const out = [];
let L;
L = await LuauState.createAsync({
  __load: (name) => L.loadstring(`local script = __mkScript("${name}")\n` + fs.readFileSync(find(name), 'utf8'), name, true),
  __out: (s) => out.push(String(s)),
  print: (...a) => console.log(...a),
});
const boot = `
${fs.readFileSync(path.join(ROOT, 'tests/mock.lua'), 'utf8')}
local cache = {}
local function mkScript(name)
  local parent
  local function node(n) return setmetatable({ __module = n }, { __index = function(_, k) if k == "WaitForChild" then return function(_, c) return node(c) end end return node(k) end }) end
  parent = setmetatable({}, { __index = function(_, k) if k == "Parent" then return parent end if k == "WaitForChild" then return function(_, c) return node(c) end end return node(k) end })
  return { __module = name, Parent = parent }
end
__mkScript = mkScript
function require(m)
  local name = type(m) == "table" and (rawget(m, "__module") or m.__module or m.Name) or m
  if cache[name] then return cache[name] end
  local v = __load(name)()
  cache[name] = v
  return v
end
`;
const test = process.argv[2];
const src = fs.readFileSync(test, 'utf8');
const f = L.loadstring(boot + '\n' + src, path.basename(test), true);
try {
  await f();
} catch (e) {
  console.error('LUAU ERROR:', e.message || e);
  process.exit(1);
}
if (process.argv[3]) fs.writeFileSync(process.argv[3], out.join('\n'));
