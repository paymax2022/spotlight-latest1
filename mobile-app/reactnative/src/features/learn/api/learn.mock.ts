// ── Paymax Invest · Learn Center — Mock fixtures ─────────────────────────────
// Deterministic seed content so every Learn UI state renders in mock mode. Flip
// EXPO_PUBLIC_LEARN_USE_MOCK=false to hit the real Go endpoints (learn.api.ts).
// Content here is illustrative education copy only — never financial advice.

import { Colors } from '@/constants/colors';
import type {
  GlossaryTerm,
  Lesson,
  LearnPath,
  Quiz,
} from '../types/learn.types';

// ─── Lessons (the atomic units; ~8 across the tracks) ─────────────────────────

export const MOCK_LESSONS: Lesson[] = [
  // Beginner track
  {
    id: 'les_basics',
    pathId: 'path_beginner',
    title: 'What is investing?',
    durationMins: 4,
    kind: 'article',
    summary: 'Putting money to work so it can grow over time.',
    body:
      'Investing means committing money today in the hope that it grows into more money over time. Instead of leaving cash idle, you buy an asset — a share of a company, a bond, a fund, or a digital asset — that you expect to rise in value or pay you income.\n\n' +
      'The trade-off is risk. Prices move up and down, and there is no guarantee you get back what you put in. In exchange for accepting that uncertainty, investors aim to earn a return that beats simply holding cash, especially after inflation eats into spending power.\n\n' +
      'A useful mindset for beginners: invest only money you will not need soon, start small, and give your investments years rather than days. Time in the market, and the compounding it allows, does most of the heavy lifting.',
  },
  {
    id: 'les_risk_return',
    pathId: 'path_beginner',
    title: 'Risk and return',
    durationMins: 5,
    kind: 'article',
    summary: 'Higher potential returns come with higher risk.',
    body:
      'Every investment sits on a spectrum between safety and growth. Cash and government bonds are relatively stable but grow slowly. Stocks and crypto can grow faster, but their prices can also fall sharply.\n\n' +
      'This is the risk–return trade-off: there is no free lunch. If an asset promises high returns with no risk, treat it as a warning sign, not an opportunity.\n\n' +
      'Your job is to find a level of risk you can live with — one that lets you sleep at night and stay invested through the inevitable dips. Selling in a panic is how paper losses become real ones.',
  },
  {
    id: 'les_diversify',
    pathId: 'path_beginner',
    title: 'Why diversification matters',
    durationMins: 4,
    kind: 'article',
    summary: 'Don\'t put all your eggs in one basket.',
    body:
      'Diversification means spreading your money across different assets so that no single one can sink your whole portfolio. When one investment falls, another may hold steady or rise, smoothing out the ride.\n\n' +
      'A concentrated bet on one company or one coin can pay off spectacularly — or wipe you out. A diversified mix accepts slightly lower peak returns in exchange for far lower odds of disaster.\n\n' +
      'Funds and ETFs make diversification easy: a single purchase can give you exposure to hundreds of companies at once.',
  },
  // Stock track
  {
    id: 'les_what_is_stock',
    pathId: 'path_stock',
    title: 'What is a stock?',
    durationMins: 5,
    kind: 'article',
    summary: 'A share is part-ownership of a real business.',
    body:
      'A stock — also called a share or equity — is a slice of ownership in a company. Own one share of a business with a million shares and you own one-millionth of it, including a claim on its future profits.\n\n' +
      'Shareholders can earn money two ways: the share price rising over time (capital growth), and dividends, which are cash payments some companies make from their profits.\n\n' +
      'Because you own part of a real business, a stock\'s long-term value follows that business\'s fortunes. Strong, growing companies tend to reward patient shareholders; struggling ones can destroy value.',
  },
  {
    id: 'les_read_quote',
    pathId: 'path_stock',
    title: 'Reading a stock quote',
    durationMins: 6,
    kind: 'video',
    summary: 'Price, change, market cap and volume explained.',
    body:
      'A stock quote packs a lot into a few numbers. The price is what one share last traded for. The change (often shown as a percentage) tells you how much it moved today.\n\n' +
      'Market capitalisation — price multiplied by the number of shares — measures the whole company\'s value, and helps you compare a small firm to a giant. Volume shows how many shares changed hands; high volume means lots of interest and easier buying and selling.\n\n' +
      'Watch ratios like the price-to-earnings (P/E) figure to gauge whether a stock looks cheap or expensive relative to its profits — but never rely on a single number in isolation.',
  },
  // Crypto track
  {
    id: 'les_crypto_basics',
    pathId: 'path_crypto',
    title: 'How crypto works',
    durationMins: 6,
    kind: 'article',
    summary: 'Digital assets recorded on a shared, public ledger.',
    body:
      'Cryptocurrencies are digital assets recorded on a blockchain — a shared ledger maintained by a network of computers rather than a single bank. Once a transaction is confirmed, it is extremely hard to reverse or fake.\n\n' +
      'Bitcoin pioneered the idea as a fixed-supply digital money. Others, like Ethereum, added programmable contracts that power apps and tokens. Stablecoins aim to track a currency such as the US dollar.\n\n' +
      'Crypto is open and fast-moving, but it is also young, lightly regulated in many places, and notoriously volatile. Treat it as a high-risk slice of a wider portfolio, not the whole thing.',
  },
  {
    id: 'les_crypto_safety',
    pathId: 'path_crypto',
    title: 'Staying safe with crypto',
    durationMins: 5,
    kind: 'article',
    summary: 'Protect your keys, double-check addresses, ignore hype.',
    body:
      'Crypto puts you in control of your money — which also makes you the last line of defence. There is rarely a hotline to reverse a mistaken transfer or a scam.\n\n' +
      'Always double-check the destination address before sending, because transactions cannot be undone. Never share your recovery phrase or private keys, and be deeply sceptical of anyone promising guaranteed returns or "free" coins.\n\n' +
      'Start with small amounts on trusted, regulated platforms, enable every security feature available, and never invest money you cannot afford to lose entirely.',
  },
  // Wealth track
  {
    id: 'les_goals',
    pathId: 'path_wealth',
    title: 'Setting wealth goals',
    durationMins: 4,
    kind: 'article',
    summary: 'Match each goal to a timeframe and a strategy.',
    body:
      'Wealth-building works best when it is tied to clear goals: an emergency fund, a house deposit, a child\'s education, retirement. Each goal has its own timeframe, and the timeframe should shape the strategy.\n\n' +
      'Short-term goals (under three years) favour safer, more stable choices, because you cannot afford a big dip just before you need the money. Long-term goals can take more risk, since time gives markets room to recover and compound.\n\n' +
      'Write your goals down, attach a number and a date to each, and automate regular contributions. Consistency beats timing the market.',
  },
  {
    id: 'les_compounding',
    pathId: 'path_wealth',
    title: 'The power of compounding',
    durationMins: 5,
    kind: 'article',
    summary: 'Earning returns on your past returns.',
    body:
      'Compounding is what happens when your returns start earning returns of their own. Reinvest the growth and income from your investments, and the base they grow from gets larger every year — quietly at first, then dramatically.\n\n' +
      'A modest sum invested early can outgrow a much larger sum invested late, purely because it had more time to compound. This is why starting now, even with a little, matters so much.\n\n' +
      'The flip side: fees and frequent trading compound against you too. Keep costs low, stay invested, and let time do the work.',
  },
];

