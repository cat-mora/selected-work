const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let knowledgeCache = null;

function loadKnowledge() {
  if (knowledgeCache) return knowledgeCache;
  const dir = path.join(process.cwd(), 'api', 'knowledge');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  knowledgeCache = files
    .map(f => '# SOURCE FILE: ' + f + '\n\n' + fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n\n=====\n\n');
  return knowledgeCache;
}

// Compare in constant time. `!==` returns as soon as two bytes differ, which
// leaks the passcode's length and how much of a guess was correct. Hashing
// first gives both sides a fixed 32 bytes so timingSafeEqual cannot throw on a
// length mismatch.
function passcodeMatches(supplied, expected) {
  const a = crypto.createHash('sha256').update(String(supplied)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Per-instance rate limit. Serverless means several instances, so this is a
// ceiling per instance rather than a global one. It is not a substitute for a
// shared store, but it stops one caller emptying the Anthropic budget in a
// loop, which is what the endpoint allowed before.
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map();

function rateLimited(key) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);

  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (v.every(t => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

const BASE_INSTRUCTIONS = `[Advisory methodology and answer-format instructions redacted.
The original defines the adviser's role, the client context, and the required
shape of a SHORT answer versus a DETAIL answer, plus house style rules.]`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const expected = process.env.APP_PASSCODE;
  if (!expected) return res.status(500).json({ error: 'APP_PASSCODE not configured on the server' });
  if (!passcodeMatches(req.headers['x-passcode'] || '', expected)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const caller =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  if (rateLimited(caller)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests, wait a minute.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on the server' });

  const { question, mode, history } = req.body || {};
  if (!question || typeof question !== 'string' || question.length > 4000) {
    return res.status(400).json({ error: 'Missing or invalid question' });
  }

  const detail = mode === 'detail';
  const messages = [];
  if (Array.isArray(history)) {
    for (const m of history.slice(-6)) {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
        messages.push({ role: m.role, content: m.content.slice(0, 4000) });
      }
    }
  }
  messages.push({ role: 'user', content: (detail ? '[DETAIL mode] ' : '[SHORT mode] ') + question });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: detail ? 'claude-sonnet-5' : 'claude-haiku-4-5-20251001',
        max_tokens: detail ? 1200 : 500,
        system: [
          // Volatile instructions first and uncached; the large constant block
          // second and cached. Reversing these would defeat the caching.
          { type: 'text', text: BASE_INSTRUCTIONS },
          { type: 'text', text: 'PLAYBOOK KNOWLEDGE:\n\n' + loadKnowledge(), cache_control: { type: 'ephemeral' } }
        ],
        messages
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: (data.error && data.error.message) || 'Upstream error' });
    }
    const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return res.status(200).json({ answer });
  } catch (e) {
    return res.status(500).json({ error: 'Request failed: ' + e.message });
  }
};
