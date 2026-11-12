/**
 * agent.js — EMI Saathi, the conversation agent.
 *
 * Call shape (what a good human collector does, encoded):
 *   opening (AI + recording disclosure)  ->  right person?  ->  verify (last 4 of loan a/c)
 *   ->  share dues  ->  pay now (UPI link on WhatsApp) | promise-to-pay date | already paid (UTR check)
 *       | hardship (empathy + options) | dispute (ticket) | callback | hand over to a person
 *
 * Safety rails built in: no loan details before verification, every sentence audited for coercive
 * language, borrower's own language (Hindi/English, switches mid-call), calls outside 8 am–7 pm only
 * at the borrower's request, gentle exits for wrong numbers, third parties and bereavement.
 *
 *   const s = agent.createSession(borrower, { nowMs });
 *   agent.start(s, ctx)          -> { says, events }
 *   await agent.turn(s, input, ctx) -> { says, events, ended, outcome }
 *   input = { text } | { silence: true } | { hangup: true }
 *   ctx   = { nowMs, onEvent(ev), understand: async (text, ctx) => nluResult, paymentGateway: (s) => ({ received, utr }) }
 *
 * The session is plain JSON, so it can live in Lex session attributes, Redis, or memory.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data'), require('./nlu'), require('./compliance'));
  else { root.EMI = root.EMI || {}; root.EMI.agent = factory(root.EMI.data, root.EMI.nlu, root.EMI.compliance); }
})(typeof self !== 'undefined' ? self : this, function (D, NLU, C) {
  'use strict';
  const L = D.LENDER;

  // pii: true = mentions loan details; only allowed after verification.
  const T = {
    opening: { hi: 'नमस्ते, मैं {lenderHi} की AI सहायक {bot} बोल रही हूँ। यह कॉल रिकॉर्ड की जा रही है। क्या मेरी बात {nameHi} जी से हो रही है?', en: 'Hello, this is {bot}, an AI assistant from {lender}. This call is being recorded. Am I speaking with {name}?' },
    askVerify: { hi: 'धन्यवाद। आपकी पहचान के लिए, कृपया अपने लोन अकाउंट नंबर के आखिरी चार अंक बताइए।', en: 'Thank you. To verify it is you, please tell me the last four digits of your loan account number.' },
    verifyRetry: { hi: 'माफ़ कीजिए, यह मेल नहीं खाया। कृपया आखिरी चार अंक एक बार फिर बताइए।', en: "Sorry, that didn't match. Please tell me the last four digits once more." },
    verifyFail: { hi: 'माफ़ कीजिए, मैं पहचान की पुष्टि नहीं कर पाई। आपकी सुरक्षा के लिए हम SMS से हेल्पलाइन नंबर भेज रहे हैं। धन्यवाद।', en: "Sorry, I couldn't verify your identity. For your security, we'll send our helpline number by SMS. Thank you." },
    duePre: { pii: true, hi: 'धन्यवाद {nameHi} जी। आपके {product} की {amount} की EMI {date} को देय है। क्या आप आज ही भुगतान करना चाहेंगे? मैं आपको UPI लिंक भेज सकती हूँ।', en: 'Thank you, {name}. Your {product} EMI of {amount} is due on {date}. Would you like to pay today? I can send you a UPI link.' },
    dueToday: { pii: true, hi: 'धन्यवाद {nameHi} जी। आपके {product} की {amount} की EMI आज देय है। क्या आप आज भुगतान कर पाएंगे? मैं आपको UPI लिंक भेज सकती हूँ।', en: 'Thank you, {name}. Your {product} EMI of {amount} is due today. Could you pay today? I can send you a UPI link.' },
    dueOver: { pii: true, hi: 'धन्यवाद {nameHi} जी। आपकी {amount} की EMI {dpd} दिन से बकाया है। क्या आप आज भुगतान कर पाएंगे? मैं आपको UPI लिंक भेज सकती हूँ।', en: 'Thank you, {name}. Your EMI of {amount} has been pending for {dpd} days. Could you pay today? I can send you a UPI link.' },
    linkSent: { pii: true, hi: 'मैंने {amount} का UPI भुगतान लिंक आपके WhatsApp पर भेज दिया है। चाहें तो लाइन पर रहते हुए भुगतान कर लीजिए, मैं इंतज़ार करती हूँ।', en: "I've sent a UPI payment link for {amount} to your WhatsApp. You can pay while we're on the line; I'll wait." },
    paymentReceived: { hi: 'भुगतान मिल गया है, धन्यवाद! रसीद WhatsApp पर भेज दी गई है। आपका दिन शुभ हो।', en: 'Payment received, thank you! The receipt is on your WhatsApp. Have a good day.' },
    paymentNotYet: { hi: 'अभी भुगतान दिखाई नहीं दे रहा। कोई बात नहीं, लिंक 24 घंटे चालू रहेगा। आप किस तारीख तक भुगतान कर पाएंगे?', en: "I can't see the payment yet. No problem, the link stays active for 24 hours. By which date will you be able to pay?" },
    askDate: { hi: 'ठीक है। आप किस तारीख तक भुगतान कर पाएंगे?', en: 'Alright. By which date will you be able to pay?' },
    ptpConfirm: { pii: true, hi: 'ठीक है, {date} तक {amount}। मैं एक दिन पहले WhatsApp पर याद दिला दूंगी। धन्यवाद, आपका दिन शुभ हो।', en: "Noted: {amount} by {date}. I'll send a WhatsApp reminder the day before. Thank you, have a good day." },
    ptpTooFar: { hi: 'मैं समझती हूँ। हमारी नीति के अनुसार मैं {maxDate} तक की तारीख ले सकती हूँ। क्या आप {maxDate} तक भुगतान कर पाएंगे? या मैं आपको हमारे विशेषज्ञ से जोड़ दूँ?', en: 'I understand. As per our policy I can note a date up to {maxDate}. Could you pay by {maxDate}? Or shall I connect you to a specialist?' },
    askReason: { hi: 'कोई बात नहीं। क्या कोई परेशानी है? बताइए, हम मदद करने की कोशिश करेंगे।', en: "That's okay. Is something making it difficult? Tell me and we'll try to help." },
    hardship: { hi: 'मुझे यह सुनकर दुख हुआ। आप पर कोई दबाव नहीं है। आपके लिए दो विकल्प हैं: कुछ दिन बाद की तारीख, या हमारे विशेषज्ञ से EMI में राहत (रीस्ट्रक्चरिंग) की बात। आप क्या चाहेंगे?', en: "I'm sorry to hear that. There's no pressure on you. You have two options: a date a few days later, or a conversation with our specialist about EMI relief (restructuring). What would you prefer?" },
    askUtr: { hi: 'धन्यवाद। कृपया भुगतान का UTR नंबर बताइए, जो 12 अंकों का होता है।', en: "Thank you. Please tell me the payment's UTR number; it has 12 digits." },
    paidVerified: { pii: true, hi: 'जी हाँ, आपका {amount} का भुगतान {date} को मिल गया है। असुविधा के लिए खेद है, आपका खाता अपडेट कर दिया है। धन्यवाद!', en: 'Yes, your payment of {amount} received on {date} is confirmed. Sorry for the trouble; your account is updated. Thank you!' },
    paidClaim: { hi: 'धन्यवाद। मैंने आपका दावा दर्ज कर लिया है; हमारी टीम 48 घंटे में जांच करेगी और तब तक कोई कॉल नहीं आएगी। चाहें तो रसीद WhatsApp पर भेज दीजिए।', en: "Thank you. I've logged your payment claim; our team will verify within 48 hours and you won't be called meanwhile. You can share the receipt on WhatsApp." },
    dispute: { hi: 'मैंने आपकी शिकायत दर्ज कर ली है। हमारी टीम 48 घंटे में आपसे संपर्क करेगी, तब तक इस EMI के लिए कॉल नहीं आएगी। शिकायत अधिकारी का विवरण SMS से भेज रही हूँ।', en: "I've registered your dispute. Our team will contact you within 48 hours, and you won't get calls about this EMI until then. I'm sending the grievance officer's details by SMS." },
    thirdPartyAsk: { hi: 'कोई बात नहीं। वे किस समय उपलब्ध होंगे?', en: 'No problem. When would be a good time to reach them?' },
    thirdPartyCallback: { hi: 'धन्यवाद, हम {time} दोबारा कॉल करेंगे। आपका दिन शुभ हो।', en: "Thank you, we'll call back at {time}. Have a good day." },
    thirdPartyEnd: { hi: 'धन्यवाद, हम बाद में संपर्क करेंगे। आपका दिन शुभ हो।', en: "Thank you, we'll try again later. Have a good day." },
    wrongNumber: { hi: 'असुविधा के लिए माफ़ी चाहती हूँ, हम यह नंबर अपडेट कर देंगे। धन्यवाद।', en: "Sorry for the trouble; we'll update this number. Thank you." },
    bereavement: { hi: 'यह सुनकर बहुत दुख हुआ। हमारी संवेदनाएँ। हम अभी कोई बात नहीं करेंगे; हमारी एक विशेष टीम बाद में आपसे सम्मानपूर्वक संपर्क करेगी। धन्यवाद।', en: "I'm very sorry for your loss. Our condolences. We won't discuss anything now; a dedicated team will contact you respectfully later. Thank you." },
    callbackOk: { hi: 'ज़रूर, मैं {time} कॉल करूँगी। धन्यवाद।', en: "Sure, I'll call you at {time}. Thank you." },
    callbackConsent: { hi: 'ठीक है, आपके कहने पर हम {time} कॉल करेंगे; यह अनुरोध रिकॉर्ड कर लिया है। धन्यवाद।', en: "Okay, since you've asked, we'll call at {time}; I've recorded your request. Thank you." },
    callbackAskTime: { hi: 'ज़रूर। आपके लिए किस समय कॉल करना ठीक रहेगा?', en: 'Of course. What time would suit you for a call back?' },
    agentTransfer: { hi: 'ठीक है, मैं आपको हमारे प्रतिनिधि से जोड़ रही हूँ। मैंने आपकी बात उन्हें बता दी है, आपको दोहराना नहीं पड़ेगा।', en: "Sure, I'm connecting you to a colleague now. I've passed on our conversation, so you won't need to repeat yourself." },
    specialistTransfer: { hi: 'ठीक है, मैं आपको हमारे विशेषज्ञ से जोड़ रही हूँ जो EMI राहत के विकल्प समझाएंगे। आपकी बात उन्हें बता दी है।', en: "Sure, I'm connecting you to our specialist who can explain EMI relief options. I've shared what you told me." },
    abusiveOnce: { hi: 'मैं समझ सकती हूँ कि आप परेशान हैं। मैं बस आपकी मदद करना चाहती हूँ। क्या मैं आपको किसी प्रतिनिधि से जोड़ दूँ?', en: 'I understand you are upset. I only want to help. Shall I connect you to a colleague?' },
    stopCalls: { hi: 'मैंने आपकी पसंद दर्ज कर ली है। हमारी टीम संपर्क का तरीका तय करने के लिए आपसे WhatsApp या SMS पर बात करेगी। धन्यवाद।', en: "I've noted your preference. Our team will reach out on WhatsApp or SMS to agree how to contact you. Thank you." },
    switched: { hi: 'ज़रूर, अब मैं हिंदी में बात करती हूँ।', en: 'Sure, I will continue in English.' },
    notUnderstood: { hi: 'माफ़ कीजिए, मैं समझ नहीं पाई। क्या आप दोबारा बता सकते हैं?', en: "Sorry, I didn't catch that. Could you say it again?" },
    notUnderstoodEnd: { hi: 'माफ़ कीजिए, मैं ठीक से समझ नहीं पा रही। मैं आपको हमारे प्रतिनिधि से जोड़ रही हूँ।', en: "Sorry, I'm having trouble understanding. Let me connect you to a colleague." },
    silence: { hi: 'क्या आप लाइन पर हैं?', en: 'Are you still there?' },
    silenceEnd: { hi: 'लगता है आवाज़ नहीं आ रही। हम बाद में कॉल करेंगे। धन्यवाद।', en: "It seems we can't hear you. We'll call back later. Thank you." },
  };
  const EN_GLOSS = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, v.en]));

  function createSession(b, opts) {
    const o = opts || {};
    const nowMs = o.nowMs || Date.now();
    return {
      id: o.id || 'call-' + Math.random().toString(36).slice(2, 8), borrowerId: b.id, lang: b.lang === 'en' ? 'en' : 'hi',
      state: 'new', verified: false, verifyTries: 0, notUnderstood: 0, silences: 0, abusive: 0, ptpNegotiated: false, turns: 0,
      startedAtMs: nowMs, ended: false, outcome: null, link: null, tickets: [], whatsapp: [], transcript: [], flags: {}, notes: [],
    };
  }
  const borrowerOf = (s) => D.BORROWERS.find((x) => x.id === s.borrowerId);

  function vars(s, extra) {
    const b = borrowerOf(s); const nowMs = s.nowMs || s.startedAtMs; const st = D.loanStatus(b, nowMs);
    return Object.assign({ lender: L.name, lenderHi: L.nameHi, bot: L.botName, name: b.name, nameHi: b.nameHi, product: b.product,
      amount: D.rupees(b.emi), date: (lg) => D.fmtDate(st.dueMs, lg), dpd: st.dpd }, extra || {});
  }
  // Values may be functions of the language, so the same fact renders correctly in Hindi and in the English gloss.
  const fill = (tpl, v, lang) => tpl.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? `{${k}}` : typeof v[k] === 'function' ? v[k](lang) : v[k]));

  function out(ctx) {
    const events = [], says = [];
    const ev = (layer, title, tech) => { const e = { layer, title, tech: tech || '' }; events.push(e); if (ctx && ctx.onEvent) ctx.onEvent(e); };
    return { events, says, ev };
  }

  /** Say a template in the session language, enforcing the disclosure guard and the language audit. */
  function say(s, o, key, extra) {
    const t = T[key];
    if (t.pii && !s.verified) { o.ev('compliance', 'Blocked: loan details before identity verification', `template=${key}`); key = 'notUnderstood'; }
    let text = fill(T[key][s.lang], vars(s, extra), s.lang);
    const audit = C.auditUtterance(text);
    if (!audit.ok) { o.ev('compliance', `Blocked coercive wording (${audit.hits.join(', ')})`, 'output auditor'); text = fill(T.notUnderstood[s.lang], vars(s), s.lang); }
    o.says.push(text); s.transcript.push({ who: 'bot', text });
    const e = { layer: 'say', title: text, tech: s.lang === 'hi' ? 'EN: ' + fill(EN_GLOSS[key], vars(Object.assign({}, s, { lang: 'en' }), extra), 'en') : '' };
    o.events.push(e); if (o.ctx && o.ctx.onEvent) o.ctx.onEvent(e);
  }

  function start(s, ctx) {
    const o = out(ctx); o.ctx = ctx; s.nowMs = (ctx && ctx.nowMs) || s.startedAtMs;
    const b = borrowerOf(s);
    o.ev('compliance', 'Opening: AI disclosure, recording notice, lender identity', `CLI ${L.callerId} · recording kept ${L.policy.recordingRetentionDays} days`);
    s.state = 'rpc';
    say(s, o, 'opening');
    o.ev('agent', `Right-party check: is this ${b.name}? No loan details until verified`, 'state=rpc');
    return { says: o.says, events: o.events, ended: false };
  }

  // ---------------- endings ----------------
  function end(s, o, disposition, extra) {
    s.ended = true; s.state = 'ended';
    s.outcome = Object.assign({ disposition, lang: s.lang, verified: s.verified, turns: s.turns }, extra || {});
    s.outcome.summary = summary(s);
    o.ev('crm', `LMS/CRM updated: ${disposition.replace(/_/g, ' ')}`, JSON.stringify(Object.assign({}, s.outcome, { summary: undefined })));
    o.ev('result', `Call result: ${disposition.replace(/_/g, ' ')}`, '');
    return { says: o.says, events: o.events, ended: true, outcome: s.outcome };
  }
  function handoff(s, o, disposition, queue, keySay, planned) {
    say(s, o, keySay);
    o.ev('handoff', `Warm transfer to "${queue}" with a summary (${planned ? 'by design' : 'bot needed help'})`, 'agent desktop screen pop');
    return end(s, o, disposition, { queue, planned });
  }
  function whatsapp(s, o, kind, text) { s.whatsapp.push({ kind, text }); o.ev('whatsapp', `WhatsApp to borrower: ${kind}`, text); }
  function ticket(s, o, type, detail) { const id = 'TKT-' + (1000 + Math.floor(Math.random() * 9000)); s.tickets.push({ id, type, detail }); o.ev('tool', `Ticket ${id} created: ${type}`, detail); return id; }

  function summary(s) {
    const b = borrowerOf(s); const st = D.loanStatus(b, s.nowMs || s.startedAtMs); const o = s.outcome || {};
    const lastCaller = s.transcript.filter((t) => t.who === 'caller').slice(-2).map((t) => `"${t.text}"`).join(' / ');
    const parts = [`${b.name} (${b.id}, ${b.city}) · ${b.product} · EMI ${D.rupees(b.emi)} · ${st.bucket}${st.dpd ? ' DPD ' + st.dpd : ''}.`,
      s.verified ? 'Identity verified (last 4 of loan a/c).' : 'NOT verified: no loan details were shared.',
      `Language: ${s.lang === 'hi' ? 'Hindi' : 'English'}.`];
    const why = { PAID: 'Paid on the call via UPI.', PTP: `Promise-to-pay by ${o.ptpDateMs ? D.fmtDate(o.ptpDateMs, 'en') : '?'}.`, HARDSHIP: 'Reported hardship: wants EMI relief options. Be gentle; no pressure.',
      DISPUTE: 'Disputes the amount/loan: investigate before any collection contact.', DECEASED: 'Family member reported the borrower has passed away. Handle with care.',
      AGENT: 'Asked for a person.', PTP_ESCALATED: 'Could not commit within policy dates: discuss a plan.', NOT_VERIFIED: 'Failed verification twice.',
      CHANNEL_PREFERENCE: 'Asked not to be called: agree a contact channel.', ALREADY_PAID_VERIFIED: 'Payment found in ledger.', PAYMENT_CLAIM: 'Says already paid; UTR not found yet.' };
    if (why[o.disposition]) parts.push(why[o.disposition]);
    if (lastCaller) parts.push('Borrower said: ' + lastCaller);
    return parts.join(' ');
  }

  // ---------------- one turn ----------------
  async function turn(s, input, ctx) {
    const o = out(ctx); o.ctx = ctx;
    if (s.ended) return { says: [], events: [], ended: true, outcome: s.outcome };
    s.nowMs = (ctx && ctx.nowMs) || s.nowMs || Date.now(); s.turns += 1;
    const b = borrowerOf(s);

    if (input.hangup) { o.ev('telecom', 'Borrower hung up', 'SIP BYE'); return end(s, o, s.verified ? 'HUNG_UP_AFTER_VERIFY' : 'HUNG_UP'); }
    if (input.silence) {
      s.silences += 1; o.ev('understand', `Silence (${s.silences}/2)`, 'no speech for 6 s');
      if (s.silences >= 2) { say(s, o, 'silenceEnd'); return end(s, o, 'NO_RESPONSE', { retry: true }); }
      say(s, o, 'silence'); return { says: o.says, events: o.events, ended: false };
    }
    s.silences = 0;
    const text = String(input.text || '');
    s.transcript.push({ who: 'caller', text });
    const nctx = { nowMs: s.nowMs, salaryDay: b.salaryDay, lang: s.lang, state: s.state };
    let u = null;
    if (ctx && ctx.understand) { try { u = await ctx.understand(text, nctx); if (u && u._source) o.ev('understand', `LLM understanding (${u._source})`, u._model || ''); } catch (e) { o.ev('understand', 'LLM unavailable, using built-in rules', String(e.message || e)); } }
    if (!u) u = NLU.understand(text, nctx);
    const e = u.entities || {};
    o.ev('understand', describe(u), `intent=${u.intent} conf=${u.confidence} lang=${u.lang} sentiment=${u.sentiment}`);

    // Follow the borrower's language (code-switching) unless they explicitly asked for one.
    if (u.intent === 'switch_hi' || u.intent === 'switch_en') {
      s.lang = u.intent === 'switch_hi' ? 'hi' : 'en'; s.langLocked = true; o.ev('agent', `Language switched to ${s.lang === 'hi' ? 'Hindi' : 'English'} on request`, '');
      say(s, o, 'switched'); return resay(s, o);
    }
    if (u.lang && u.lang !== s.lang && !s.langLocked) { s.lang = u.lang; o.ev('agent', `Borrower is speaking ${u.lang === 'hi' ? 'Hindi/Hinglish' : 'English'}: replying in the same language`, 'code-switch'); }

    // ---- global safety exits (any state) ----
    if (u.intent === 'bereavement') { say(s, o, 'bereavement'); o.ev('compliance', 'Bereavement: stop the conversation, flag account, no automated calls', 'sensitive'); s.flags.deceased = true; return end(s, o, 'DECEASED', { queue: 'Deceased & Sensitive Cases', planned: true }); }
    if (u.intent === 'abusive') { s.abusive += 1; if (s.abusive >= 2) return handoff(s, o, 'AGENT', 'Collections Support', 'agentTransfer', false); say(s, o, 'abusiveOnce'); s.offeredAgent = true; return { says: o.says, events: o.events, ended: false }; }
    if ((u.intent === 'agent' || u.intent === 'specialist') && s.state === 'hardship_options') return handoff(s, o, 'HARDSHIP', 'Hardship & Restructuring', 'specialistTransfer', true);
    if (u.intent === 'agent' || (s.offeredAgent && u.intent === 'affirm')) return handoff(s, o, 'AGENT', 'Collections Support', 'agentTransfer', false);
    if (u.intent === 'stop_calls') { say(s, o, 'stopCalls'); s.flags.channelPref = true; o.ev('compliance', 'Contact preference recorded: no further automated calls', ''); return end(s, o, 'CHANNEL_PREFERENCE', { queue: 'Contact Preferences', planned: true }); }

    const R = await handlers[s.state](s, o, u, e, b);
    if (R) return R;
    return { says: o.says, events: o.events, ended: false };
  }

  function resay(s, o) {
    if (s.state === 'rpc') say(s, o, 'opening'); else if (s.state === 'verify') say(s, o, 'askVerify'); else if (s.verified) sayDue(s, o);
    return { says: o.says, events: o.events, ended: false };
  }
  function sayDue(s, o) { const st = D.loanStatus(borrowerOf(s), s.nowMs); say(s, o, st.bucket === 'pre-due' ? 'duePre' : st.bucket === 'due-today' ? 'dueToday' : 'dueOver'); }
  function notUnderstood(s, o) {
    s.notUnderstood += 1;
    if (s.notUnderstood >= 2) return handoff(s, o, 'AGENT', 'Collections Support', 'notUnderstoodEnd', false);
    say(s, o, 'notUnderstood'); return { says: o.says, events: o.events, ended: false };
  }
  function callback(s, o, e) {
    if (!e.time) { s.state = 'callback_time'; say(s, o, 'callbackAskTime'); return { says: o.says, events: o.events, ended: false }; }
    const p = D.ist(s.nowMs); let dayMs = e.date !== undefined ? e.date : D.istDay(s.nowMs);
    if (e.date === undefined && (e.time.h < p.h || (e.time.h === p.h && e.time.min <= p.min))) dayMs = D.addDays(dayMs, 1);
    const at = dayMs + (e.time.h * 60 + e.time.min) * 60000;
    const rule = C.callbackAllowed(e.time.h, e.time.min, true);
    const time = (lg) => (D.daysBetween(s.nowMs, at) === 1 ? (lg === 'hi' ? 'कल ' : 'tomorrow ') : '') + D.fmtTimeLang(e.time.h, e.time.min, lg);
    if (rule.consentNeeded) o.ev('compliance', `Callback at ${D.fmtTime(e.time.h, e.time.min)} is outside 8 am–7 pm: allowed because the borrower asked; consent recorded`, 'RBI: other times only at borrower request');
    o.ev('crm', `Callback scheduled for ${D.fmtDate(at, 'en')} ${D.fmtTime(e.time.h, e.time.min)}`, `callbackAtMs=${at} consent=${rule.consentNeeded}`);
    say(s, o, rule.consentNeeded ? 'callbackConsent' : 'callbackOk', { time });
    return end(s, o, 'CALLBACK', { callbackAtMs: at, consent: rule.consentNeeded });
  }
  function maxPtpDate(s) {
    const st = D.loanStatus(borrowerOf(s), s.nowMs);
    return st.dpd > 0 ? D.addDays(D.istDay(s.nowMs), L.policy.maxPtpDaysOverdue) : D.addDays(st.dueMs, L.policy.maxPtpDaysAfterDue);
  }
  function ptp(s, o, dateMs) {
    const max = maxPtpDate(s); const b = borrowerOf(s);
    if (dateMs > max) {
      if (s.ptpNegotiated) { s.state = 'ended'; return handoff(s, o, 'PTP_ESCALATED', 'Collections Specialist', 'specialistTransfer', true); }
      s.ptpNegotiated = true; s.state = 'ptp_negotiate';
      o.ev('agent', `Promised date ${D.fmtDate(dateMs, 'en')} is beyond policy (max ${D.fmtDate(max, 'en')}): offer the max date or a specialist`, 'policy.maxPtpDays');
      say(s, o, 'ptpTooFar', { maxDate: (lg) => D.fmtDate(max, lg) }); return { says: o.says, events: o.events, ended: false };
    }
    o.ev('tool', `Promise-to-pay recorded: ${D.rupees(b.emi)} by ${D.fmtDate(dateMs, 'en')}`, 'POST /lms/ptp');
    if (D.daysBetween(s.nowMs, dateMs) >= 1) whatsapp(s, o, 'PTP reminder scheduled (day before)', `Reminder: ${D.rupees(b.emi)} EMI by ${D.fmtDate(dateMs, 'en')}. Pay: ${upi(s).short}`);
    o.ev('crm', `Follow-up check scheduled for ${D.fmtDate(D.addDays(dateMs, 1), 'en')} (only if not paid)`, '');
    say(s, o, 'ptpConfirm', { date: (lg) => D.fmtDate(dateMs, lg) });
    return end(s, o, 'PTP', { ptpDateMs: dateMs, amount: b.emi });
  }
  function upi(s) {
    const b = borrowerOf(s);
    const deep = `upi://pay?pa=sahayakfinance@upi&pn=${encodeURIComponent(L.name)}&am=${b.emi}&cu=INR&tn=${encodeURIComponent('EMI ' + b.id + ' xx' + b.acctLast4)}`;
    return { deep, short: 'https://pay.sahayak.example/' + b.id.toLowerCase() + '-' + (s.id.slice(-4)) };
  }
  function sendLink(s, o) {
    const b = borrowerOf(s); const link = upi(s); s.link = link;
    o.ev('tool', `UPI payment link created for ${D.rupees(b.emi)}`, link.deep);
    whatsapp(s, o, 'UPI payment link', `${L.name}: Pay your EMI of ${D.rupees(b.emi)} securely: ${link.short} (valid 24 h). Grievance officer: ${L.grievanceOfficer}`);
    s.state = 'awaiting_payment'; say(s, o, 'linkSent'); return { says: o.says, events: o.events, ended: false };
  }
  function checkPayment(s, o, ctx) {
    const gw = (o.ctx && o.ctx.paymentGateway) || (() => ({ received: true, utr: '5' + String(Date.now()).slice(-11) }));
    const r = gw(s);
    o.ev('tool', r.received ? `Payment webhook: received, UTR ${r.utr}` : 'Payment webhook: nothing received yet', 'UPI PSP callback');
    if (r.received) { const b = borrowerOf(s); s.flags.paid = true; whatsapp(s, o, 'Receipt', `${L.name}: Received ${D.rupees(b.emi)}, UTR ${r.utr}. Thank you!`); say(s, o, 'paymentReceived'); return end(s, o, 'PAID', { amount: b.emi, utr: r.utr }); }
    s.state = 'ask_date'; say(s, o, 'paymentNotYet'); return { says: o.says, events: o.events, ended: false };
  }
  function ledger(s, o, utr) {
    const b = borrowerOf(s); const hit = D.LEDGER.find((x) => x.borrowerId === b.id && (!utr || x.utr === utr));
    o.ev('tool', hit ? `Ledger check: payment found (UTR ${hit.utr})` : `Ledger check: no payment found${utr ? ' for UTR ' + utr : ''}`, 'GET /lms/payments');
    if (hit) { s.flags.paid = true; say(s, o, 'paidVerified', { amount: D.rupees(hit.amount), date: (lg) => D.fmtDate(D.addDays(s.nowMs, -hit.daysAgo), lg) }); return end(s, o, 'ALREADY_PAID_VERIFIED', { utr: hit.utr }); }
    const id = ticket(s, o, 'Payment claim', `UTR ${utr || 'not provided'}`);
    o.ev('crm', 'Calls paused 48 h while the claim is verified', `holdHours=${L.policy.paymentClaimHoldHours}`);
    say(s, o, 'paidClaim'); return end(s, o, 'PAYMENT_CLAIM', { ticketId: id, holdUntilMs: s.nowMs + L.policy.paymentClaimHoldHours * 3600000 });
  }
  function hardship(s, o) { o.ev('agent', 'Hardship detected: empathy first, no pressure, offer options', 'sensitive'); s.flags.hardshipNoted = true; s.state = 'hardship_options'; say(s, o, 'hardship'); return { says: o.says, events: o.events, ended: false }; }
  function dispute(s, o) {
    const id = ticket(s, o, 'Dispute', s.transcript.filter((t) => t.who === 'caller').slice(-1)[0].text);
    s.flags.dispute = true; o.ev('compliance', 'Dispute: collection contact paused, grievance officer details sent', '');
    whatsapp(s, o, 'Grievance officer details (SMS)', `${L.name} grievance officer: ${L.grievanceOfficer}. Ref ${id}`);
    say(s, o, 'dispute'); return end(s, o, 'DISPUTE', { ticketId: id, queue: 'Disputes', planned: true });
  }

  const handlers = {
    async rpc(s, o, u, e) {
      if (u.intent === 'wrong_number') { say(s, o, 'wrongNumber'); o.ev('crm', 'Number marked wrong: skip-trace team will update contact', ''); return end(s, o, 'WRONG_NUMBER'); }
      if (u.intent === 'not_available' || (u.intent === 'deny' && !u.yes)) { o.ev('compliance', 'Third party on the line: no loan details shared', 'privacy'); s.state = 'third_party'; if (e.time) return thirdPartyTime(s, o, e); say(s, o, 'thirdPartyAsk'); return null; }
      if (u.intent === 'callback') return callback(s, o, e);
      if (u.intent === 'affirm' || u.yes || u.intent === 'digits') {
        s.state = 'verify';
        if (u.intent === 'digits' && e.digits && e.digits.length >= 4) return handlers.verify(s, o, u, e);
        say(s, o, 'askVerify'); return null;
      }
      return notUnderstood(s, o);
    },
    async third_party(s, o, u, e) { if (e.time) return thirdPartyTime(s, o, e); say(s, o, 'thirdPartyEnd'); return end(s, o, 'THIRD_PARTY'); },
    async verify(s, o, u, e) {
      const d = (e.digits || '').slice(-4);
      if (d.length < 4) { if (u.intent === 'deny') { s.verifyTries += 1; } if (s.verifyTries >= 2) { say(s, o, 'verifyFail'); whatsapp(s, o, 'Helpline SMS', `${L.name} helpline 1800-200-3000`); return end(s, o, 'NOT_VERIFIED'); } return notUnderstood(s, o); }
      const b = borrowerOf(s);
      if (d === b.acctLast4) { s.verified = true; s.notUnderstood = 0; o.ev('compliance', 'Identity verified: loan details may now be shared', 'last 4 of loan account matched'); s.state = 'inform'; sayDue(s, o); return null; }
      s.verifyTries += 1; o.ev('compliance', `Verification failed (${s.verifyTries}/2)`, '');
      if (s.verifyTries >= 2) { say(s, o, 'verifyFail'); whatsapp(s, o, 'Helpline SMS', `${L.name} helpline 1800-200-3000`); return end(s, o, 'NOT_VERIFIED'); }
      say(s, o, 'verifyRetry'); return null;
    },
    async inform(s, o, u, e) { return negotiate(s, o, u, e, 'inform'); },
    async ask_date(s, o, u, e) { return negotiate(s, o, u, e, 'ask_date'); },
    async reason(s, o, u, e) { if (u.intent === 'unknown' || u.intent === 'deny') { s.state = 'ask_date'; say(s, o, 'askDate'); return null; } return negotiate(s, o, u, e, 'reason'); },
    async awaiting_payment(s, o, u, e) {
      if (['payment_done', 'already_paid', 'affirm'].includes(u.intent)) return checkPayment(s, o);
      if (u.intent === 'promise' || e.date !== undefined) return e.date !== undefined ? ptp(s, o, e.date) : (s.state = 'ask_date', say(s, o, 'askDate'), null);
      if (u.intent === 'deny') { s.state = 'ask_date'; say(s, o, 'askDate'); return null; }
      return negotiate(s, o, u, e, 'awaiting_payment');
    },
    async ask_utr(s, o, u, e) { return ledger(s, o, e.utr || null); },
    async hardship_options(s, o, u, e) {
      if (e.date !== undefined) return ptp(s, o, e.date);
      if (['specialist', 'affirm', 'agent', 'hardship'].includes(u.intent)) return handoff(s, o, 'HARDSHIP', 'Hardship & Restructuring', 'specialistTransfer', true);
      if (u.intent === 'deny') { s.state = 'ask_date'; say(s, o, 'askDate'); return null; }
      return notUnderstood(s, o);
    },
    async ptp_negotiate(s, o, u, e) {
      if (e.date !== undefined) return ptp(s, o, e.date);
      if (u.intent === 'affirm' || u.intent === 'promise') return ptp(s, o, maxPtpDate(s));
      return handoff(s, o, 'PTP_ESCALATED', 'Collections Specialist', 'specialistTransfer', true);
    },
    async callback_time(s, o, u, e) { if (e.time) return callback(s, o, e); say(s, o, 'thirdPartyEnd'); return end(s, o, 'CALLBACK', { callbackAtMs: null }); },
  };
  function thirdPartyTime(s, o, e) {
    const p = D.ist(s.nowMs); let dayMs = e.date !== undefined ? e.date : D.istDay(s.nowMs);
    if (e.date === undefined && e.time.h <= p.h) dayMs = D.addDays(dayMs, 1);
    const rule = C.callbackAllowed(e.time.h, e.time.min, false);
    const h = rule.ok ? e.time.h : Math.min(Math.max(e.time.h, L.callingWindow.startHour), L.callingWindow.endHour - 1);
    if (!rule.ok) o.ev('compliance', `Requested time ${D.fmtTime(e.time.h, e.time.min)} is outside 8 am–7 pm and not asked by the borrower: moved to ${D.fmtTime(h, 0)}`, '');
    const at = dayMs + h * 3600000;
    o.ev('crm', `Callback scheduled for ${D.fmtDate(at, 'en')} ${D.fmtTime(h, 0)} (third party gave the time)`, '');
    say(s, o, 'thirdPartyCallback', { time: (lg) => D.fmtTimeLang(h, rule.ok ? e.time.min : 0, lg) });
    return end(s, o, 'THIRD_PARTY_CALLBACK', { callbackAtMs: at });
  }
  async function negotiate(s, o, u, e, from) {
    if (u.intent === 'already_paid') { s.state = 'ask_utr'; if (e.utr) return ledger(s, o, e.utr); say(s, o, 'askUtr'); return null; }
    if (u.intent === 'hardship') return hardship(s, o);
    if (u.intent === 'dispute') return dispute(s, o);
    if (u.intent === 'callback') return callback(s, o, e);
    if (u.intent === 'pay_now' || (u.intent === 'affirm' && from !== 'awaiting_payment')) return sendLink(s, o);
    if (e.date !== undefined && (u.intent === 'promise' || u.intent === 'unknown' || u.intent === 'deny' || u.intent === 'digits')) return ptp(s, o, e.date);
    if (u.intent === 'promise') { s.state = 'ask_date'; say(s, o, 'askDate'); return null; }
    if (u.intent === 'ask_amount') { sayDue(s, o); return null; }
    if (u.intent === 'deny') { if (from === 'ask_date' || from === 'reason') return hardship(s, o); s.state = 'reason'; say(s, o, 'askReason'); return null; }
    return notUnderstood(s, o);
  }

  function describe(u) {
    const N = { affirm: 'yes', deny: 'no', digits: 'gave digits', promise: 'promise to pay', pay_now: 'wants to pay now', payment_done: 'says payment is done', already_paid: 'says already paid',
      hardship: 'financial hardship', dispute: 'disputes the loan/amount', bereavement: 'bereavement', callback: 'call back later', not_available: 'borrower not available',
      wrong_number: 'wrong number', agent: 'wants a person', abusive: 'upset / abusive', stop_calls: 'stop calling', switch_hi: 'switch to Hindi', switch_en: 'switch to English',
      ask_amount: 'asks the amount', specialist: 'wants specialist', unknown: 'not understood' };
    const bits = [`Understood: ${N[u.intent] || u.intent}`];
    const e = u.entities || {};
    if (e.date !== undefined) bits.push('date ' + D.fmtDate(e.date, 'en'));
    if (e.time) bits.push('time ' + D.fmtTime(e.time.h, e.time.min));
    if (e.utr) bits.push('UTR ' + e.utr); else if (e.digits && e.digits.length >= 4) bits.push('digits ' + e.digits);
    if (u.lang) bits.push(u.lang === 'hi' ? 'Hindi/Hinglish' : 'English');
    return bits.join(' · ');
  }

  return { createSession, start, turn, T, summary, borrowerOf };
});
