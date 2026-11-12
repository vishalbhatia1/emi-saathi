// Terminal demo: plays every scenario (or one: npm run demo -- hardship) and prints each step.
const D = require('../src/data'); const A = require('../src/agent'); const S = require('../src/scenarios');
const COL = { compliance: 33, understand: 35, agent: 36, tool: 34, whatsapp: 32, crm: 90, handoff: 31, result: 1, telecom: 90 };
const c = (l, t) => (process.stdout.isTTY ? `\x1b[${COL[l] || 0}m${t}\x1b[0m` : t);
(async () => {
  const only = process.argv[2]; const now = Date.now();
  const p = D.ist(now); const nowMs = (p.h >= 8 && p.h < 19) ? now : D.istMs(p.y, p.m, p.d, 11, 0);
  for (const sc of S.filter((x) => !only || x.id === only)) {
    const b = D.BORROWERS.find((x) => x.id === sc.borrowerId); const s = A.createSession(b, { nowMs });
    console.log('\n' + '='.repeat(80) + `\n${sc.title}  [${sc.lang}]\n${sc.story}\n` + '='.repeat(80));
    const show = (r) => r.events.forEach((e) => console.log(e.layer === 'say' ? `   SAATHI ▸ ${e.title}` + (e.tech ? `\n            ${e.tech}` : '') : c(e.layer, `   [${e.layer}] ${e.title}`)));
    show(A.start(s, { nowMs }));
    for (const st of sc.steps) { if (s.ended) break; console.log(`\n   ${b.name.split(' ')[0].toUpperCase()} ▸ ${st}`); show(await A.turn(s, { text: st }, { nowMs })); }
  }
})();
