/**
 * campaign.js — the outbound "dialler brain": who to call today, in what order, what happened, what next.
 *
 *   plan(nowMs, crm)            -> every borrower with a decision: call now (bot) / human team / skip, and why
 *   dialOutcome(b, rng)         -> answered | no_answer | busy | switched_off | voicemail  (simulated network)
 *   applyResult(crm, b, r, now) -> updates the borrower's CRM state (holds, PTP, flags, retries, counters)
 *   kpis(records)               -> the numbers a collections head looks at every day
 *   roi(inputs)                 -> monthly saving estimate for the business case
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data'), require('./compliance'));
  else { root.EMI = root.EMI || {}; root.EMI.campaign = factory(root.EMI.data, root.EMI.compliance); }
})(typeof self !== 'undefined' ? self : this, function (D, C) {
  'use strict';
  const PRIORITY = { 'due-today': 0, 'dpd-1-30': 1, 'pre-due': 2, 'dpd-30-plus': 3 };
  const RETRY_MIN = { no_answer: 120, busy: 30, switched_off: 240, voicemail: 180 };

  function plan(nowMs, crm) {
    const rows = D.BORROWERS.map((b) => {
      const st = D.loanStatus(b, nowMs); const state = (crm && crm[b.id]) || {};
      const decision = C.canCall(b, nowMs, state);
      const retryWait = state.nextAttemptMs && nowMs < state.nextAttemptMs;
      if (decision.ok && retryWait) { decision.ok = false; decision.route = 'skip'; decision.reason = `Retry scheduled at ${D.fmtTime(D.ist(state.nextAttemptMs).h, D.ist(state.nextAttemptMs).min)}`; }
      return { b, st, decision, priority: PRIORITY[st.bucket] * 1e6 - b.emi };
    });
    return rows.sort((x, y) => (x.decision.ok === y.decision.ok ? x.priority - y.priority : x.decision.ok ? -1 : 1));
  }

  function dialOutcome(b, rng) {
    const r = (rng || Math.random)();
    return r < 0.62 ? 'answered' : r < 0.80 ? 'no_answer' : r < 0.88 ? 'busy' : r < 0.95 ? 'switched_off' : 'voicemail';
  }

  function applyResult(crm, b, result, nowMs) {
    const s = crm[b.id] = Object.assign({ flags: {}, attemptsToday: 0, conversationsToday: 0 }, crm[b.id] || {});
    s.attemptsToday += 1; s.lastResult = (result.outcome && result.outcome.disposition) || result.network; s.lastAtMs = nowMs;
    if (result.network && result.network !== 'answered') { s.nextAttemptMs = nowMs + (RETRY_MIN[result.network] || 120) * 60000; return s; }
    s.conversationsToday += 1; const o = result.outcome || {};
    switch (o.disposition) {
      case 'PAID': case 'ALREADY_PAID_VERIFIED': s.flags.paid = true; break;
      case 'PTP': s.ptpDateMs = o.ptpDateMs; break;
      case 'PAYMENT_CLAIM': s.holdUntilMs = o.holdUntilMs; break;
      case 'DISPUTE': s.flags.dispute = true; break;
      case 'HARDSHIP': s.flags.hardship = true; break;
      case 'DECEASED': s.flags.deceased = true; break;
      case 'CHANNEL_PREFERENCE': s.flags.channelPref = true; break;
      case 'CALLBACK': case 'THIRD_PARTY_CALLBACK': if (o.callbackAtMs) { s.callbackAtMs = o.callbackAtMs; s.callbackConsent = !!o.consent; s.nextAttemptMs = o.callbackAtMs; s.conversationsToday -= 1; } break;
      case 'NO_RESPONSE': s.nextAttemptMs = nowMs + 120 * 60000; s.conversationsToday -= 1; break;
      default: break;
    }
    return s;
  }

  function kpis(records) {
    const k = { attempts: records.length, answered: 0, rpc: 0, verified: 0, ptp: 0, ptpAmount: 0, paid: 0, paidAmount: 0, links: 0, escalations: {}, dispositions: {} };
    for (const r of records) {
      if (r.network === 'answered') k.answered += 1;
      const o = r.outcome; if (!o) continue;
      k.dispositions[o.disposition] = (k.dispositions[o.disposition] || 0) + 1;
      if (!['THIRD_PARTY', 'THIRD_PARTY_CALLBACK', 'WRONG_NUMBER', 'NO_RESPONSE', 'DECEASED'].includes(o.disposition)) k.rpc += 1;
      if (o.verified) k.verified += 1;
      if (o.disposition === 'PTP') { k.ptp += 1; k.ptpAmount += o.amount || 0; }
      if (o.disposition === 'PAID') { k.paid += 1; k.paidAmount += o.amount || 0; }
      if (r.linkSent) k.links += 1;
      if (o.queue) k.escalations[o.queue] = (k.escalations[o.queue] || 0) + 1;
    }
    k.connectRate = k.attempts ? Math.round(100 * k.answered / k.attempts) : 0;
    k.rpcRate = k.answered ? Math.round(100 * k.rpc / k.answered) : 0;
    k.resolvedRate = k.verified ? Math.round(100 * (k.ptp + k.paid + (k.dispositions.ALREADY_PAID_VERIFIED || 0)) / k.verified) : 0;
    return k;
  }

  /** Simple monthly business case. All inputs editable in the simulator. */
  function roi(i) {
    const x = Object.assign({ accounts: 100000, callsPerAccount: 2, agentCostPerCall: 50, botCostPerCall: 8, botShare: 70, extraRecoveryPts: 5, avgEmi: 3500 }, i || {});
    const calls = x.accounts * x.callsPerAccount; const botCalls = calls * x.botShare / 100;
    const saving = botCalls * (x.agentCostPerCall - x.botCostPerCall);
    const extraCollected = x.accounts * (x.extraRecoveryPts / 100) * x.avgEmi;
    return { calls, botCalls, saving, extraCollected, agentsFreed: Math.round(botCalls / (22 * 120)) };
  }

  return { plan, dialOutcome, applyResult, kpis, roi };
});
