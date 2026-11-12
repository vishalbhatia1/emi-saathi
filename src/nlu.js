/**
 * nlu.js — understands what the borrower said, in Hindi (देवनागरी), Hinglish (Roman) or English.
 *
 * understand(text, ctx) -> {
 *   lang: 'hi' | 'en',             reply language (Devanagari or Hinglish both -> 'hi')
 *   intent, confidence,            see INTENTS below
 *   entities: { digits, date, time, amount, utr },
 *   sentiment                      -1 (upset) .. +0.5 (positive)
 * }
 * ctx = { nowMs, salaryDay }  so "kal", "parso", "Friday", "salary aane pe" become real dates.
 *
 * Deliberately rule-based so the POC runs offline with no API keys. In production swap this ONE
 * function for an LLM classifier (see src/llm.js) or Amazon Lex / Nova Sonic; the agent stays the same.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data'));
  else { root.EMI = root.EMI || {}; root.EMI.nlu = factory(root.EMI.data); }
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  // Ordered: the first match wins, so specific intents come before general ones.
  const INTENTS = [
    ['bereavement', ['death ho', 'guzar gay', 'nahi rahe', 'nahin rahe', 'passed away', 'expired', 'died', 'nidhan', 'निधन', 'गुज़र', 'गुजर', 'नहीं रहे', 'मृत्यु', 'देहांत']],
    ['abusive', ['bakwas', 'bewakoof', 'pagal', 'stupid', 'idiot', 'shut up', 'chup', 'बकवास', 'बेवकूफ', 'पागल', 'चुप']],
    ['agent', ['agent', 'insaan se', 'kisi insaan', 'human', 'manager', 'executive', 'real person', 'customer care se', 'इंसान', 'एजेंट', 'मैनेजर', 'किसी से बात']],
    ['stop_calls', ['call mat karo', 'phone mat karo', 'call band karo', 'stop calling', "don't call", 'do not call', 'baar baar call', 'कॉल मत', 'फोन मत', 'बार बार']],
    ['wrong_number', ['galat number', 'wrong number', 'koi nahi rehta', 'yahan koi', 'aisa koi nahi', 'गलत नंबर', 'ऐसा कोई नहीं']],
    ['dispute', ['galat amount', 'amount galat', 'wrong amount', 'loan nahi liya', 'not my loan', 'never took', 'fraud', 'dhokha', 'ज्यादा पैसे', 'गलत अमाउंट', 'अमाउंट गलत', 'लोन नहीं लिया', 'धोखा', 'फ्रॉड']],
    ['hardship', ['naukri chali', 'job chali', 'job lost', 'lost my job', 'hospital', 'bimar', 'bimaar', 'medical', 'paise nahi', 'paisa nahi', 'no money', "can't pay", 'cannot pay', 'nahi de paunga', 'nahi de paungi', 'salary nahi aayi', 'business band', 'नौकरी चली', 'अस्पताल', 'बीमार', 'पैसे नहीं', 'तनख्वाह नहीं']],
    ['already_paid', ['already paid', 'paid already', 'pay kar diya', 'pay kar chuka', 'bhar diya', 'jama kar diya', 'de diya', 'kar diya hai', 'i have paid', 'payment done', 'भर दिया', 'जमा कर दिया', 'पेमेंट कर दिया', 'दे दिया']],
    ['payment_done', ['ho gaya', 'ho gya', 'done', 'kar diya', 'paid it', 'हो गया', 'कर दिया']],
    ['pay_now', ['abhi pay', 'abhi kar', 'link bhej', 'link do', 'send link', 'send me the link', 'pay now', 'right now', 'abhi bhar', 'लिंक भेज', 'अभी कर', 'अभी पेमेंट']],
    ['callback', ['call karna', 'call karo', 'call kar dena', 'phone karna', 'phone karo', 'busy', 'baad mein', 'baad me', 'later', 'meeting', 'drive kar', 'driving', 'call back', 'call me at', 'abhi baat nahi', 'बाद में', 'व्यस्त', 'मीटिंग']],
    ['not_available', ['ghar pe nahi', 'ghar par nahi', 'bahar gaye', 'not home', 'not available', 'woh nahi', 'wo nahi', 'घर पर नहीं', 'बाहर गए', 'वो नहीं']],
    ['switch_hi', ['hindi mein', 'hindi me', 'speak hindi', 'in hindi', 'हिंदी में']],
    ['switch_en', ['english mein', 'english me', 'speak english', 'in english', 'अंग्रेज़ी में', 'अंग्रेजी में']],
    ['ask_amount', ['kitna', 'kitne', 'how much', 'amount kya', 'कितना', 'कितने']],
    ['specialist', ['specialist', 'restructur', 'vikalp', 'option', 'विकल्प', 'बात करवा']],
  ];
  const PROMISE_WORDS = ['kar dunga', 'kar doonga', 'kar dungi', 'kar doongi', 'de dunga', 'de dungi', 'bhar dunga', 'will pay', "i'll pay", 'i will pay', 'can pay', 'kar paunga', 'करूंगा', 'करूँगा', 'दूंगा', 'दूँगा', 'करूंगी', 'दूंगी', 'भर दूंगा'];
  const YES = ['haan', 'han', 'haa', 'ha ji', 'ji haan', 'haanji', 'ji', 'yes', 'yeah', 'yep', 'bilkul', 'sahi', 'correct', 'theek hai', 'thik hai', 'ok', 'okay', 'sure', 'speaking', 'bol raha', 'bol rahi', 'main hi', 'हाँ', 'हां', 'जी', 'बिल्कुल', 'सही', 'ठीक है', 'बोल रहा', 'बोल रही'];
  const NO = ['nahi', 'nahin', 'nah', 'no', 'na', 'not really', 'नहीं', 'ना'];
  const HINGLISH = ['haan', 'nahi', 'nahin', 'mein', 'hoon', 'hun', 'karo', 'kar', 'kal', 'paisa', 'paise', 'abhi', 'ji', 'kya', 'hai', 'theek', 'accha', 'achha', 'bhej', 'tarikh', 'tareekh', 'aane', 'dunga', 'baje', 'shaam', 'subah', 'raat', 'parso', 'bolo', 'baat', 'gaya', 'gayi', 'diya', 'maine', 'sirf', 'ka', 'ki', 'ke', 'liya', 'tha', 'thi', 'hain', 'aap', 'mera', 'meri', 'mujhe', 'galat', 'woh', 'wo', 'yeh', 'kaun', 'bhai', 'ghar', 'naukri', 'paas', 'tak', 'pe'];
  const NEG_WORDS = { pareshan: 0.3, 'tang': 0.4, bakwas: 0.6, gussa: 0.5, ridiculous: 0.5, harass: 0.6, worst: 0.5, angry: 0.5, 'परेशान': 0.3, 'तंग': 0.4, 'गुस्सा': 0.5 };

  const NUM_WORDS = {
    shunya: 0, zero: 0, 'शून्य': 0, ek: 1, one: 1, 'एक': 1, do: 2, two: 2, 'दो': 2, teen: 3, three: 3, 'तीन': 3, char: 4, chaar: 4, four: 4, 'चार': 4,
    paanch: 5, panch: 5, five: 5, 'पांच': 5, 'पाँच': 5, chhe: 6, chhah: 6, cheh: 6, six: 6, 'छह': 6, 'छः': 6, 'छे': 6, saat: 7, seven: 7, 'सात': 7,
    aath: 8, eight: 8, 'आठ': 8, nau: 9, nine: 9, 'नौ': 9, das: 10, ten: 10, 'दस': 10, gyarah: 11, 'ग्यारह': 11, barah: 12, baarah: 12, 'बारह': 12,
    terah: 13, 'तेरह': 13, chaudah: 14, 'चौदह': 14, pandrah: 15, 'पंद्रह': 15, solah: 16, 'सोलह': 16, satrah: 17, 'सत्रह': 17, atharah: 18, 'अठारह': 18,
    unnis: 19, 'उन्नीस': 19, bees: 20, 'बीस': 20, pachees: 25, pachchis: 25, 'पच्चीस': 25, tees: 30, 'तीस': 30,
  };
  const DOW = { sunday: 0, ravivar: 0, itwaar: 0, itwar: 0, 'रविवार': 0, 'इतवार': 0, monday: 1, somvar: 1, somwar: 1, 'सोमवार': 1, tuesday: 2, mangalvar: 2, mangalwar: 2, 'मंगलवार': 2,
    wednesday: 3, budhvar: 3, budhwar: 3, 'बुधवार': 3, thursday: 4, guruvar: 4, guruwar: 4, 'गुरुवार': 4, friday: 5, shukravar: 5, shukrawar: 5, 'शुक्रवार': 5, saturday: 6, shanivar: 6, shaniwar: 6, 'शनिवार': 6 };

  const has = (t, list) => list.some((w) => t.includes(w));
  const hasWord = (t, list) => list.some((w) => new RegExp(`(^|[\\s,.!?।])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s,.!?।])`).test(t));
  const isDevanagari = (s) => /[\u0900-\u097F]/.test(s);

  /** Words and digits -> a list of tokens where number words become numbers. */
  function tokens(t) {
    return t.replace(/[,.!?।]/g, ' ').split(/\s+/).filter(Boolean).map((w) => (/^\d+$/.test(w) ? Number(w) : (NUM_WORDS[w] !== undefined ? NUM_WORDS[w] : w)));
  }

  /** "चार तीन दो एक", "4 3 2 1", "4321", "four three two one" -> "4321" */
  function digitString(t) {
    const joined = tokens(t).map((x) => (typeof x === 'number' && x < 10 ? String(x) : typeof x === 'number' ? String(x) : ' ')).join('');
    const runs = joined.split(' ').filter(Boolean);
    return runs.sort((a, b) => b.length - a.length)[0] || '';
  }

  function amountOf(t) {
    const m = t.match(/(?:₹|rs\.?|rupees?|रुपये)?\s*(\d{3,6})/);
    if (m) return Number(m[1]);
    const k = tokens(t); for (let i = 0; i < k.length - 1; i++) if (typeof k[i] === 'number' && /^(hazaar|hazar|thousand|हज़ार|हजार)$/.test(k[i + 1])) return k[i] * 1000;
    return null;
  }

  /** Dates relative to today (IST). Returns epoch ms of midnight IST, or null. */
  function dateOf(t, ctx) {
    const now = (ctx && ctx.nowMs) || Date.now();
    const today = D.istDay(now); const p = D.ist(now);
    const dayOfMonth = (n) => { let ms = D.istMs(p.y, p.m, n); if (ms < today) ms = D.istMs(p.m === 11 ? p.y + 1 : p.y, (p.m + 1) % 12, n); return ms; };
    const k = tokens(t);
    // "5 tarikh", "5th", "5 तारीख", "पांच तारीख", "on the 5th"
    for (let i = 0; i < k.length; i++) {
      if (typeof k[i] === 'number' && k[i] >= 1 && k[i] <= 31 && /^(tarikh|tareekh|tarik|date|तारीख|तारिख)$/.test(String(k[i + 1] || ''))) return dayOfMonth(k[i]);
    }
    const th = t.match(/\b(\d{1,2})(st|nd|rd|th)\b/); if (th) return dayOfMonth(Number(th[1]));
    // "3 din mein", "in 3 days"
    for (let i = 0; i < k.length; i++) if (typeof k[i] === 'number' && /^(din|days?|दिन)$/.test(String(k[i + 1] || ''))) return D.addDays(today, k[i]);
    if (has(t, ['parso', 'parson', 'day after tomorrow', 'परसों'])) return D.addDays(today, 2);
    if (has(t, ['kal ', ' kal', 'tomorrow', 'कल']) || t === 'kal') return D.addDays(today, 1);
    if (has(t, ['aaj', 'today', 'आज'])) return today;
    if (has(t, ['agle hafte', 'next week', 'अगले हफ्ते', 'अगले सप्ताह'])) return D.addDays(today, 7);
    for (const [w, dow] of Object.entries(DOW)) if (t.includes(w)) { let diff = (dow - p.dow + 7) % 7; if (diff === 0) diff = 7; return D.addDays(today, diff); }
    if (has(t, ['salary', 'sallary', 'tankhwah', 'payday', 'सैलरी', 'तनख्वाह', 'वेतन']) && ctx && ctx.salaryDay) return dayOfMonth(ctx.salaryDay);
    return null;
  }

  /** "6 baje", "shaam 6", "6 pm", "9 pm", "subah 10", "शाम 6 बजे" -> {h, min} (24h) */
  function timeOf(t) {
    const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje|बजे)?/);
    const k = tokens(t); let h = null, min = 0;
    if (m && (m[3] || /shaam|sham|subah|raat|dopahar|शाम|सुबह|रात|दोपहर|evening|morning|night|after|ke baad|के बाद/.test(t))) { h = Number(m[1]); min = Number(m[2] || 0); }
    if (h === null) for (let i = 0; i < k.length; i++) if (typeof k[i] === 'number' && /^(baje|बजे)$/.test(String(k[i + 1] || ''))) h = k[i];
    if (h === null) for (let i = 0; i < k.length; i++) if (/^(shaam|sham|subah|raat|शाम|सुबह|रात)$/.test(String(k[i])) && typeof k[i + 1] === 'number') h = k[i + 1];
    if (h === null || h > 23) return null;
    const pm = /pm|shaam|sham|raat|शाम|रात|evening|night|dopahar|दोपहर/.test(t);
    const am = /am|subah|सुबह|morning/.test(t);
    if (pm && h < 12) h += 12; else if (!am && h >= 1 && h <= 7) h += 12; // "6 baje" usually means 6 pm
    return { h, min };
  }

  function sentimentOf(t) {
    let s = 0; for (const [w, v] of Object.entries(NEG_WORDS)) if (t.includes(w)) s -= v;
    if (/!{2,}/.test(t)) s -= 0.2; if (/(thank|dhanyavaad|shukriya|धन्यवाद|शुक्रिया)/.test(t)) s += 0.3;
    return Math.max(-1, Math.min(0.5, Math.round(s * 100) / 100));
  }

  function understand(text, ctx) {
    const raw = String(text || '').trim();
    const t = ' ' + raw.toLowerCase().replace(/\s+/g, ' ') + ' ';
    const words = t.replace(/[,.!?।]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const latinWords = words.filter((w) => /^[a-z']{2,}$/.test(w));
    // lang = null when there is no language signal (e.g. only digits): the agent keeps the current language.
    const lang = isDevanagari(raw) || words.some((w) => HINGLISH.includes(w)) ? 'hi' : latinWords.length ? 'en' : null;
    const entities = {};
    const utr = raw.replace(/\s/g, '').match(/\d{12}/); if (utr) entities.utr = utr[0];
    const digits = digitString(t); if (digits) entities.digits = digits;
    const date = dateOf(t, ctx); if (date !== null) entities.date = date;
    const time = timeOf(t); if (time) entities.time = time;
    const amount = amountOf(t); if (amount && !utr) entities.amount = amount;

    let intent = 'unknown', confidence = 0.2;
    for (const [name, phrases] of INTENTS) if (has(t, phrases)) { intent = name; confidence = 0.9; break; }
    if (intent === 'payment_done' && has(t, ['pehle', 'already', 'kal hi', 'last week', 'पहले', 'कल ही'])) intent = 'already_paid';
    if ((intent === 'unknown' || intent === 'callback') && (has(t, PROMISE_WORDS) || (entities.date !== undefined && intent === 'unknown'))) { if (entities.date !== undefined || has(t, PROMISE_WORDS)) { intent = 'promise'; confidence = entities.date !== undefined ? 0.9 : 0.7; } }
    const yes = hasWord(t.trim(), YES) || has(t, ['हाँ', 'हां', 'जी हाँ', 'theek hai', 'ठीक है']);
    const no = hasWord(t.trim(), NO) || has(t, ['नहीं']);
    if (intent === 'unknown' && yes && !no) { intent = 'affirm'; confidence = 0.85; }
    else if (intent === 'unknown' && no && !yes) { intent = 'deny'; confidence = 0.85; }
    else if (intent === 'unknown' && no && yes) { intent = 'deny'; confidence = 0.6; }
    if (intent === 'unknown' && entities.time) { intent = 'callback'; confidence = 0.8; }
    if (intent === 'unknown' && entities.digits) { intent = 'digits'; confidence = 0.9; }
    return { text: raw, lang, intent, confidence, entities, sentiment: sentimentOf(t), yes, no };
  }

  return { understand, dateOf, timeOf, digitString, amountOf, isDevanagari };
});
