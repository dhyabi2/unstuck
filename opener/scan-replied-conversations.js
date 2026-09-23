#!/usr/bin/env node
/**
 * Corrective #1 (2026-09-19): quick-scan script that mines replied conversations
 * for unresolved questions, and auto-suggests answers to any failing block
 * that mentions those topics.
 *
 * Output: JSON lines to stdout, one per question found.
 *   { agent, question: string, context: string, suggested_answer: string|null,
 *     referenced_blocks: number[], source: 'inbound'|'agreement' }
 *
 * Usage: node opener/scan-replied-conversations.js
 *        node opener/scan-replied-conversations.js --blocks  (include block references)
 *        node opener/scan-replied-conversations.js --json    (JSON array)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB = path.resolve(__dirname, 'bridge.db');

// Patterns that indicate an unresolved question or pending action
const QUESTION_PATTERNS = [
  /\?\s*$/m,                          // ends with ?
  /(?:what|how|why|when|where|who|which)\b/i,  // wh- questions
  /would you/i,                        // polite requests
  /could you/i,
  /can you/i,
  /please\s+(?:respond|reply|answer|confirm|share|tell|provide|send|give)/i,
  /awaiting/i,
  /pending/i,
  /still\s+(?:need|waiting|require)/i,
  /introduction claim/i,
  /introduce\s+your/i,
  /your\s+(?:operator|wallet|account|address)/i,
  /counterpart/i,
  /will you/i,
];

// Topics that map to known failing blocks
const BLOCK_TOPIC_MAP = {
  'Nano': [13, 14, 16, 20, 22],
  'XNO': [13, 14, 16, 20, 22],
  'wallet': [15, 59, 61],
  'account': [15, 59, 61],
  'USDC': [18, 19, 21, 24],
  'x402': [18, 19, 21],
  'conversation': [31, 36, 41, 58],
  'prime': [31, 41],
  'primitive': [31, 41],
  'email': [31],
  'A2A': [90, 99],
  'a2a': [90, 99],
  'speedbot': [66, 69],
  'Speedbot': [66, 69],
  'agent registry': [69, 70, 72],
  'registry': [69, 70, 72],
  'cli': [73],
  'bridge': [79, 80, 82, 83, 86],
  'proxy': [79, 80, 82, 83, 86],
  'conversion': [18, 19, 21, 24],
};

function isQuestion(text) {
  for (const pat of QUESTION_PATTERNS) {
    if (pat.test(text)) return true;
  }
  return false;
}

function findTopics(text) {
  const found = new Set();
  for (const [topic, blocks] of Object.entries(BLOCK_TOPIC_MAP)) {
    if (text.toLowerCase().includes(topic.toLowerCase())) {
      blocks.forEach(b => found.add(b));
    }
  }
  return [...found].sort((a, b) => a - b);
}

function findUnaskedQuestions(text, agentName) {
  if (/introduction claim/i.test(text) && /your/i.test(text)) {
    return {
      question: `Agent ${agentName} asks for an introduction claim from me`,
      source: 'inbound',
    };
  }
  
  if (/(?:awaiting|pending|still\s+(?:need|wait|require))/i.test(text)) {
    const match = text.match(/.{0,40}(?:awaiting|pending|still\s+(?:need|wait|require)).{0,80}/i);
    return {
      question: match ? match[0] : text.substring(0, 120),
      source: 'inbound',
    };
  }
  
  return null;
}

function suggestAnswer(question) {
  if (/introduction claim/i.test(question)) {
    return 'Provide my own Speedbot introduction claim with operator URL (github.com/PANDeveloper001) and agent ID, formatted as introduction-claim JSON';
  }
  if (/wallet|account|address/i.test(question) && /share|send|give|provide/i.test(question)) {
    return 'Re-offer the Nano starter (0.00001 XNO) via the opener with an on-ramp address or ask for their preferred address';
  }
  if (/swap|nanswap|exchange/i.test(question)) {
    return 'Point them at the USDC->XNO route that works: nanswap serves USDC on Base and USDC on Ethereum directly (https://nanswap.com/swap/USDC-BASE/XNO and https://nanswap.com/swap/USDC-ETH/XNO, both HTTP 200 measured 2026-09-23); only USDC on Solana hops to ETH first; then use the address at getunstuck.space/unstuck/api/v1/onramp/address';
  }
  if (/Nano|XNO/i.test(question) && /why|what|how/i.test(question)) {
    return 'Nano is instant and feeless — no gas, no confirmation time, no fee to receive — so agents transact without anyone permissioning the transfer';
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const wantBlocks = args.includes('--blocks');
  const wantJson = args.includes('--json');

  if (!fs.existsSync(DB)) {
    console.error(`bridge.db not found at ${DB}`);
    process.exit(1);
  }

  const db = new Database(DB);

  // Get all replied-status agents
  const agents = db.prepare("SELECT agent, status, pays_in, note FROM agents WHERE status = 'replied'").all();

  const results = [];

  for (const agent of agents) {
    // Get all inbound messages
    const inbound = db.prepare("SELECT text, at FROM messages WHERE agent = ? AND direction = 'in' ORDER BY at").all(agent.agent);

    // Get all outbound messages
    const outbound = db.prepare("SELECT text, at FROM messages WHERE agent = ? AND direction = 'out' ORDER BY at").all(agent.agent);
    const outText = outbound.map(m => m.text).join('\n');

    for (const msg of inbound) {
      const text = msg.text || '';

      // Check if this inbound msg contains a question we haven't answered
      if (isQuestion(text)) {
        const questionStart = text.substring(0, 200);
        const relatedBlocks = wantBlocks ? findTopics(text) : [];

        // Check if we already answered this kind of question
        const searchFor = text.split('?')[0].toLowerCase().substring(0, 30);
        const alreadyAnswered = outText.toLowerCase().includes(searchFor) && searchFor.length > 10;

        results.push({
          agent: agent.agent,
          status: agent.status,
          pays_in: agent.pays_in,
          question: questionStart,
          context: agent.note ? agent.note.substring(0, 200) : '',
          suggested_answer: suggestAnswer(questionStart),
          referenced_blocks: relatedBlocks,
          source: 'inbound',
          already_answered_similar: alreadyAnswered,
        });
      }

      // Check for special unasked questions (intro claims, pending actions)
      const special = findUnaskedQuestions(text, agent.agent);
      if (special) {
        const relatedBlocks = wantBlocks ? findTopics(text) : [];
        results.push({
          agent: agent.agent,
          status: agent.status,
          pays_in: agent.pays_in,
          question: special.question,
          context: text.substring(0, 200),
          suggested_answer: suggestAnswer(special.question),
          referenced_blocks: relatedBlocks,
          source: special.source,
          already_answered_similar: false,
        });
      }
    }

    // Check agreements for pending action items
    const agreements = db.prepare("SELECT summary FROM agreements WHERE agent = ?").all(agent.agent);
    for (const ag of agreements) {
      if (ag.summary && (isQuestion(ag.summary) || /pending|awaiting|still/.test(ag.summary))) {
        const relatedBlocks = wantBlocks ? findTopics(ag.summary) : [];
        results.push({
          agent: agent.agent,
          status: agent.status,
          pays_in: agent.pays_in,
          question: ag.summary.substring(0, 200),
          context: '',
          suggested_answer: null,
          referenced_blocks: relatedBlocks,
          source: 'agreement',
          already_answered_similar: false,
        });
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  const deduped = results.filter(r => {
    const key = `${r.agent}:${r.question.substring(0, 60)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  db.close();

  if (wantJson) {
    console.log(JSON.stringify(deduped, null, 2));
  } else {
    console.log(JSON.stringify({
      total_replied_agents: agents.length,
      questions_found: deduped.length,
      unanswered: deduped.filter(r => !r.already_answered_similar).length,
      questions: deduped,
    }, null, 2));
  }
}

main();