/**
 * data.js — the pretend lender, its borrowers and its payment ledger.
 *
 * In a real deployment this comes from the Loan Management System (LMS) / CRM through an API.
 * Due dates are stored RELATIVE to "today" (dueOffsetDays) so every demo date works:
 *   +3 = due in 3 days (pre-due reminder), 0 = due today, -4 = 4 days past due (DPD 4).
 * All names, numbers and accounts are fictional.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.EMI = root.EMI || {}; root.EMI.data = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LENDER = {
    name: 'Sahayak Finance',
    nameHi: 'सहायक फाइनेंस',
    botName: 'Saathi',
    callerId: '1600-11-2233',          // BFSI service/transactional calls use the 1600 series
    grievanceOfficer: 'Ms. R. Menon, grievance@sahayakfinance.example, 1800-200-3000',
    callingWindow: { startHour: 8, endHour: 19 },   // RBI: 8 am to 7 pm, unless the borrower asks otherwise
    policy: {
      maxDialAttemptsPerDay: 3,        // lender policy (configurable) to avoid "excessive calling"
      maxConversationsPerDay: 1,
      maxPtpDaysOverdue: 7,            // a promise-to-pay must be within 7 days for overdue accounts
      maxPtpDaysAfterDue: 3,           // ...or within 3 days after the due date for pre-due accounts
      paymentClaimHoldHours: 48,       // after "I already paid", no calls while we verify
      recordingRetentionDays: 180,     // keep recordings at least six months
      botLanguages: ['hi', 'en'],      // POC bot speaks Hindi + English (incl. Hinglish input)
      maxBotBucketDpd: 30,             // beyond 30 DPD the account goes to the human team
    },
  };

  const BORROWERS = [
    { id: 'B01', name: 'Ramesh Kumar', nameHi: 'रमेश कुमार', city: 'Lucknow', lang: 'hi', product: 'Two-wheeler loan', emi: 3450, dueOffsetDays: 3, acctLast4: '4321', salaryDay: 1, phone: '+91 98390 11421', prefers: 'any' },
    { id: 'B02', name: 'Priya Sharma', nameHi: 'प्रिया शर्मा', city: 'Pune', lang: 'en', product: 'Personal loan', emi: 12500, dueOffsetDays: 0, acctLast4: '7788', salaryDay: 30, phone: '+91 98220 55870', prefers: 'evening' },
    { id: 'B03', name: 'Suresh Yadav', nameHi: 'सुरेश यादव', city: 'Patna', lang: 'hi', product: 'Consumer durable (TV)', emi: 1899, dueOffsetDays: -4, acctLast4: '1209', salaryDay: 5, phone: '+91 99310 20914', prefers: 'any' },
    { id: 'B04', name: 'Anita Devi', nameHi: 'अनीता देवी', city: 'Jaipur', lang: 'hi', product: 'Personal loan', emi: 2200, dueOffsetDays: -9, acctLast4: '5566', salaryDay: 7, phone: '+91 94140 55663', prefers: 'morning' },
    { id: 'B05', name: 'Mohammed Irfan', nameHi: 'मोहम्मद इरफ़ान', city: 'Hyderabad', lang: 'hi', product: 'Two-wheeler loan', emi: 4800, dueOffsetDays: -2, acctLast4: '9090', salaryDay: 1, phone: '+91 98490 90901', prefers: 'any' },
    { id: 'B06', name: 'Lakshmi Iyer', nameHi: 'लक्ष्मी अय्यर', city: 'Chennai', lang: 'ta', product: 'Gold loan', emi: 5200, dueOffsetDays: -3, acctLast4: '3141', salaryDay: 1, phone: '+91 98400 31415', prefers: 'any' },
    { id: 'B07', name: 'Vikram Singh', nameHi: 'विक्रम सिंह', city: 'Delhi', lang: 'hi', product: 'Personal loan', emi: 6100, dueOffsetDays: 1, acctLast4: '2468', salaryDay: 1, phone: '+91 98110 24680', prefers: 'evening' },
    { id: 'B08', name: 'Neha Gupta', nameHi: 'नेहा गुप्ता', city: 'Indore', lang: 'hi', product: 'Consumer durable (phone)', emi: 2999, dueOffsetDays: -6, acctLast4: '8080', salaryDay: 10, phone: '+91 98260 80801', prefers: 'any' },
    { id: 'B09', name: 'Arjun Mehta', nameHi: 'अर्जुन मेहता', city: 'Ahmedabad', lang: 'en', product: 'Business loan', emi: 8750, dueOffsetDays: 0, acctLast4: '6060', salaryDay: 1, phone: '+91 98250 60602', prefers: 'any' },
    { id: 'B10', name: 'Kamla Bai', nameHi: 'कमला बाई', city: 'Nagpur', lang: 'hi', product: 'Microfinance loan', emi: 1500, dueOffsetDays: -12, acctLast4: '1111', salaryDay: 1, phone: '+91 98230 11112', prefers: 'any' },
    { id: 'B11', name: 'Rohit Verma', nameHi: 'रोहित वर्मा', city: 'Bhopal', lang: 'hi', product: 'Personal loan', emi: 3999, dueOffsetDays: -1, acctLast4: '7070', salaryDay: 1, phone: '+91 98930 70703', prefers: 'any' },
    { id: 'B12', name: 'Deepak Joshi', nameHi: 'दीपक जोशी', city: 'Dehradun', lang: 'hi', product: 'Two-wheeler loan', emi: 2750, dueOffsetDays: 2, acctLast4: '5050', salaryDay: 1, phone: '+91 94120 50504', prefers: 'any' },
    { id: 'B13', name: 'Sunita Rao', nameHi: 'सुनीता राव', city: 'Mysuru', lang: 'en', product: 'Personal loan', emi: 9900, dueOffsetDays: -41, acctLast4: '4040', salaryDay: 1, phone: '+91 98450 40405', prefers: 'any' },
  ];

  // Payments already received (what "I already paid" is checked against). UTR = UPI/IMPS reference number.
  const LEDGER = [
    { borrowerId: 'B05', utr: '412345678901', amount: 4800, daysAgo: 1, mode: 'UPI' },
  ];

  // ---------- India Standard Time helpers (never trust the laptop's timezone) ----------
  const IST_OFFSET_MS = 5.5 * 3600 * 1000;
  function ist(dateMs) {
    const d = new Date((dateMs === undefined ? Date.now() : dateMs) + IST_OFFSET_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), dow: d.getUTCDay() };
  }
  /** Build an epoch-ms value for an IST wall-clock time. */
  function istMs(y, m, d, h, min) { return Date.UTC(y, m, d, h || 0, min || 0) - IST_OFFSET_MS; }
  function addDays(ms, n) { return ms + n * 86400000; }
  /** Midnight IST of the day containing ms. */
  function istDay(ms) { const p = ist(ms); return istMs(p.y, p.m, p.d, 0, 0); }
  function daysBetween(aMs, bMs) { return Math.round((istDay(bMs) - istDay(aMs)) / 86400000); }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_HI = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'];
  function fmtDate(ms, lang) { const p = ist(ms); return lang === 'hi' ? `${p.d} ${MONTHS_HI[p.m]}` : `${p.d} ${MONTHS[p.m]}`; }
  function fmtTime(h, min) { const hh = ((h + 11) % 12) + 1; return `${hh}:${String(min || 0).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; }
  function fmtTimeLang(h, min, lang) {
    if (lang !== 'hi') return fmtTime(h, min);
    const part = h < 12 ? 'सुबह' : h < 16 ? 'दोपहर' : h < 20 ? 'शाम' : 'रात';
    const hh = ((h + 11) % 12) + 1; return `${part} ${hh}${min ? ':' + String(min).padStart(2, '0') : ''} बजे`;
  }
  function rupees(n) { return '₹' + Number(n).toLocaleString('en-IN'); }

  /** Loan view for a borrower relative to "now": due date, days past due (DPD), bucket. */
  function loanStatus(b, nowMs) {
    const dueMs = addDays(istDay(nowMs), b.dueOffsetDays);
    const dpd = Math.max(0, -b.dueOffsetDays);
    const bucket = b.dueOffsetDays > 0 ? 'pre-due' : b.dueOffsetDays === 0 ? 'due-today' : dpd <= 30 ? 'dpd-1-30' : 'dpd-30-plus';
    return { dueMs, dpd, bucket };
  }

  return { LENDER, BORROWERS, LEDGER, ist, istMs, istDay, addDays, daysBetween, fmtDate, fmtTime, fmtTimeLang, rupees, loanStatus };
});
