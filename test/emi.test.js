// Run: npm test   (Node 18+, no installs)
const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/data');
const N = require('../src/nlu');
const C = require('../src/compliance');
const A = require('../src/agent');
const CA = require('../src/campaign');
const S = require('../src/scenarios');
const LLM = require('../src/llm');
const lambda = require('../lambda/index');

const NOW = D.istMs(2026, 10, 12, 11, 0); // Thu 12 Nov 2026, 11:00 IST
const B = (id) => D.BORROWERS.find((b) => b.id === id);

async function play(sc, nowMs = NOW) {
  const s = A.createSession(B(sc.borrowerId), { nowMs }); const events = [];
  const ctx = { nowMs, onEvent: (e) => events.push(e) };
  A.start(s, ctx);
  for (const st of sc.steps) { if (s.ended) break; await A.turn(s, { text: st }, ctx); }
  return { s, events };
}

for (const sc of S) {
  test(`scenario: ${sc.title}`, async () => {
    const { s } = await play(sc);
    assert.ok(s.ended, `call did not end (state ${s.state})`);
    assert.strictEqual(s.outcome.disposition, sc.expect);
  });
}

test('privacy: no loan details are spoken before verification', async () => {
  for (const id of ['third-party', 'wrong-number', 'not-verified', 'bereavement', 'callback-9pm']) {
    const { s } = await play(S.find((x) => x.id === id));
    const leaked = s.transcript.filter((t) => t.who === 'bot' && /₹|EMI|ईएमआई/.test(t.text));
    assert.strictEqual(leaked.length, 0, `${id} leaked: ${JSON.stringify(leaked)}`);
  }
});

test('auditor blocks coercive wording even if a script is edited badly', async () => {
  const orig = A.T.askVerify.hi; A.T.askVerify.hi = 'पैसे दो वरना पुलिस आएगी';
  try {
    const { s, events } = await play({ borrowerId: 'B01', steps: ['हाँ'] });
    assert.ok(events.some((e) => e.layer === 'compliance' && /Blocked coercive/.test(e.title)));
    assert.ok(!s.transcript.some((t) => t.text.includes('पुलिस')));
  } finally { A.T.askVerify.hi = orig; }
});

test('understanding: Hindi digits, Hinglish dates, times, languages', () => {
  const ctx = { nowMs: NOW, salaryDay: 5 };
  assert.strictEqual(N.understand('चार तीन दो एक', ctx).entities.digits, '4321');
  assert.strictEqual(N.understand('parso tak kar dunga', ctx).intent, 'promise');
  assert.strictEqual(D.fmtDate(N.understand('parso tak kar dunga', ctx).entities.date, 'en'), '14 Nov');
  assert.strictEqual(D.fmtDate(N.understand('salary aane pe kar dunga', ctx).entities.date, 'en'), '5 Dec');
  assert.deepStrictEqual(N.understand('शाम 6 बजे', ctx).entities.time, { h: 18, min: 0 });
  assert.strictEqual(N.understand('meri naukri chali gayi', ctx).intent, 'hardship');
  assert.strictEqual(N.understand('amount galat hai', ctx).lang, 'hi');
  assert.strictEqual(N.understand('1 2 0 9', ctx).lang, null);
  assert.strictEqual(N.understand('kal 10 baje call karna', ctx).intent, 'callback');
});

test('compliance: calling window, consent, routing', () => {
  const at = (h) => D.istMs(2026, 10, 12, h, 0);
  assert.strictEqual(C.canCall(B('B01'), at(11), {}).ok, true);
  assert.strictEqual(C.canCall(B('B01'), at(7), {}).ok, false);
  assert.strictEqual(C.canCall(B('B01'), at(19), {}).ok, false);
  assert.strictEqual(C.canCall(B('B01'), at(21), { callbackAtMs: at(21), callbackConsent: true }).ok, true);
  assert.strictEqual(C.canCall(B('B06'), at(11), {}).route, 'human');   // Tamil preferred
  assert.strictEqual(C.canCall(B('B13'), at(11), {}).route, 'human');   // DPD 41
  assert.strictEqual(C.canCall(B('B01'), at(11), { attemptsToday: 3 }).ok, false);
  assert.strictEqual(C.callbackAllowed(21, 0, false).ok, false);
  assert.strictEqual(C.callbackAllowed(21, 0, true).consentNeeded, true);
});

