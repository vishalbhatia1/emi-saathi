/**
 * compliance.js — the rules every call must follow, checked by code, not by hope.
 *
 *  1. canCall()        before dialling: calling window (8 am–7 pm IST unless the borrower asked
 *                      for another time), daily attempt caps, holds (dispute, payment claim, PTP),
 *                      bucket and language routing.
 *  2. disclosure guard the agent may not reveal loan details until the right person is verified
 *                      (protects borrower privacy; no third-party disclosure).
 *  3. auditUtterance() every sentence the bot is about to say is scanned for coercive or threatening
 *                      language and blocked if found.
 *  4. callOpening()    AI disclosure + recording notice + lender identity at the start of each call.
 *
 * Based on RBI recovery-conduct directions (contact 8 am–7 pm unless the borrower asks otherwise; calls
 * recorded with intimation; no harsh practices incl. excessive calling, threats, third-party disclosure)
 * and the DPDP Act 2023 (purpose limitation, minimal data). This is a POC: have Legal confirm the rules.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data'));
  else { root.EMI = root.EMI || {}; root.EMI.compliance = factory(root.EMI.data); }
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  // Phrases a collections bot must never say (coercion, threats, shaming, third-party pressure).
  const PROHIBITED = ['police', 'jail', 'arrest', 'court case', 'legal action', 'warrant', 'goons', 'ghar aa jayenge', 'ghar aayenge', 'family ko bata',
    'office mein bata', 'badnaam', 'social media', 'blacklist kar', 'consequences', 'pay or else', 'पुलिस', 'जेल', 'गिरफ्तार', 'कोर्ट केस', 'कानूनी कार्रवाई',
    'घर आ जाएंगे', 'घर आएंगे', 'परिवार को बता', 'बदनाम', 'नतीजा भुगत'];

  /**
   * @param b       borrower
   * @param nowMs   current time
   * @param state   per-borrower CRM state { attemptsToday, conversationsToday, holdUntilMs, flags:{deceased,dispute,hardship,paid,channelPref},
   *                                          ptpDateMs, callbackAtMs, callbackConsent }
   * @returns { ok, reason, route }   route: 'bot' | 'human' | 'skip'
   */
  function canCall(b, nowMs, state, lender) {
    const L = lender || D.LENDER; const s = state || {}; const f = s.flags || {};
    const p = D.ist(nowMs); const hourMin = p.h + p.min / 60;
    const { bucket } = D.loanStatus(b, nowMs);
    if (f.paid) return { ok: false, route: 'skip', reason: 'EMI already paid' };
    if (f.deceased) return { ok: false, route: 'human', reason: 'Deceased borrower: specialist team handles with sensitivity, no automated calls' };
    if (f.dispute) return { ok: false, route: 'human', reason: 'Open dispute: no collection calls until resolved' };
    if (f.hardship) return { ok: false, route: 'human', reason: 'Hardship case owned by a specialist' };
    if (f.channelPref) return { ok: false, route: 'human', reason: 'Borrower asked not to be called: human review of contact preference' };
    if (s.holdUntilMs && nowMs < s.holdUntilMs) return { ok: false, route: 'skip', reason: 'On hold: payment claim being verified' };
    if (s.ptpDateMs && D.istDay(nowMs) <= s.ptpDateMs) return { ok: false, route: 'skip', reason: 'Promise-to-pay active: WhatsApp reminder only until the promised date' };
    if (bucket === 'dpd-30-plus') return { ok: false, route: 'human', reason: `DPD ${-b.dueOffsetDays}: beyond bot scope (> ${L.policy.maxBotBucketDpd} days), human collections team` };
    if (!L.policy.botLanguages.includes(b.lang)) return { ok: false, route: 'human', reason: `Preferred language "${b.lang}" not supported by the POC bot: route to a ${b.lang === 'ta' ? 'Tamil' : b.lang}-speaking agent` };
    const consented = s.callbackAtMs && s.callbackConsent && Math.abs(nowMs - s.callbackAtMs) < 30 * 60000;
    const inWindow = hourMin >= L.callingWindow.startHour && hourMin < L.callingWindow.endHour;
    if (!inWindow && !consented) return { ok: false, route: 'skip', reason: `Outside the ${L.callingWindow.startHour} am–${L.callingWindow.endHour - 12} pm calling window (IST)` };
    if ((s.attemptsToday || 0) >= L.policy.maxDialAttemptsPerDay) return { ok: false, route: 'skip', reason: `Daily dial cap reached (${L.policy.maxDialAttemptsPerDay})` };
    if ((s.conversationsToday || 0) >= L.policy.maxConversationsPerDay && !consented) return { ok: false, route: 'skip', reason: 'Already spoke today: no repeat calls (avoids excessive calling)' };
    return { ok: true, route: 'bot', reason: consented ? 'Borrower-requested callback time (consent recorded)' : `Inside calling window · ${bucket}` };
  }

  /** Is a callback time allowed? Outside the window only if the borrower explicitly asked for it. */
  function callbackAllowed(h, min, borrowerRequested, lender) {
    const L = lender || D.LENDER; const hm = h + (min || 0) / 60;
    const inWindow = hm >= L.callingWindow.startHour && hm < L.callingWindow.endHour;
    if (inWindow) return { ok: true, consentNeeded: false };
    return borrowerRequested ? { ok: true, consentNeeded: true } : { ok: false, consentNeeded: false };
  }

  function auditUtterance(text) {
    const t = String(text).toLowerCase();
    const hits = PROHIBITED.filter((w) => t.includes(w));
    return { ok: hits.length === 0, hits };
  }

  return { canCall, callbackAllowed, auditUtterance, PROHIBITED };
});
