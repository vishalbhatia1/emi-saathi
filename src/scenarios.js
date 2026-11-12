/**
 * scenarios.js — twelve real-life EMI calls (Hindi, Hinglish, English). Used by the simulator and the tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.EMI = root.EMI || {}; root.EMI.scenarios = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return [
    { id: 'pay-now', borrowerId: 'B01', title: 'Pre-due reminder → pays on the call', lang: 'Hindi', story: 'Ramesh (Lucknow) is reminded 3 days before his due date, gets a UPI link on WhatsApp and pays while on the line.',
      steps: ['हाँ, बोल रहा हूँ', 'चार तीन दो एक', 'हाँ, लिंक भेज दो', 'हो गया'], expect: 'PAID' },
    { id: 'ptp-salary', borrowerId: 'B03', title: '"Salary aane pe" → promise-to-pay', lang: 'Hinglish', story: 'Suresh (Patna) is 4 days late and wants to pay after salary. The bot keeps the date within policy and schedules a WhatsApp reminder.',
      steps: ['haan ji main hi hoon', '1 2 0 9', 'abhi nahi, salary aane pe 5 tarikh tak kar dunga', 'achha theek hai, parso tak kar dunga'], expect: 'PTP' },
    { id: 'ptp-english', borrowerId: 'B02', title: 'English speaker → promise for tomorrow', lang: 'English', story: 'Priya (Pune) is due today and commits to pay tomorrow.',
      steps: ['Yes, speaking', '7 7 8 8', "I'll pay tomorrow for sure"], expect: 'PTP' },
    { id: 'already-paid', borrowerId: 'B05', title: '"Maine pay kar diya" → UTR verified', lang: 'Hinglish', story: 'Mohammed (Hyderabad) already paid yesterday. The bot checks the UTR against the ledger and apologises.',
      steps: ['ji haan', '9 0 9 0', 'maine to pay kar diya hai kal hi', 'UTR hai 412345678901'], expect: 'ALREADY_PAID_VERIFIED' },
    { id: 'hardship', borrowerId: 'B04', title: 'Lost her job → empathy + specialist', lang: 'Hindi', story: 'Anita (Jaipur) lost her job. No pressure: the bot offers options and connects a restructuring specialist.',
      steps: ['हाँ जी', 'पांच पांच छह छह', 'मेरी नौकरी चली गई है, अभी पैसे नहीं हैं', 'हाँ, किसी से बात करवा दो'], expect: 'HARDSHIP' },
    { id: 'third-party', borrowerId: 'B07', title: 'Wife answers → no loan details shared', lang: 'Hindi', story: "Vikram's wife answers. The bot never mentions the loan (privacy) and books a callback.",
      steps: ['नहीं, मैं उनकी पत्नी बोल रही हूँ, वो घर पर नहीं हैं', 'शाम 6 बजे के बाद'], expect: 'THIRD_PARTY_CALLBACK' },
    { id: 'callback-9pm', borrowerId: 'B09', title: '"Call me at 9 pm" → allowed with consent', lang: 'English', story: 'Arjun (Ahmedabad) is in a meeting and asks for 9 pm, outside 8 am–7 pm. Allowed only because he asked, and consent is recorded.',
      steps: ['Yes this is Arjun, but I am in a meeting, call me at 9 pm'], expect: 'CALLBACK' },
    { id: 'dispute', borrowerId: 'B08', title: 'Wrong amount → dispute ticket, calls paused', lang: 'Hinglish', story: 'Neha (Indore) says the amount is wrong. The bot stops collecting, opens a ticket and shares grievance officer details.',
      steps: ['haan', '8 0 8 0', 'amount galat hai, maine sirf 2000 ka loan liya tha'], expect: 'DISPUTE' },
    { id: 'bereavement', borrowerId: 'B10', title: 'Borrower passed away → stop, with care', lang: 'Hindi', story: "Kamla Bai's son says she passed away. The bot offers condolences, stops, and flags the account for a sensitive-cases team.",
      steps: ['नहीं, मैं उनका बेटा हूँ। माँ का पिछले महीने निधन हो गया'], expect: 'DECEASED' },
    { id: 'wrong-number', borrowerId: 'B11', title: 'Wrong number → apologise, fix data', lang: 'Hinglish', story: 'The number no longer belongs to Rohit. Apologise, mark it for skip-tracing, reveal nothing.',
      steps: ['galat number hai, yahan koi Rohit nahi rehta'], expect: 'WRONG_NUMBER' },
    { id: 'not-verified', borrowerId: 'B12', title: 'Fails verification → no details shared', lang: 'Hinglish', story: 'Two wrong account digits: the bot protects the borrower, shares nothing and sends the helpline by SMS.',
      steps: ['haan bol raha hoon', '1 2 3 4', '9 8 7 6'], expect: 'NOT_VERIFIED' },
    { id: 'switch-agent', borrowerId: 'B09', title: 'Switches to Hindi, then asks for a person', lang: 'English → Hindi', story: 'Arjun asks to speak Hindi, verifies, then wants a human. Warm transfer with a summary.',
      steps: ['Hindi mein baat karo', 'haan', '6 0 6 0', 'mujhe kisi insaan se baat karni hai'], expect: 'AGENT' },
  ];
});
