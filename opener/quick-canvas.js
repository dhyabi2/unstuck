#!/usr/bin/env node
// quick-canvas.js — mines replied conversations for unresolved questions
// and auto-suggests answers to any failing block that mentions those topics
//
// Usage: node opener/quick-canvas.js [--blocks]
//   --blocks: also print failing blocks with matching keywords

const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, 'bridge.db');

// --- Failing block keywords extracted from ledger laws ---
const BLOCK_KEYWORDS = {
  4: ['find-agents', 'nano address', 'x402', '402 probing'],
  5: ['pursekeeper', 'nano address', 'opener db'],
  11: ['bridge', 'x402', 'usdc', 'payment'],
  12: ['ask', 'title', 'body', 'bounty', 'open-to-paid-to-closed'],
  13: ['ask lifecycle', 'api', 'post /ask', 'get /asks'],
  14: ['persist', 'sqlite', 'survive restart'],
  15: ['settlement', 'block hash', 'on-chain', 'standing'],
  16: ['network-settle', 'on-chain payment', 'block', 'bounty'],
  18: ['nanobazaar', 'nano address', 'relay', 'openable'],
  19: ['systemd', 'nserver-persist', 'auto-restart', '/health'],
  20: ['nanobazaar-discover', 'reached', 'json'],
  21: ['live db', 'persists', 'genuine asks', 'no test fixtures'],
  22: ['public ip', 'welcome ask', 'nanobazaar', '172.86.112.140'],
  24: ['post /ask/', 'answers', 'seeded answers', 'nano knowledge'],
  31: ['bridge invite', 'x402 proxied', 'usdc service', 'try-nano page'],
  36: [], // no matching laws found with keywords
  41: [], // no matching laws
  58: [], // no matching laws
  59: [], // no matching laws
  61: ['vercel.json', 'rewrite', '/unstuck/api', 'deployed origin'],
  64: ['deployer', 'commit sha', 'stamp', 'index.html'],
  66: ['live origin', 'head', 'working copy', 'placeholder'],
  69: ['usdc', 'settlement', 'conversion', 'shipped site'],
  70: ['opening message', 'disclosure', 'published as open research'],
  72: ['nano-only', 'site_nano_only', 'usdc bridge', 'swap'],
  73: ['agent.json', 'llms.txt', 'usdc', 'bridge tab'],
  79: ['on-ramp', 'python3', 'nano address', 'no pip'],
  80: ['on-ramp', 'tells agent', 'nano address', 'no library'],
  82: ['one http call', 'nano address', 'send.js', 'bad address'],
  83: ['ask census', 'classifies', 'publishes', 'outside'],
  86: ['vercel.json', 'rewrite', '/unstuck/api', 'commit stamp'],
  90: ['whiteclover', 'hearth', '280-character', 'post cap'],
  99: ['ad-hoc checker', 'test_spa_parse', 'retired'],
  108: ['on-ramp', 'no nano address', 'speedbot room', 'bridge record'],
  113: ['wallet-free', 'on-ramp check', 'negative controls'],
  115: ['site test', 'live origin', 'scratch server', 'local scratch'],
};

// --- Read bridge DB ---
function readBridge() {
  if (!fs.existsSync(dbPath)) {
    console.error('bridge.db not found at', dbPath);
    process.exit(1);
  }
  // sqlite3 CLI parsing, simplest reliable way
  const { execSync } = require('child_process');
  const raw = execSync(`sqlite3 "${dbPath}" "SELECT agent, status, note, last_at FROM agents ORDER BY last_at DESC"`, { encoding: 'utf8' });
  const lines = raw.trim().split('\n').filter(Boolean);
  const agents = [];
  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length >= 4) {
      agents.push({
        agent: parts[0],
        status: parts[1],
        note: parts[2],
        lastAt: parseFloat(parts[3]),
      });
    }
  }
  return agents;
}

// --- Get last messages for an agent ---
function getLastMessages(agentName) {
  const { execSync } = require('child_process');
  const raw = execSync(
    `sqlite3 "${dbPath}" "SELECT direction, text FROM messages WHERE agent = '${agentName.replace(/'/g, "''")}' ORDER BY at DESC LIMIT 3"`,
    { encoding: 'utf8' }
  );
  return raw.trim().split('\n').filter(Boolean).map(l => {
    const [dir, ...rest] = l.split('|');
    return { direction: dir, text: rest.join('|') };
  });
}

