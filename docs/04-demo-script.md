# 10-minute demo script

**Setup:** `npm start` → http://localhost:3100 · clock 11:00 · click Reset day · Edge browser · sound on.

| Min | Show | Say |
|---|---|---|
| 0–1 | The plan table | "Every morning the LMS gives us who is due. Before dialling, the planner applies RBI rules, our policy and language routing. Look: the Tamil-speaking borrower goes to a Tamil agent; 41 days overdue goes to the human team." |
| 1–3 | **Run campaign** | "Saathi works the list: retries busy and no-answer calls later, never calls outside 8 am–7 pm, and updates the LMS after each call." Point at Paid ✓, Promise, Dispute open, Callback 9 pm. |
| 3–5 | Real-life call 2 (salary aane pe) | "Real Hinglish. It turns 'salary aane pe 5 tarikh' into a date, keeps it within policy, and schedules a WhatsApp reminder." |
| 5–6 | Real-life call 6 (wife answers) | "Privacy by design: no loan details to a third party. We just book a callback." |
| 6–7 | Real-life call 5 (hardship) | "No pressure. Empathy, options, and a warm transfer with a summary, so the specialist starts informed." |
| 7–8 | Clock → 7:30 pm | "Nobody can be called now. Compliance is enforced by code, not by training slides." |
| 8–9 | Live: call Ramesh, speak Hindi with 🎤, pay via WhatsApp | The wow moment. |
| 9–10 | Business case card | "With our numbers this is ₹X a month and N tele-caller seats freed for complex cases. Next step: a real-phone pilot (see the go-real plan)." |

**Likely questions**
- *Is it real AI?* The demo's understanding is rules-based so it runs anywhere. Milestone 4 adds an LLM classifier. Production adds speech-to-speech Hindi (Nova 2 Sonic) or Lex + Polly.
- *What about other languages?* Language routing is already in the planner. Add Tamil, Telugu and others with vernacular speech models.
- *How is this compliant?* Show `src/compliance.js` and the tests that prove no details are shared before verification and that threatening words are blocked.
