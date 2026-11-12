# Going real: phone calls, three options

The agent code is channel-independent. Pick the voice path that fits your platform and country.

## Option A: Amazon Connect + Amazon Lex + Lambda (fastest test, 1–2 days)
1. **Lambda:** zip `lambda/index.js` together with a `src/` folder containing all the `src/*.js` files. Upload it (Node.js 22). Test it with an event of `{ "sessionState": { "sessionAttributes": { "borrowerId": "B01" } } }`.
2. **Lex V2 bot:** one locale (English (India) to start), one intent `TalkToSaathi` with a few sample utterances, plus `CallComplete` and `TransferToAgent` intents. Point initialization, dialog and fallback code hooks at the Lambda. Build.
3. **Connect:** an outbound flow with *Set contact attributes* (`borrowerId`) → *Get customer input* (the Lex bot, passing `borrowerId` as a session attribute) → branch on `TransferToAgent` → queue. Use outbound campaigns, or *StartOutboundVoiceContact*, to dial a test number.
4. Check that `emi_disposition` and `emi_summary` appear in the contact attributes.

## Option B: Genesys Cloud outbound + Indian TSP trunk + speech-to-speech (India production path)
1. **Telephony:** a BYOC trunk from a licensed Indian operator through an SBC, presenting the **1600-series** caller ID.
2. **Outbound:** a Genesys campaign fed by the planner's list (who may be called now and why).
3. **Voice AI:** the Architect flow connects the answered call to the **Audio Connector** (WebSocket) → a small bridge service → **Amazon Nova 2 Sonic** (Hindi + English, code-switching). Nova Sonic **tool calls** map to this repo's agent tools (send link, PTP, ledger check, transfer).
4. **Transfers:** escalations return to Architect with output variables → queue + screen pop.

## Option C: Amazon Connect AI agents with Nova Sonic voices
Use Connect's agentic self-service (Nova Sonic speech-to-speech) and expose this repo's tools via Lambda/MCP: payment link, PTP, ledger check. The compliance rules stay in code and are called as tools or guardrails.

## Checklist before any real borrower is called
- [ ] Legal/Compliance sign-off on scripts, hours, consent, recording and retention (RBI directions effective 1 Jan 2027)
- [ ] 1600-series number and TSP/DLT registration
- [ ] Data residency review for speech/LLM services; PII masking in logs
- [ ] Pre-approved WhatsApp templates; payment-gateway webhooks
- [ ] Grievance officer details in every message
- [ ] Human queues staffed for hardship, disputes and bereavement
- [ ] Pilot: 5–10% of pre-due accounts first, compared against a holdout group
