// Сравнение трасс Luau-порта с эталоном веб-версии
import fs from 'node:fs';
const ref = JSON.parse(fs.readFileSync(new URL('./ref_trace.json', import.meta.url)));
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
let bad = 0;
for (const line of lines) {
  const [id, launch, rowsS] = line.split('|');
  const rows = rowsS.split(';').map((r) => r.split(',').map(Number));
  const R = ref[id];
  let maxPos = 0, maxSpd = 0, firstDiv = null;
  rows.forEach((r, i) => {
    const e = R.rows[i];
    const dp = Math.hypot(r[1] - e[1], r[2] - e[2], r[3] - e[3]);
    const ds = Math.abs(r[5] - e[5]);
    maxPos = Math.max(maxPos, dp);
    maxSpd = Math.max(maxSpd, ds);
    if (firstDiv === null && (dp > 0.05 || ds > 0.05)) firstDiv = r[0];
  });
  const ok = launch === R.launch && maxPos < 0.5;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${id}: launch ${launch}/${R.launch} maxPosDiff ${maxPos.toFixed(4)} m maxSpeedDiff ${maxSpd.toFixed(4)} firstDiv ${firstDiv}`);
}
process.exit(bad ? 1 : 0);
