'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Person = {
  name: string;
  date: string;
  transactions: Array<[string, string, string, number, string]>;
};

type Payout = {
  id: string;
  date: string;
  amount: number;
  status: 'Processing' | 'Completed';
};

const people: Person[] = [
  {
    name: 'Amara Okafor',
    date: '2026-11-02',
    transactions: [
      ['UT-4821', 'Electricity', '2026-11-07', 1100, 'Credited'],
      ['UT-4716', 'Data', '2026-11-05', 650, 'Credited'],
      ['UT-4880', 'Cable TV', '2026-11-08', 800, 'Pending'],
    ],
  },
  {
    name: 'Tobi Adebayo',
    date: '2026-10-28',
    transactions: [
      ['UT-4508', 'Cable TV', '2026-11-01', 1900, 'Credited'],
      ['UT-4810', 'Electricity', '2026-11-06', 1200, 'Credited'],
    ],
  },
  {
    name: 'Zainab Bello',
    date: '2026-10-21',
    transactions: [
      ['UT-4302', 'Internet', '2026-10-29', 1600, 'Credited'],
      ['UT-4842', 'Internet', '2026-11-07', 1250, 'Pending'],
    ],
  },
  {
    name: 'Chinedu Eze',
    date: '2026-10-16',
    transactions: [
      ['UT-3980', 'Education', '2026-10-20', 2200, 'Credited'],
      ['UT-4417', 'Electricity', '2026-10-31', 1250, 'Credited'],
    ],
  },
  { name: 'Ifeoma Obi', date: '2026-11-08', transactions: [] },
];

const initialPayouts: Payout[] = [{ id: 'WD-1001', date: '2026-11-04', amount: 2500, status: 'Completed' }];
const STORAGE_KEY = 'spotlight-earn-demo-v1';
const code = 'SPOT-DEMO24';

function currency(value: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(value);
}

function day(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  }).format(new Date(date));
}

function rewards(transactions: Person['transactions'], status: string): number {
  return transactions.reduce((sum, transaction) => sum + (transaction[4] === status ? transaction[3] : 0), 0);
}

function readPayouts(): Payout[] {
  if (typeof window === 'undefined') return initialPayouts;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialPayouts;
    const entries = JSON.parse(raw) as Payout[];
    if (Array.isArray(entries) && entries.every((entry) => /^WD-\d+$/.test(entry.id) && Number.isSafeInteger(entry.amount) && entry.amount > 0 && Number.isFinite(Date.parse(entry.date)) && ['Processing', 'Completed'].includes(entry.status))) {
      return entries;
    }
  } catch {
    // ignore local storage issues
  }

  return initialPayouts;
}

