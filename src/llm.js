/**
 * llm.js — OPTIONAL: use a large language model to UNDERSTAND the borrower (never to speak to them).
 *
 * Why this pattern: in regulated collections, every sentence the borrower hears must be pre-approved
 * and audited. So the LLM only classifies (intent + entities as strict JSON). The agent still picks
 * the approved, audited reply. If the LLM is slow, down, or returns anything invalid, we fall back
 * to the built-in rules (src/nlu.js). This mirrors "LLM-assisted NLU" designs used by Amazon Lex.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data'));
  else { root.EMI = root.EMI || {}; root.EMI.llm = factory(root.EMI.data); }
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  const INTENTS = ['affirm', 'deny', 'digits', 'promise', 'pay_now', 'payment_done', 'already_paid', 'hardship', 'dispute', 'bereavement', 'callback', 'not_available',
    'wrong_number', 'agent', 'abusive', 'stop_calls', 'switch_hi', 'switch_en', 'ask_amount', 'specialist', 'unknown'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function buildPrompt(text, ctx) {
    const p = D.ist(ctx.nowMs || Date.now());
    const today = `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    const system = [
      'You classify ONE utterance from an Indian loan borrower on an EMI reminder call. It may be Hindi (Devanagari), Hinglish (Roman Hindi) or English, often mixed.',
      'Reply with ONLY a JSON object, no prose, no markdown:',
      '{"intent": one of ' + JSON.stringify(INTENTS) + ', "confidence": 0..1, "lang": "hi"|"en"|null, "sentiment": -1..0.5,',
      ' "entities": {"digits": string|null, "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null, "amount": number|null, "utr": 12-digit string|null}}',
      `Today is ${today} (${DAYS[p.dow]}), timezone IST. Resolve kal/tomorrow, parso, weekdays, "5 tarikh", "salary aane pe" (salary day = ${ctx.salaryDay || 'unknown'}) to a date.`,
      '"lang" is "hi" for Hindi or Hinglish, "en" for English, null if only digits. Times like "shaam 6 baje" are 18:00.',
      'Use "promise" when they commit to pay later; "already_paid" when they say they paid before this call; "payment_done" when they just finished paying during the call.',
      `The bot's current step is "${ctx.state || 'unknown'}" (rpc = asked if this is the borrower; verify = asked for the last 4 digits of the loan account).`,
    ].join('\n');
    return { system, user: text };
  }

  /** Validate and normalise the model's JSON into the same shape nlu.understand() returns. */
  function validate(obj, ctx) {
    if (!obj || typeof obj !== 'object' || !INTENTS.includes(obj.intent)) return null;
    const e = obj.entities || {}; const out = {};
    if (typeof e.digits === 'string' && /^\d{1,12}$/.test(e.digits)) out.digits = e.digits;
    if (typeof e.utr === 'string' && /^\d{12}$/.test(e.utr)) out.utr = e.utr;
    if (typeof e.amount === 'number' && e.amount > 0 && e.amount < 1e7) out.amount = e.amount;
    if (typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
      const [y, m, d] = e.date.split('-').map(Number); const ms = D.istMs(y, m - 1, d);
      const diff = D.daysBetween(ctx.nowMs || Date.now(), ms); if (diff >= -60 && diff <= 120) out.date = ms;
    }
    if (typeof e.time === 'string' && /^\d{2}:\d{2}$/.test(e.time)) { const [h, min] = e.time.split(':').map(Number); if (h < 24 && min < 60) out.time = { h, min }; }
    const conf = Math.max(0, Math.min(1, Number(obj.confidence) || 0.5));
    return { intent: obj.intent, confidence: conf, lang: obj.lang === 'hi' || obj.lang === 'en' ? obj.lang : null, entities: out,
      sentiment: Math.max(-1, Math.min(0.5, Number(obj.sentiment) || 0)), yes: obj.intent === 'affirm', no: obj.intent === 'deny' };
  }

  function parseModelText(t) {
    const s = String(t || '').replace(/```json|```/g, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b < a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (err) { return null; }
  }

  /** Browser helper: calls the POC server's /api/understand; returns null on any failure (agent falls back). */
  function remoteUnderstand(endpoint) {
    return async (text, ctx) => {
      const r = await fetch(endpoint || '/api/understand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ctx }) });
      if (!r.ok) throw new Error('LLM endpoint ' + r.status);
      const j = await r.json(); const v = validate(j.result, ctx);
      if (!v) throw new Error('LLM returned invalid JSON');
      v._source = 'LLM'; v._model = j.model || ''; v.text = text; return v;
    };
  }

  return { INTENTS, buildPrompt, validate, parseModelText, remoteUnderstand };
});