// ─── Paths (the curated tracks) ───────────────────────────────────────────────

export const MOCK_PATHS: LearnPath[] = [
  {
    id: 'path_beginner',
    title: 'Investing basics',
    description: 'Start here. The core ideas behind growing your money, with no jargon.',
    iconColor: Colors.teal,
    level: 'beginner',
    lessonIds: ['les_basics', 'les_risk_return', 'les_diversify'],
    progressPct: 33,
  },
  {
    id: 'path_stock',
    title: 'Understanding stocks',
    description: 'What shares are, how to read a quote, and what moves prices.',
    iconColor: Colors.secondary,
    level: 'stock',
    lessonIds: ['les_what_is_stock', 'les_read_quote'],
    progressPct: 0,
  },
  {
    id: 'path_crypto',
    title: 'Crypto fundamentals',
    description: 'How digital assets work and how to stay safe before you trade.',
    iconColor: Colors.primary,
    level: 'crypto',
    lessonIds: ['les_crypto_basics', 'les_crypto_safety'],
    progressPct: 50,
  },
  {
    id: 'path_wealth',
    title: 'Spotlight Wealth',
    description: 'Build a long-term plan: goals, compounding, and staying the course.',
    iconColor: Colors.gold,
    level: 'wealth',
    lessonIds: ['les_goals', 'les_compounding'],
    progressPct: 0,
  },
];