export default function EarnLandingPage() {
  const [query, setQuery] = useState('');
  const [payouts, setPayouts] = useState<Payout[]>(initialPayouts);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [isPayoutOpen, setIsPayoutOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState('');
  const [amount, setAmount] = useState('');

  const allTransactions = useMemo(() => people.flatMap((person) => person.transactions), []);
  const credited = useMemo(() => rewards(allTransactions, 'Credited'), [allTransactions]);
  const pending = useMemo(() => rewards(allTransactions, 'Pending'), [allTransactions]);

  const availableBalance = useMemo(
    () => Math.max(0, credited - payouts.reduce((sum, payout) => sum + payout.amount, 0)),
    [credited, payouts]
  );

  const [inviteLink, setInviteLink] = useState(`https://www.spotlightng.com/earn?ref=${code}`);

  // localStorage and location.origin only exist in the browser; reading them
  // during the first render would mismatch the server HTML.
  useEffect(() => {
    setPayouts(readPayouts());
    setInviteLink(`${window.location.origin}/earn?ref=${code}`);
    if (new URLSearchParams(window.location.search).get('ref') === code) {
      setIsInviteOpen(true);
    }
  }, []);

  // Non-modal <dialog open> positions against the document, so it lands
  // off-screen once the reader has scrolled; modal dialogs stay in view.
  const showModal = useCallback((node: HTMLDialogElement | null) => {
    if (node && !node.open) node.showModal();
  }, []);

  const matches = useMemo(
    () => people.filter((person) => person.name.toLowerCase().includes(query.trim().toLowerCase())),
    [query]
  );

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedMessage(`${label} copied.`);
    } catch {
      setCopiedMessage(`${label} · ${value}`);
    }
  };

  const submitPayout = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextValue = Number(amount);
    if (!Number.isSafeInteger(nextValue) || nextValue < 1 || nextValue > availableBalance) return;

    const nextId = Math.max(...payouts.map((payout) => Number(payout.id.slice(3))), 1000) + 1;
    const nextPayouts = [{ id: `WD-${nextId}`, date: new Date().toISOString(), amount: nextValue, status: 'Processing' as const }, ...payouts];
    setPayouts(nextPayouts);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPayouts));
    }
    setIsPayoutOpen(false);
    setAmount('');
    setCopiedMessage(`Demo request WD-${nextId} recorded. ${currency(nextValue)} is reserved while processing.`);
  };

  const personSummary = (person: Person) => `${currency(rewards(person.transactions, 'Credited'))} credited · ${currency(rewards(person.transactions, 'Pending'))} pending`;

  return (
    <>
      <div className="spotlight-earn-page">
        <header>
          <div className="wrap nav">
            <a className="brand" href="https://www.spotlightng.com/" aria-label="Spotlight home">
              <svg aria-hidden="true" viewBox="0 0 48 54">
                <path fill="#efa97a" d="M7 3 43 13v14L18 39v-9l14-7-25-7V3Zm0 20 13 4v13l23-10v13L7 53V23Z" />
              </svg>
              <span>
                SPOTLIGHT <small>EARN</small>
              </span>
            </a>
            <nav aria-label="Dashboard">
              <a href="#overview">Overview</a>
              <a href="#referrals">Referrals</a>
              <a href="#withdrawals">Withdrawals</a>
            </nav>
            <span className="mode">
              <i /> Demo account
            </span>
          </div>
        </header>

        <main className="wrap">
          <section className="intro" id="overview">
            <div>
              <p className="kicker">SPOTLIGHT / REFERRAL REWARDS</p>
              <h1>Refer &amp; earn.</h1>
              <p className="muted">Invite people to Spotlight. Follow their eligible transactions and see what each one earned you.</p>
            </div>
            <a className="link" href="#guide">
              How it works ↓
            </a>
          </section>

          <section className="overview" aria-label="Earnings overview">
            <article className="balance">
              <span className="watermark" aria-hidden="true">
                ₦
              </span>
              <p className="kicker">01 / EARNINGS</p>
              <h2>Available to withdraw</h2>
              <strong className="figure">{currency(availableBalance)}</strong>
              <button className="primary" type="button" onClick={() => setIsPayoutOpen(true)} disabled={availableBalance < 1}>
                Withdraw earnings <span aria-hidden="true">→</span>
              </button>
              <p className="subtle">Sample balance in Nigerian naira</p>
            </article>

            <article className="invite">
              <p className="kicker">02 / INVITE</p>
              <h2>Your referral code</h2>
              <p className="muted">Share your personal invite link or ask friends to enter your code when they join.</p>
              <div className="code">
                <code>{code}</code>
                <button className="secondary" type="button" onClick={() => void copyText(code, 'Referral code')}>
                  Copy code
                </button>
              </div>
              <div className="invite-actions">
                <button className="secondary" type="button" onClick={() => void copyText(inviteLink, 'Invite link')}>
                  Copy invite link
                </button>
                <a
                  className="link"
                  href={`https://wa.me/?text=${encodeURIComponent('Try this Spotlight Earn demo invite: ' + inviteLink)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Share on WhatsApp ↗
                </a>
              </div>
              <p className="small muted" role="status">{copiedMessage || 'Sample code and link for this preview.'}</p>
            </article>
          </section>

          <section className="metrics" aria-label="Referral statistics">
            <div>
              <span>Total earned</span>
              <strong>{currency(credited)}</strong>
              <small>All credited rewards</small>
            </div>
            <div>
              <span>Pending rewards</span>
              <strong>{currency(pending)}</strong>
              <small>Awaiting settlement</small>
            </div>
            <div>
              <span>People referred</span>
              <strong>{people.length}</strong>
              <small>{people.filter((person) => person.transactions.length).length} with eligible activity</small>
            </div>
            <div>
              <span>Total withdrawn</span>
              <strong>{currency(payouts.filter((payout) => payout.status === 'Completed').reduce((sum, payout) => sum + payout.amount, 0))}</strong>
              <small>Completed payouts</small>
            </div>
          </section>

          <section className="panel" id="referrals">
            <div className="panel-head">
              <div>
                <p className="kicker">03 / REFERRAL ACTIVITY</p>
                <h2>Your referral ledger</h2>
                <p className="muted">Select a person to see the reward from each eligible transaction.</p>
              </div>
              <label className="search">
                <span>Find a referral</span>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" />
              </label>
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Person referred</th>
                    <th scope="col">Joined</th>
                    <th scope="col">Transactions</th>
                    <th scope="col">Credited</th>
                    <th scope="col">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((person) => (
                    <tr key={person.name}>
                      <td>
                        <button type="button" className="person" onClick={() => setSelectedPerson(person)}>
                          {person.name}
                        </button>
                      </td>
                      <td>{day(person.date)}</td>
                      <td>{String(person.transactions.length)}</td>
                      <td>{currency(rewards(person.transactions, 'Credited'))}</td>
                      <td>{currency(rewards(person.transactions, 'Pending'))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {matches.length === 0 && <p className="empty muted">No referrals match your search.</p>}
          </section>

          <section className="panel" id="withdrawals">
            <div className="panel-head">
              <div>
                <p className="kicker">04 / PAYOUTS</p>
                <h2>Withdrawal history</h2>
                <p className="muted">Track completed payouts and requests in progress.</p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Request</th>
                    <th scope="col">Date</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((payout) => (
                    <tr key={payout.id}>
                      <td>{payout.id}</td>
                      <td>{day(payout.date)}</td>
                      <td>{currency(payout.amount)}</td>
                      <td>
                        <span className={`tag ${['Completed', 'Credited'].includes(payout.status) ? 'credited' : ''}`}>{payout.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {copiedMessage && <p className="empty muted" role="status">{copiedMessage}</p>}
          </section>

          <section className="guide" id="guide">
            <p className="kicker">05 / THE BASICS</p>
            <h2>How referrals work</h2>
            <div>
              <article>
                <span>01</span>
                <h3>Share your code</h3>
                <p>Give friends your code or send your personal invite link.</p>
              </article>
              <article>
                <span>02</span>
                <h3>Track each reward</h3>
                <p>See eligible transactions and their rewards in your referral ledger.</p>
              </article>
              <article>
                <span>03</span>
                <h3>Request a payout</h3>
                <p>Review your available balance and track your withdrawal request.</p>
              </article>
            </div>
          </section>
        </main>

        <footer>
          <div className="wrap">
            <b>SPOTLIGHT / EARN</b>
            <span>Product preview · Sample data and simulated payouts</span>
            <a href="https://www.spotlightng.com/contact">Spotlight support</a>
          </div>
        </footer>

        {selectedPerson && (
          <dialog ref={showModal} aria-labelledby="person-name" onClose={() => setSelectedPerson(null)}>
            <form method="dialog" className="close-form">
              <button type="submit" aria-label="Close transaction details">
                ×
              </button>
            </form>
            <p className="kicker">REFERRAL / TRANSACTIONS</p>
            <h2 id="person-name">{selectedPerson.name}</h2>
            <p className="muted">{personSummary(selectedPerson)}</p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Transaction</th>
                    <th scope="col">Reward</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPerson.transactions.map(([id, service, date, amount, status]) => (
                    <tr key={id}>
                      <td>
                        {service} · {id} · {day(date)}
                      </td>
                      <td>{currency(amount)}</td>
                      <td>
                        <span className={`tag ${status === 'Credited' ? 'credited' : ''}`}>{status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!selectedPerson.transactions.length && <p className="empty muted">No eligible transactions yet.</p>}
          </dialog>
        )}

        {isPayoutOpen && (
          <dialog ref={showModal} aria-labelledby="payout-title" onClose={() => setIsPayoutOpen(false)}>
            <form method="dialog" className="close-form">
              <button type="submit" aria-label="Close withdrawal">
                ×
              </button>
            </form>
            <p className="kicker">WITHDRAWAL / DEMO</p>
            <h2 id="payout-title">Request a withdrawal</h2>
            <p className="muted">Test a payout using the sample balance. No money moves.</p>
            <form onSubmit={submitPayout}>
              <label>
                Amount in naira
                <input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" required min={1} step={1} max={availableBalance} />
              </label>
              <p className="small muted">Available for this demo request: {currency(availableBalance)}</p>
              <label>
                Destination
                <input value="Demo bank account •••• 2048" readOnly />
              </label>
              <button className="primary" type="submit">
                Submit demo request <span aria-hidden="true">→</span>
              </button>
            </form>
          </dialog>
        )}

        {isInviteOpen && (
          <dialog ref={showModal} aria-labelledby="invite-title" onClose={() => setIsInviteOpen(false)}>
            <form method="dialog" className="close-form">
              <button type="submit" aria-label="Close invite preview">
                ×
              </button>
            </form>
            <p className="kicker">SPOTLIGHT / INVITATION</p>
            <h2 id="invite-title">You’ve been invited.</h2>
            <p className="muted">Your demo referral code is {code}.</p>
            <p className="small muted">This preview does not register an account or attribute a live referral.</p>
            <a className="primary" href="https://www.spotlightng.com/">
              Explore Spotlight →
            </a>
          </dialog>
        )}
      </div>

      <style jsx global>{`
        :root {
          --paper: #f3f0eb;
          --surface: #fffcf7;
          --ink: #291f2c;
          --muted: #695e6d;
          --dark: #281b33;
          --deep: #33213f;
          --accent: #efa97a;
          --line: #dcd4de;
          --purple: #562c72;
        }

        * { box-sizing: border-box; }
        html { scroll-behavior: smooth; scroll-padding-top: 18px; }
        body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.55 system-ui, sans-serif; }
        a { color: inherit; text-decoration: none; }
        button, input { font: inherit; }
        button { cursor: pointer; }
        .spotlight-earn-page a:focus-visible,
        .spotlight-earn-page button:focus-visible,
        .spotlight-earn-page input:focus-visible,
        .spotlight-earn-page [tabindex]:focus-visible { outline: 3px solid #a067d3; outline-offset: 3px; }
        .spotlight-earn-page [hidden] { display: none !important; }
        .spotlight-earn-page h1, .spotlight-earn-page h2, .spotlight-earn-page h3, .spotlight-earn-page p { margin: 0; }
        .spotlight-earn-page .wrap { width: min(1200px, calc(100% - 90px)); margin-inline: auto; }
        .spotlight-earn-page header, .spotlight-earn-page footer { background: var(--dark); color: #fff6f2; }
        .spotlight-earn-page .nav, .spotlight-earn-page footer .wrap { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 72px; }
        .spotlight-earn-page .brand { display: flex; align-items: center; gap: 9px; font-weight: 850; letter-spacing: .02em; }
        .spotlight-earn-page .brand svg { width: 28px; height: 32px; }
        .spotlight-earn-page .brand small { font-size: 9px; letter-spacing: .17em; display: block; color: #edc8de; }
        .spotlight-earn-page .nav nav { display: flex; gap: 30px; font-size: 13px; color: #e5d8e9; }
        .spotlight-earn-page .nav nav a:hover { color: var(--accent); }
        .spotlight-earn-page .mode { font-size: 11px; white-space: nowrap; border: 1px solid #796686; padding: 6px 9px; border-radius: 5px; }
        .spotlight-earn-page .mode i { display: inline-block; background: var(--accent); width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; }
        .spotlight-earn-page .intro { display: flex; align-items: end; justify-content: space-between; gap: 20px; padding-block: 35px 27px; }
        .spotlight-earn-page .kicker { font-size: 10px; font-weight: 800; letter-spacing: .16em; color: #715477; }
        .spotlight-earn-page .intro h1 { font: 400 clamp(53px, 7vw, 93px)/.94 Georgia, serif; letter-spacing: -.075em; margin: 10px 0 12px; }
        .spotlight-earn-page .muted { color: var(--muted); font-size: 14px; }
        .spotlight-earn-page .link { color: var(--purple); font-size: 13px; font-weight: 720; text-decoration: underline; text-underline-offset: 4px; }
        .spotlight-earn-page .overview { display: grid; grid-template-columns: 1.18fr 1fr; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
        .spotlight-earn-page .overview article { padding: 24px 28px; min-width: 0; }
        .spotlight-earn-page .balance { position: relative; isolation: isolate; overflow: hidden; background: linear-gradient(115deg, var(--dark), var(--deep)); color: #fff8f1; }
        .spotlight-earn-page .balance .kicker { color: #e0b8d9; }
        .spotlight-earn-page .watermark { position: absolute; z-index: -1; right: -12px; bottom: -82px; font: 400 325px/.95 Georgia, serif; color: #ffffff0a; pointer-events: none; }
        .spotlight-earn-page .overview h2 { font-size: 22px; letter-spacing: -.035em; margin: 5px 0; }
        .spotlight-earn-page .balance h2 { font-size: 15px; font-weight: 600; color: #f1ddec; margin-top: 10px; }
        .spotlight-earn-page .figure { display: block; font: 400 clamp(42px, 6vw, 70px)/1.08 Georgia, serif; letter-spacing: -.055em; margin: 3px 0 14px; font-variant-numeric: tabular-nums; }
        .spotlight-earn-page .primary, .spotlight-earn-page .secondary { display: inline-flex; justify-content: space-between; align-items: center; gap: 16px; border: 1px solid transparent; border-radius: 5px; padding: 9px 13px; min-height: 42px; font-size: 13px; font-weight: 780; }
        .spotlight-earn-page .primary { background: var(--accent); color: #281933; }
        .spotlight-earn-page .primary:hover { background: #fac6a5; }
        .spotlight-earn-page .primary:disabled { opacity: 0.45; cursor: not-allowed; }
        .spotlight-earn-page .secondary { background: #f2eaf4; border-color: #dbccdf; color: var(--purple); }
        .spotlight-earn-page .secondary:hover { background: #e9daee; }
        .spotlight-earn-page .subtle, .spotlight-earn-page .small { font-size: 12px; margin-top: 9px; }
        .spotlight-earn-page .subtle { color: #e1cde5; }
        .spotlight-earn-page .invite { background: var(--surface); }
        .spotlight-earn-page .code { border: 1px dashed #bfaac8; background: #faf5f8; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 7px 7px 7px 12px; border-radius: 6px; margin-top: 14px; }
        .spotlight-earn-page .code code { font-size: 15px; letter-spacing: .06em; font-weight: 800; }
        .spotlight-earn-page .invite-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 9px; }
        .spotlight-earn-page .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 14px 0 24px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
        .spotlight-earn-page .metrics div { display: grid; gap: 2px; padding: 13px 17px; border-right: 1px solid var(--line); }
        .spotlight-earn-page .metrics div:last-child { border: 0; }
        .spotlight-earn-page .metrics span, .spotlight-earn-page .metrics small { color: var(--muted); font-size: 12px; }
        .spotlight-earn-page .metrics strong { font-size: clamp(19px, 3vw, 28px); letter-spacing: -.055em; font-variant-numeric: tabular-nums; }
        .spotlight-earn-page .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 9px; margin-bottom: 17px; overflow: hidden; }
        .spotlight-earn-page .panel-head { display: flex; align-items: end; justify-content: space-between; gap: 14px; padding: 18px 21px; }
        .spotlight-earn-page .panel h2, .spotlight-earn-page .guide h2, .spotlight-earn-page dialog h2 { font-size: 28px; letter-spacing: -.045em; line-height: 1.15; margin: 4px 0 6px; }
        .spotlight-earn-page label { display: grid; gap: 4px; font-weight: 720; font-size: 12px; }
        .spotlight-earn-page input { min-width: 0; width: 100%; min-height: 42px; padding: 8px 10px; border: 1px solid #b9a9c1; border-radius: 5px; background: white; color: var(--ink); }
        .spotlight-earn-page .table-scroll { overflow-x: auto; }
        .spotlight-earn-page table { width: 100%; border-collapse: collapse; text-align: left; white-space: nowrap; font-size: 13px; }
        .spotlight-earn-page th, .spotlight-earn-page td { padding: 11px 20px; border-top: 1px solid var(--line); }
        .spotlight-earn-page th { background: #f6f0f6; color: #62506b; font-size: 11px; }
        .spotlight-earn-page td { font-variant-numeric: tabular-nums; }
        .spotlight-earn-page .person { border: 0; padding: 4px 0; background: none; color: var(--purple); font-weight: 770; text-decoration: underline; text-underline-offset: 3px; }
        .spotlight-earn-page .tag { display: inline-block; background: #efe6f4; color: #602b74; border-radius: 4px; padding: 3px 6px; font-size: 11px; font-weight: 730; }
        .spotlight-earn-page .tag.credited { background: #e5eee4; color: #36553c; }
        .spotlight-earn-page .empty { padding: 10px 20px; }
        .spotlight-earn-page .guide { padding: 17px 0 32px; }
        .spotlight-earn-page .guide > div { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 15px; }
        .spotlight-earn-page .guide article { border-top: 1px solid #bdafc3; padding-top: 9px; }
        .spotlight-earn-page .guide article span { font-size: 11px; color: var(--purple); font-weight: 750; }
        .spotlight-earn-page .guide h3 { font-size: 16px; }
        .spotlight-earn-page .guide article p { color: var(--muted); font-size: 13px; margin-top: 4px; }
        .spotlight-earn-page footer { font-size: 12px; }
        .spotlight-earn-page footer a { text-decoration: underline; }
        .spotlight-earn-page dialog { width: min(620px, calc(100% - 26px)); max-height: calc(100dvh - 26px); border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); padding: 24px; }
        .spotlight-earn-page dialog::backdrop { background: #22132ed0; }
        .spotlight-earn-page dialog .table-scroll, .spotlight-earn-page dialog .primary { margin-top: 14px; }
        .spotlight-earn-page .close-form { position: absolute; top: 10px; right: 10px; }
        .spotlight-earn-page .close-form button { border: 1px solid var(--line); background: #f4ebf5; border-radius: 4px; min-width: 36px; min-height: 36px; font-size: 21px; line-height: 1; color: var(--ink); }

        @media (max-width: 780px) {
          .spotlight-earn-page .wrap { width: calc(100% - 36px); }
          .spotlight-earn-page .overview article { padding: 18px; }
          .spotlight-earn-page .metrics { grid-template-columns: repeat(2, 1fr); }
          .spotlight-earn-page .metrics div:nth-child(2) { border-right: 0; }
          .spotlight-earn-page .metrics div:nth-child(-n + 2) { border-bottom: 1px solid var(--line); }
        }

        @media (max-width: 560px) {
          .spotlight-earn-page .wrap { width: calc(100% - 26px); }
          .spotlight-earn-page .nav { min-height: 63px; }
          .spotlight-earn-page .nav nav { display: none; }
          .spotlight-earn-page .intro, .spotlight-earn-page .panel-head { align-items: start; flex-direction: column; gap: 10px; }
          .spotlight-earn-page .intro { padding-block: 24px 20px; }
          .spotlight-earn-page .overview, .spotlight-earn-page .guide > div { grid-template-columns: 1fr; }
          .spotlight-earn-page .search { width: 100%; }
          .spotlight-earn-page .panel-head { padding: 14px; }
          .spotlight-earn-page .guide > div { gap: 12px; }
          .spotlight-earn-page td, .spotlight-earn-page th { padding: 9px 12px; }
          .spotlight-earn-page footer .wrap { flex-wrap: wrap; padding-block: 12px; gap: 7px; }
          .spotlight-earn-page footer span { order: 3; flex-basis: 100%; }
        }

        @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
      `}</style>
    </>
  );
}
