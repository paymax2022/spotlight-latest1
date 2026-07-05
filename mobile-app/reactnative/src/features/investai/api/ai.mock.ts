// ── Paymax Invest · AI Investment Education Assistant — Mock engine ───────────
// Deterministic, guardrailed canned responses so every UI state renders in mock
// mode. Implements the policy from docs/crypto/modules.md entirely client-side:
//  1. Detect advice-seeking / prediction / guarantee prompts → return REFUSAL.
//  2. Otherwise select a canned EDUCATIONAL explanation by keyword.
//  3. explainAsset(symbol) → neutral educational summary (no recommendation).
// Every assistant turn produced here carries disclaimer:true.

import { REFUSAL } from '../constants/ai.constants';
import type { AskContext } from '../types/ai.types';

/**
 * Phrases that signal a request for personalized advice, a price prediction, or
 * a guarantee — these are refused (Prohibited list in modules.md).
 */
const ADVICE_PATTERNS: RegExp[] = [
  /should i (buy|sell|invest|hold|put)/,
  /\bwhat should i (buy|invest|do)\b/,
  /\b(which|what)('?s| is)? (the )?(best|top) (stock|coin|crypto|asset|investment)/,
  /best (stock|coin|crypto|asset) to (buy|invest)/,
  /\b(will|is|are|gonna|going to) .*(go up|go down|moon|pump|dump|crash|rise|drop|rally)/,
  /\b(price|when) .*(prediction|predict|forecast|target|hit|reach)\b/,
  /\bhow (high|low|much) will .* (go|be|reach)\b/,
  /\bguarantee(d)?\b/,
  /\b(risk[- ]?free|sure thing|can'?t lose|no risk)\b/,
  /\b(double|triple|10x|100x|get rich)\b/,
  /\b(pump|moon)\b/,
  /\btell me what to (buy|invest|do)\b/,
  /\b(is|are) .* a good (buy|investment|time to buy)\b/,
];

/** A canned educational topic, keyed by the words that should surface it. */
interface Topic {
  keys: RegExp;
  answer: string;
}

const TOPICS: Topic[] = [
  {
    keys: /\bvolatil/,
    answer:
      'Volatility describes how much an asset\'s price moves over time. A highly ' +
      'volatile asset can swing sharply up or down within a single day, while a ' +
      'less volatile one tends to move more gradually. Volatility is a measure of ' +
      'price movement, not direction — it tells you nothing about whether a price ' +
      'will rise or fall. Higher volatility generally means a wider range of ' +
      'possible outcomes, which is one way people think about risk.',
  },
  {
    keys: /\bdiversif/,
    answer:
      'Diversification means spreading money across different assets so that no ' +
      'single one determines your whole outcome. The idea is that different ' +
      'holdings often behave differently, so a fall in one may be cushioned by ' +
      'others. Diversification can reduce the impact of any one asset, but it does ' +
      'not remove risk and cannot guarantee a gain or prevent a loss.',
  },
  {
    keys: /\bfee|\bspread|\bcost\b|\bcharge/,
    answer:
      'Investing usually involves several kinds of cost. Common ones include a ' +
      'platform or transaction fee, a spread (the gap between buy and sell prices), ' +
      'and — for crypto — a network fee paid to move assets on-chain. Fees reduce ' +
      'your net return, so it helps to understand them before you trade. In Paymax, ' +
      'fees are itemised on the quote screen before you confirm an order.',
  },
  {
    keys: /\bsettle|\bsettlement|\bclear(ing|ed)?\b/,
    answer:
      'Settlement is the process of finalising a trade — moving the asset to the ' +
      'buyer and the money to the seller so ownership officially changes hands. ' +
      'Different markets settle on different timelines: some assets settle almost ' +
      'instantly, while traditional securities may take a day or two. Until a trade ' +
      'settles, the transfer is agreed but not yet complete.',
  },
  {
    keys: /\bwhat (is|are) (a )?stock|\bstocks?\b|\bshare(s)?\b|\bequit/,
    answer:
      'A stock (or share) represents partial ownership in a company. If you own a ' +
      'share, you own a small slice of that business and may benefit if it grows, ' +
      'while also bearing the risk that its value falls. Share prices move with ' +
      'company performance, the wider economy, and investor sentiment. Owning ' +
      'shares is not a deposit and there is no guaranteed return.',
  },
  {
    keys: /\bwhat (is|are) (a )?crypto|\bcrypto|\bbitcoin\b|\bblockchain|\btoken\b|\bcoin(s)?\b/,
    answer:
      'A cryptocurrency is a digital asset that records ownership on a blockchain — ' +
      'a shared, decentralised ledger — rather than at a bank. Some, like Bitcoin, ' +
      'are used as a store of value; others power applications or aim to track a ' +
      'currency (stablecoins). Crypto can be highly volatile and is not a bank ' +
      'deposit, so it is not covered by deposit protection.',
  },
  {
    keys: /\brisk|\blose|\bloss|\bsafe(r|ty)?\b/,
    answer:
      'Risk in investing is the chance that an outcome differs from what you ' +
      'expected — including losing some or all of the money you put in. A useful ' +
      'way to think about it is to weigh how much you could lose against how much ' +
      'you could gain, over what time horizon, and whether you could cope if the ' +
      'value dropped. Generally, higher potential returns come with higher risk. ' +
      'No investment is risk-free, and past performance never guarantees future ' +
      'results.',
  },
  {
    keys: /\border|\bbuy how|\bhow.*(buy|sell|trade)|\bquote\b/,
    answer:
      'When you place an order in Paymax you first get a quote that shows the price, ' +
      'the spread, and every fee, plus how much asset you would receive. The quote ' +
      'is time-limited because prices move, so you confirm against that locked ' +
      'figure. After you confirm, the order processes and then settles. This ' +
      'explains how the flow works — it is not a suggestion to place any order.',
  },
  {
    keys: /\bemotion|\bfomo|\bpanic|\bdiscipline|\bgreed|\bfear\b/,
    answer:
      'Emotional trading — buying out of fear of missing out, or selling in a panic ' +
      'when prices drop — is a common pitfall. A more disciplined approach is to ' +
      'decide your plan in advance, understand the risks, and avoid reacting to ' +
      'short-term swings. Taking time before acting, rather than chasing fast ' +
      'moves, tends to support clearer decisions.',
  },
];

const GENERIC =
  'I\'m here to explain how investing works in plain terms — things like ' +
  'volatility, diversification, fees, settlement, risk, or what a stock or ' +
  'cryptocurrency is. I can also explain how orders and quotes work in the app. ' +
  'Tell me which topic you\'d like to understand and I\'ll walk you through it. ' +
  'I can\'t recommend specific assets or predict prices.';

/** True when the prompt is seeking advice / a prediction / a guarantee. */
export function isAdviceSeeking(prompt: string): boolean {
  const p = prompt.toLowerCase();
  return ADVICE_PATTERNS.some((re) => re.test(p));
}

/**
 * Produce the assistant's reply text for a prompt. Refuses advice-seeking
 * prompts (REFUSAL), otherwise returns the best-matching educational topic.
 */
export function answerFor(prompt: string, _context?: AskContext): string {
  if (isAdviceSeeking(prompt)) return REFUSAL;
  const p = prompt.toLowerCase();
  const topic = TOPICS.find((t) => t.keys.test(p));
  return topic ? topic.answer : GENERIC;
}

/** Neutral, educational summary for a single asset — never a recommendation. */
export function explainAssetFor(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return (
    `Here's a neutral overview of ${s}. ${s} is a digital asset that can be bought ` +
    `and sold on Paymax where it's enabled and you meet the eligibility checks. ` +
    `Like most crypto assets, its price can be volatile and move sharply in either ` +
    `direction, and it is not a bank deposit. Before trading, it helps to ` +
    `understand the asset's risk disclosure, the fees and spread shown on the ` +
    `quote, and how much you'd be comfortable risking. This is general education ` +
    `about ${s} — not a recommendation to buy, sell, or hold it.`
  );
}