// ─── Quizzes (knowledge checks; 2 across the content) ─────────────────────────

export const MOCK_QUIZZES: Quiz[] = [
  {
    id: 'quiz_basics',
    lessonId: 'les_basics',
    questions: [
      {
        id: 'q1',
        prompt: 'What is the main reason people invest rather than hold cash?',
        options: [
          { id: 'a', label: 'To guarantee they never lose money', correct: false },
          { id: 'b', label: 'To aim for growth that beats cash, especially after inflation', correct: true },
          { id: 'c', label: 'Because cash is illegal to hold', correct: false },
          { id: 'd', label: 'To avoid ever paying any fees', correct: false },
        ],
      },
      {
        id: 'q2',
        prompt: 'Which mindset suits a beginner investor best?',
        options: [
          { id: 'a', label: 'Invest money you need next week for quick gains', correct: false },
          { id: 'b', label: 'Borrow heavily to maximise returns', correct: false },
          { id: 'c', label: 'Start small and invest for the long term', correct: true },
          { id: 'd', label: 'Check prices every hour and trade often', correct: false },
        ],
      },
      {
        id: 'q3',
        prompt: 'What is the trade-off for the chance of higher returns?',
        options: [
          { id: 'a', label: 'Accepting more risk', correct: true },
          { id: 'b', label: 'Paying no tax', correct: false },
          { id: 'c', label: 'Getting guaranteed income', correct: false },
          { id: 'd', label: 'Lower volatility', correct: false },
        ],
      },
    ],
  },
  {
    id: 'quiz_crypto',
    lessonId: 'les_crypto_basics',
    questions: [
      {
        id: 'q1',
        prompt: 'What records cryptocurrency transactions?',
        options: [
          { id: 'a', label: 'A single central bank', correct: false },
          { id: 'b', label: 'A blockchain maintained by a network', correct: true },
          { id: 'c', label: 'A government spreadsheet', correct: false },
          { id: 'd', label: 'Nobody — they are not recorded', correct: false },
        ],
      },
      {
        id: 'q2',
        prompt: 'How should most people treat crypto in a portfolio?',
        options: [
          { id: 'a', label: 'As a risk-free savings account', correct: false },
          { id: 'b', label: 'As the only thing they own', correct: false },
          { id: 'c', label: 'As a small, high-risk slice of a wider mix', correct: true },
          { id: 'd', label: 'As a guaranteed way to get rich', correct: false },
        ],
      },
    ],
  },
];

// ─── Glossary (~15 plain-English terms) ───────────────────────────────────────

export const MOCK_GLOSSARY: GlossaryTerm[] = [
  { term: 'Asset', definition: 'Anything you own that has value and may grow or earn income, such as a stock, bond, fund, or crypto.' },
  { term: 'Bear market', definition: 'A prolonged period of falling prices, usually a drop of 20% or more from recent highs.' },
  { term: 'Bull market', definition: 'A prolonged period of rising prices and general optimism.' },
  { term: 'Blockchain', definition: 'A shared, tamper-resistant digital ledger that records crypto transactions across a network of computers.' },
  { term: 'Bond', definition: 'A loan you make to a government or company that pays interest and returns the principal at maturity.' },
  { term: 'Compounding', definition: 'Earning returns on both your original money and the returns it has already generated.' },
  { term: 'Diversification', definition: 'Spreading money across different assets so no single one can sink your portfolio.' },
  { term: 'Dividend', definition: 'A cash payment some companies make to shareholders out of their profits.' },
  { term: 'ETF', definition: 'An exchange-traded fund — a basket of assets you can buy as a single, tradable investment.' },
  { term: 'Inflation', definition: 'The gradual rise in prices over time, which erodes the spending power of cash.' },
  { term: 'Liquidity', definition: 'How easily an asset can be bought or sold without moving its price.' },
  { term: 'Market cap', definition: 'The total value of a company or crypto: its price multiplied by the number of units outstanding.' },
  { term: 'Portfolio', definition: 'The full collection of investments a person or institution holds.' },
  { term: 'Volatility', definition: 'How much and how quickly a price moves up and down; higher volatility means a bumpier ride.' },
  { term: 'Yield', definition: 'The income an investment produces, expressed as a percentage of its price.' },
];
