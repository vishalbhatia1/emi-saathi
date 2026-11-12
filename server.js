/**
 * server.js — the POC server. No npm installs needed (Node 18+).
 *
 *   npm start  ->  http://localhost:3100            simulator (browser)
 *   POST /api/understand   {text, ctx}             OPTIONAL LLM understanding (needs ANTHROPIC_API_KEY)
 *   POST /api/sessions     {borrowerId, nowMs?}    start a call session      } Conversation API: any channel
 *   POST /api/sessions/:id/turn {text|silence|hangup}  one borrower turn      } (Connect/Lex, Genesys bridge,
 *   GET  /api/plan?nowMs=                          today's calling plan      }  a phone gateway) can use it
 *
 * Env: PORT=3100  ANTHROPIC_API_KEY=...  ANTHROPIC_MODEL=claude-haiku-5-5
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const D = require('./src/data');
const agent = require('./src/agent');
const campaign = require('./src/campaign');
const llm = require('./src/llm');

const PORT = Number(process.env.PORT || 3100);
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const sessions = new Map();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.md': 'text/plain; charset=utf-8' };

function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { ok({}); } }); }); }

async function callLLM(text, ctx) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('ANTHROPIC_API_KEY not set on the server'); e.code = 503; throw e; }
  const { system, user } = llm.buildPrompt(text, ctx);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 300, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) { const e = new Error('Anthropic API ' + r.status); e.code = 502; throw e; }
  const j = await r.json();
  const textOut = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return llm.parseModelText(textOut);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/api/understand') {
      const { text, ctx } = await body(req);
      try { return send(res, 200, { result: await callLLM(String(text || '').slice(0, 500), ctx || {}), model: MODEL }); }
      catch (e) { return send(res, e.code || 500, { error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const { borrowerId, nowMs } = await body(req);
      const b = D.BORROWERS.find((x) => x.id === borrowerId); if (!b) return send(res, 404, { error: 'unknown borrower' });
      const s = agent.createSession(b, { nowMs }); const r = agent.start(s, { nowMs: nowMs || Date.now() });
      sessions.set(s.id, s); return send(res, 200, Object.assign({ id: s.id }, r));
    }
    const m = url.pathname.match(/^\/api\/sessions\/([\w-]+)\/turn$/);
    if (req.method === 'POST' && m) {
      const s = sessions.get(m[1]); if (!s) return send(res, 404, { error: 'unknown session' });
      const input = await body(req); const r = await agent.turn(s, input, { nowMs: input.nowMs || Date.now() });
      if (r.ended) setTimeout(() => sessions.delete(s.id), 3600000).unref();
      return send(res, 200, r);
    }
    if (req.method === 'GET' && url.pathname === '/api/plan') {
      const now = Number(url.searchParams.get('nowMs')) || Date.now();
      return send(res, 200, campaign.plan(now, {}).map((r) => ({ id: r.b.id, name: r.b.name, bucket: r.st.bucket, route: r.decision.route, ok: r.decision.ok, reason: r.decision.reason })));
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, llm: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL });
    // static files
    let p = decodeURIComponent(url.pathname); if (p === '/' ) { res.writeHead(302, { Location: '/simulator/' }); return res.end(); }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(__dirname, p));
    if (!file.startsWith(__dirname) || !/^(simulator|src|docs)$/.test(path.relative(__dirname, file).split(path.sep)[0])) { res.writeHead(404); return res.end('not found'); }
    fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(data); });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`\n  EMI Saathi POC  ->  http://localhost:${PORT}\n  LLM understanding: ${process.env.ANTHROPIC_API_KEY ? 'ON (' + MODEL + ')' : 'off (built-in rules; set ANTHROPIC_API_KEY to enable)'}\n  Ctrl+C to stop\n`));
}
module.exports = { server, callLLM };