test('campaign: plan, results feed back into the next plan', async () => {
  const crm = {};
  let plan = CA.plan(NOW, crm);
  assert.ok(plan[0].decision.ok, 'first row should be callable');
  assert.strictEqual(plan.filter((r) => r.decision.route === 'human').length, 2);
  const { s } = await play(S.find((x) => x.id === 'ptp-salary'));
  CA.applyResult(crm, B('B03'), { network: 'answered', outcome: s.outcome }, NOW);
  plan = CA.plan(D.addDays(NOW, 1), { B03: Object.assign({}, crm.B03, { attemptsToday: 0, conversationsToday: 0 }) });
  assert.match(plan.find((r) => r.b.id === 'B03').decision.reason, /Promise-to-pay active/);
  const late = CA.plan(D.istMs(2026, 10, 12, 20, 0), {});
  assert.ok(late.every((r) => !r.decision.ok), 'nobody is callable at 8 pm');
  const k = CA.kpis([{ network: 'answered', outcome: s.outcome }, { network: 'no_answer' }]);
  assert.strictEqual(k.connectRate, 50); assert.strictEqual(k.ptp, 1);
  assert.ok(CA.roi({}).saving > 0);
});

test('LLM: only valid JSON is accepted; invalid falls back', () => {
  const ctx = { nowMs: NOW };
  const v = LLM.validate(LLM.parseModelText('```json\n{"intent":"promise","confidence":0.9,"lang":"hi","entities":{"date":"2026-11-14","time":null}}\n```'), ctx);
  assert.strictEqual(v.intent, 'promise'); assert.strictEqual(D.fmtDate(v.entities.date, 'en'), '14 Nov');
  assert.strictEqual(LLM.validate({ intent: 'make_threat' }, ctx), null);
  assert.strictEqual(LLM.parseModelText('sorry I cannot'), null);
  assert.ok(LLM.buildPrompt('kal kar dunga', { nowMs: NOW, salaryDay: 5 }).system.includes('2026-11-12'));
});

test('agent uses the LLM result when provided, and falls back when it fails', async () => {
  const s = A.createSession(B('B01'), { nowMs: NOW }); A.start(s, { nowMs: NOW });
  const events = [];
  await A.turn(s, { text: 'हाँ' }, { nowMs: NOW, onEvent: (e) => events.push(e), understand: async () => { throw new Error('timeout'); } });
  assert.strictEqual(s.state, 'verify');
  assert.ok(events.some((e) => /LLM unavailable/.test(e.title)));
});

test('lambda (Amazon Lex / Connect): opening, turns, close with disposition', async () => {
  let attrs = { borrowerId: 'B01' }; let r;
  r = await lambda.handler({ sessionState: { sessionAttributes: attrs } });
  assert.strictEqual(r.sessionState.dialogAction.type, 'ElicitIntent'); assert.match(r.messages[0].content, /सहायक फाइनेंस/);
  for (const t of ['हाँ, बोल रहा हूँ', 'चार तीन दो एक', 'हाँ, लिंक भेज दो', 'हो गया']) { attrs = r.sessionState.sessionAttributes; r = await lambda.handler({ inputTranscript: t, sessionState: { sessionAttributes: attrs } }); }
  assert.strictEqual(r.sessionState.dialogAction.type, 'Close');
  assert.strictEqual(r.sessionState.intent.name, 'CallComplete');
  assert.strictEqual(r.sessionState.sessionAttributes.emi_disposition, 'PAID');
});

test('server: Conversation API and LLM endpoint behave', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { server } = require('../server');
  await new Promise((ok) => server.listen(0, ok)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json().then((j) => ({ status: r.status, j })));
    const start = await post('/api/sessions', { borrowerId: 'B02', nowMs: NOW });
    assert.strictEqual(start.status, 200); assert.match(start.j.says[0], /Sahayak Finance/);
    let t = await post(`/api/sessions/${start.j.id}/turn`, { text: 'Yes, speaking', nowMs: NOW });
    t = await post(`/api/sessions/${start.j.id}/turn`, { text: '7 7 8 8', nowMs: NOW });
    t = await post(`/api/sessions/${start.j.id}/turn`, { text: "I'll pay tomorrow for sure", nowMs: NOW });
    assert.strictEqual(t.j.outcome.disposition, 'PTP');
    const plan = await fetch(`${base}/api/plan?nowMs=${NOW}`).then((r) => r.json());
    assert.strictEqual(plan.length, D.BORROWERS.length);
    const u = await post('/api/understand', { text: 'kal', ctx: {} });
    assert.strictEqual(u.status, 503);
    const html = await fetch(base + '/simulator/').then((r) => r.status);
    assert.strictEqual(html, 200);
  } finally { server.close(); }
});