// --- Mine unresolved questions ---
function mineUnresolved(agents) {
  const replied = agents.filter(a => a.status === 'replied');
  const contacted = agents.filter(a => a.status === 'contacted' && a.lastAt);
  
  console.log('=== MINE: Unresolved questions from replied/contacted agents ===\n');
  
  const all = [...replied, ...contacted];
  const results = [];
  
  for (const a of all) {
    const msgs = getLastMessages(a.agent);
    if (msgs.length === 0) continue;
    
    // Find the last outbound (my question to them) and inbound (their reply)
    const lastIn = msgs.find(m => m.direction === 'in');
    const lastOut = msgs.find(m => m.direction === 'out');
    
    const question = lastOut ? lastOut.text.slice(0, 120) : '(no recent outbound)';
    const answer = lastIn ? lastIn.text.slice(0, 150) : '(no reply yet)';
    
    const entry = {
      agent: a.agent,
      status: a.status,
      quietHrs: a.lastAt ? ((Date.now()/1000 - a.lastAt) / 3600).toFixed(1) : '?',
      question,
      answer,
    };
    results.push(entry);
  }
  
  return results;
}

// --- Cross-reference with blocks ---
function crossReference(results) {
  const matched = [];
  for (const r of results) {
    const agentLower = r.agent.toLowerCase();
    const questionLower = (r.question + ' ' + r.answer).toLowerCase();
    
    for (const [blockNum, keywords] of Object.entries(BLOCK_KEYWORDS)) {
      if (!keywords.length) continue;
      for (const kw of keywords) {
        if (questionLower.includes(kw) || agentLower.includes(kw)) {
          matched.push({ agent: r.agent, block: parseInt(blockNum), keyword: kw });
          break;
        }
      }
    }
  }
  return matched;
}

// --- Suggest answers ---
function suggestAnswers(matched, results) {
  console.log('\n=== SUGGEST: Answers for failing blocks ===\n');
  const byBlock = {};
  for (const m of matched) {
    if (!byBlock[m.block]) byBlock[m.block] = [];
    byBlock[m.block].push(m.agent);
  }
  
  for (const [block, agents] of Object.entries(byBlock)) {
    console.log(`Block ${block}: mentioned by agents: ${agents.join(', ')}`);
    for (const agent of agents) {
      const r = results.find(rs => rs.agent === agent);
      if (r && r.answer !== '(no reply yet)') {
        console.log(`  From ${agent}: "${r.answer.slice(0, 200)}"`);
      }
    }
    console.log();
  }
  
  // Agents whose answers could help blocks but agent hasn't replied
  const unanswered = results.filter(r => r.answer === '(no reply yet)' && r.status !== 'declined');
  if (unanswered.length) {
    console.log('=== Agents still waiting on reply (potential to unblock when they answer) ===');
    for (const r of unanswered) {
      console.log(`  ${r.agent} (${r.status}, quiet ${r.quietHrs}h): "${r.question.slice(0, 100)}"`);
    }
  }
}

// --- Main ---
function main() {
  const agents = readBridge();
  const results = mineUnresolved(agents);
  
  console.log(`Total agents in DB: ${agents.length}`);
  console.log(`Replied: ${agents.filter(a => a.status === 'replied').length}`);
  console.log(`Contacted: ${agents.filter(a => a.status === 'contacted').length}`);
  console.log(`Swapped: ${agents.filter(a => a.status === 'swapped').length}`);
  console.log(`Transacting: ${agents.filter(a => a.status === 'transacting').length}`);
  console.log(`Declined: ${agents.filter(a => a.status === 'declined').length}`);
  console.log();
  
  for (const r of results) {
    console.log(`--- ${r.agent} (${r.status}, quiet ${r.quietHrs}h) ---`);
    console.log(`  Asked: ${r.question}`);
    console.log(`  Heard: ${r.answer}`);
    console.log();
  }
  
  const matched = crossReference(results);
  if (matched.length) {
    suggestAnswers(matched, results);
  } else {
    console.log('(No direct keyword cross-references found between agent conversations and failing blocks)');
  }
  
  // Write actionable suggestions
  console.log('\n=== ACTION: Next steps for each pending agent ===');
  for (const r of results) {
    if (r.status === 'replied' && r.answer !== '(no reply yet)') {
      console.log(`  ${r.agent}: WAITING — they replied, need to respond or advance. Last said: "${r.answer.slice(0, 100)}"`);
    } else if (r.status === 'contacted' && r.quietHrs > 24) {
      console.log(`  ${r.agent}: COLD (>24h) — may need re-approach or mark stale.`);
    }
  }
}

main();