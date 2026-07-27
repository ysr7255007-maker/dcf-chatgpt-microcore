/**
 * DCF Companion - Weekly Digest Reducer (Lens 3 backend)
 *
 * Aggregates a week's worth of observed events into a WeeklyDigest
 * projection consumed by the Reflection View via
 * GET /rpc/projection/weekly-digest.
 *
 * Zero runtime npm dependencies (project principle): the weekly schedule
 * uses a native timer check instead of a cron library — every hour we
 * check whether it is Sunday 03:00 local time and whether the digest for
 * the current ISO week has already been generated.
 *
 * Interface (plan 3.1):
 *   WeeklyDigest {
 *     week: string;               // ISO week, e.g. "2024-W30"
 *     totalMessages: number;
 *     topics: Array<{ name: string, percentage: number }>;
 *     keyDecisions: string[];
 *     sentimentTrend: 'positive' | 'neutral' | 'negative';
 *     highlights: Array<{ eventId: string, snippet: string, context: string }>;
 *   }
 */

'use strict';

/** Positive / negative keyword lexicons for the lightweight local
 *  sentiment heuristic (no external NLP service; local-first). */
const POSITIVE_WORDS = ['成功', '完成', '解决', '优秀', '喜欢', '感谢', 'great', 'good', 'thanks', 'done', 'works'];
const NEGATIVE_WORDS = ['失败', '错误', '问题', '崩溃', '糟糕', 'bug', 'error', 'fail', 'broken', 'crash'];

/** Decision phrase markers used to extract key decisions from messages. */
const DECISION_MARKERS = ['决定', '选择了', '采用', '确定用', 'decided to', 'we will use', 'going with'];

/**
 * ISO-8601 week string for a date, e.g. "2024-W30".
 * @param {Date} date
 * @returns {string}
 */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

/**
 * [start, end) timestamp range (ms) of an ISO week string.
 * @param {string} week - e.g. "2024-W30"
 * @returns {{startTs:number, endTs:number}|null}
 */
function getWeekRange(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return null;
  const year = Number(m[1]);
  const num = Number(m[2]);
  const simple = new Date(Date.UTC(year, 0, 1 + (num - 1) * 7));
  const dow = simple.getUTCDay();
  const monday = new Date(simple);
  monday.setUTCDate(simple.getUTCDate() - ((dow + 6) % 7) + (dow <= 4 ? 0 : 7));
  monday.setUTCHours(0, 0, 0, 0);
  const startTs = monday.getTime();
  return { startTs, endTs: startTs + 7 * 86400000 };
}

/**
 * Extract naive topic keywords from event texts (frequency of 2+ char
 * tokens, stop-word filtered). Returns the top N as percentage shares.
 * @param {Array<{text:string}>} events
 * @param {number} topN
 * @returns {Array<{name:string, percentage:number}>}
 */
function extractTopics(events, topN = 5) {
  const STOP = new Set(['这个', '那个', '我们', '你们', '什么', '怎么', '可以', '就是',
    'the', 'and', 'for', 'that', 'this', 'with', 'you', 'not', 'are', 'have']);
  const counts = new Map();
  for (const ev of events) {
    const tokens = String(ev.text || '').toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2 && !STOP.has(t));
    for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  const total = sorted.reduce((acc, [, c]) => acc + c, 0) || 1;
  return sorted.map(([name, c]) => ({ name, percentage: Math.round((c / total) * 100) }));
}

/**
 * Lexicon-based sentiment trend over all event texts.
 * @param {Array<{text:string}>} events
 * @returns {'positive'|'neutral'|'negative'}
 */
function analyzeSentiment(events) {
  let score = 0;
  for (const ev of events) {
    const text = String(ev.text || '').toLowerCase();
    for (const w of POSITIVE_WORDS) if (text.includes(w)) score += 1;
    for (const w of NEGATIVE_WORDS) if (text.includes(w)) score -= 1;
  }
  if (score > 2) return 'positive';
  if (score < -2) return 'negative';
  return 'neutral';
}

/**
 * Extract sentences containing decision markers as key decisions.
 * @param {Array<{text:string}>} events
 * @param {number} max
 * @returns {string[]}
 */
function extractKeyDecisions(events, max = 5) {
  const decisions = [];
  for (const ev of events) {
    const sentences = String(ev.text || '').split(/[。.!？?\n]+/);
    for (const s of sentences) {
      if (DECISION_MARKERS.some((mk) => s.includes(mk))) {
        const trimmed = s.trim().slice(0, 120);
        if (trimmed && !decisions.includes(trimmed)) decisions.push(trimmed);
        if (decisions.length >= max) return decisions;
      }
    }
  }
  return decisions;
}

/**
 * Pick highlight snippets: the longest messages of the week (proxy for
 * substance in the local-first MVP), truncated with context.
 * @param {Array<{id:string, text:string, ts:number}>} events
 * @param {number} max
 * @returns {Array<{eventId:string, snippet:string, context:string}>}
 */
function extractHighlights(events, max = 3) {
  return [...events]
    .filter((ev) => (ev.text || '').length > 40)
    .sort((a, b) => (b.text || '').length - (a.text || '').length)
    .slice(0, max)
    .map((ev) => ({
      eventId: ev.id,
      snippet: String(ev.text || '').slice(0, 140),
      context: new Date(ev.ts || Date.now()).toLocaleDateString('zh-CN') + ' 的对话'
    }));
}

/**
 * Build the WeeklyDigest projection for one ISO week.
 * @param {string} week - ISO week string.
 * @param {Array<{id:string, text:string, ts:number}>} events - Events within the week.
 * @returns {Object} WeeklyDigest
 */
function generateWeeklyDigest(week, events) {
  return {
    week,
    totalMessages: events.length,
    topics: extractTopics(events),
    keyDecisions: extractKeyDecisions(events),
    sentimentTrend: analyzeSentiment(events),
    highlights: extractHighlights(events)
  };
}

/**
 * Start the native weekly scheduler (Sunday 03:00 local, hourly check).
 * @param {Object} options
 * @param {(week:string)=>Promise<Array>} options.loadEventsForWeek - Event loader.
 * @param {(digest:Object)=>Promise<void>} options.saveDigest - Digest persister.
 * @param {()=>void} [options.onError]
 * @returns {NodeJS.Timeout} interval handle (unref'd)
 */
function startWeeklyDigestScheduler(options) {
  const generated = new Set();
  const timer = setInterval(async () => {
    const now = new Date();
    if (now.getDay() !== 0 || now.getHours() !== 3) return; // Sunday 03:xx only
    const week = getISOWeek(now);
    if (generated.has(week)) return;
    try {
      const events = await options.loadEventsForWeek(week);
      const digest = generateWeeklyDigest(week, events || []);
      await options.saveDigest(digest);
      generated.add(week);
    } catch (err) {
      if (options.onError) options.onError(err);
    }
  }, 60 * 60 * 1000);
  if (timer.unref) timer.unref(); // never keep the process alive on its own
  return timer;
}

module.exports = {
  getISOWeek,
  getWeekRange,
  extractTopics,
  analyzeSentiment,
  extractKeyDecisions,
  extractHighlights,
  generateWeeklyDigest,
  startWeeklyDigestScheduler
};
