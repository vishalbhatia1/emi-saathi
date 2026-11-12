/**
 * AWS Lambda for an Amazon Lex V2 bot used by Amazon Connect (outbound campaign or inbound callback).
 * Same agent as the simulator. Lex does speech <-> text; this function runs the conversation.
 *
 * Connect passes sessionAttributes.borrowerId (from the campaign's contact attributes).
 *  - first invocation (no state): returns the compliant opening line
 *  - each turn: ElicitIntent with the reply, until the call ends
 *  - end: Close with intent "CallComplete" or "TransferToAgent" and attributes emi_disposition, emi_queue, emi_summary
 * Package: zip this folder together with ../src (see docs/05-go-real.md, Option A).
 */
let agent;
try { agent = require('./src/agent'); } catch (e) { agent = require('../src/agent'); }
const D = (() => { try { return require('./src/data'); } catch (e) { return require('../src/data'); } })();

exports.handler = async (event) => {
  const attrs = Object.assign({}, (event.sessionState && event.sessionState.sessionAttributes) || {});
  const b = D.BORROWERS.find((x) => x.id === attrs.borrowerId);
  if (!b) return close(attrs, 'TransferToAgent', 'Connecting you to a colleague.', { emi_disposition: 'NO_BORROWER' });
  const nowMs = Date.now();
  let s; let r;
  if (!attrs.emi_session) { s = agent.createSession(b, { nowMs }); r = agent.start(s, { nowMs }); }
  else {
    s = JSON.parse(attrs.emi_session);
    const text = (event.inputTranscript || '').trim();
    r = await agent.turn(s, text ? { text } : { silence: true }, { nowMs });
  }
  s.transcript = s.transcript.slice(-6);
  console.log(JSON.stringify({ callId: s.id, borrower: b.id, state: s.state, events: r.events.filter((e) => e.layer !== 'say').map((e) => e.title) }));
  const msg = r.says.join(' ');
  if (r.ended) {
    const o = r.outcome; delete attrs.emi_session;
    return close(attrs, o.queue ? 'TransferToAgent' : 'CallComplete', msg, { emi_disposition: o.disposition, emi_queue: o.queue || '', emi_summary: (o.summary || '').slice(0, 500), emi_lang: s.lang });
  }
  attrs.emi_session = JSON.stringify(s);
  return { sessionState: { sessionAttributes: attrs, dialogAction: { type: 'ElicitIntent' } }, messages: [{ contentType: 'PlainText', content: msg }] };
};

function close(attrs, intent, msg, extra) {
  return { sessionState: { sessionAttributes: Object.assign({}, attrs, extra), dialogAction: { type: 'Close' }, intent: { name: intent, state: 'Fulfilled' } },
    messages: [{ contentType: 'PlainText', content: msg }] };
}
