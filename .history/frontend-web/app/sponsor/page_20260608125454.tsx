import Layout from "@/components/layout/Layout";
import Link from "next/link";
import { activationExamples, sponsorCategories } from '@/src/data/websiteExpansion';

export const metadata = {
  title: 'Sponsor Spotlight Season 2 | Brand Partnership & Activation',
  description: 'Partner with Spotlight Season 2 and convert entertainment attention into customer acquisition, product activation, public trust, youth engagement, sales conversion, and measurable ROI.',
  alternates: { canonical: '/sponsor' },
  openGraph: {
    title: 'Sponsor Spotlight Season 2 | Brand Partnership & Activation',
    description: 'Partner with Spotlight Season 2 and convert entertainment attention into customer acquisition, product activation, public trust, youth engagement, sales conversion, and measurable ROI.',
    url: '/sponsor',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sponsor Spotlight Season 2 | Brand Partnership & Activation',
    description: 'Partner with Spotlight Season 2 and convert entertainment attention into customer acquisition, product activation, public trust, youth engagement, sales conversion, and measurable ROI.',
  },
};

const sponsorTiers = [
  {
    tier: 'Title Sponsor',
    tag: 'Exclusive · One Brand',
    color: '#D4A843',
    colorBg: 'rgba(212,168,67,0.06)',
    colorBorder: 'rgba(212,168,67,0.35)',
    perks: [
      'Full show naming rights',
      'Headline billing on all campaign materials',
      'Opening & closing sponsored segments every week',
      'Exclusive brand integration in bootcamp tasks',
      'Branded grand finale ownership',
      'Dedicated contestant ambassador programme',
      'Premium media package (TV · Radio · Digital)',
      'Bespoke campaign reporting and ROI dashboard',
    ],
  },
  {
    tier: 'Platinum Sponsor',
    tag: 'Up to 2 Brands',
    color: '#C0C0D0',
    colorBg: 'rgba(192,192,208,0.05)',
    colorBorder: 'rgba(192,192,208,0.3)',
    perks: [
      'Category exclusivity within your sector',
      'Weekly sponsored performance segment',
      'Voting-linked brand activation campaign',
      'Branded audition stage in 3+ states',
      'Contestant partnership storytelling',
      'Social media integration throughout season',
      'Product sampling at live events',
      'Mid-season + post-season ROI reports',
    ],
  },
  {
    tier: 'Gold Sponsor',
    tag: 'Up to 4 Brands',
    color: '#C8922A',
    colorBg: 'rgba(200,146,42,0.05)',
    colorBorder: 'rgba(200,146,42,0.25)',
    perks: [
      'Branded segment in select weekly episodes',
      'QR-code and app download campaign integration',
      'State-level audition activation (2 states)',
      'Fan engagement and voting-linked activation',
      'Social content pack and branded clips',
      'Product placement in bootcamp environment',
      'Post-season impact summary',
    ],
  },
  {
    tier: 'Category Sponsor',
    tag: 'Sector-Based Packages',
    color: '#7B8CE8',
    colorBg: 'rgba(123,140,232,0.05)',
    colorBorder: 'rgba(123,140,232,0.2)',
    perks: [
      'Single-category segment ownership',
      'Event-level brand activation',
      'Digital co-branding and mentions',
      'QR campaign or promo code integration',
      'Audience engagement package',
      'Activation summary report',
    ],
  },
];

const kpiRows = [
  ['Media Visibility', 'TV/radio mentions, branded segments, billboard reach'],
  ['Digital Reach', 'Impressions, video views, shares, follower growth'],
  ['Customer Acquisition', 'Sign-ups, app downloads, lead capture forms'],
  ['Product Activation', 'Sampling, demos, QR scan volumes, coupon redemptions'],
  ['Sales Engagement', 'Redemption codes, purchase campaigns, conversion tracking'],
  ['Voting-Linked Engagement', 'Fan participation volumes, sponsor-linked voting events'],
  ['Event Activation', 'Booth traffic, audience engagement, experiential metrics'],
  ['Content Assets', 'Branded clips, contestant content, social deliverables'],
  ['Post-Season Report', 'Full ROI summary with audience, conversion, and brand metrics'],
];

const snapshotRows: [string, string][] = [
  ['20-State Auditions', 'State-by-state activation and market access across Nigeria'],
  ['60 Contestants', 'Brand storytelling and contestant-led ambassador campaigns'],
  ['60-Day Bootcamp', 'Recurring product integration in a controlled, filmed environment'],
  ['Weekly Performances', 'Sponsored segments, branded moments, and fan engagement'],
  ['Public Voting', 'Repeated consumer interaction tied to your brand campaign'],
  ['Media Amplification', 'TV, radio, and social media reach throughout the season'],
  ['Live Events & Finale', 'Premium in-person product experience and brand visibility'],
  ['Post-Season Reporting', 'Documented ROI/impact insights and brand performance data'],
];

const brandPerformanceCards = [
  {
    icon: 'fa-solid fa-map-location-dot',
    title: '1. Nationwide Reach',
    body: 'Access audiences across TV, radio, digital, and on-ground activations.',
  },
  {
    icon: 'fa-solid fa-bullhorn',
    title: '2. Product Activation',
    body: 'Showcase products through experiential touchpoints, branded booths, and sponsored moments.',
  },
  {
    icon: 'fa-solid fa-store',
    title: '3. Sales at Activation Zones',
    body: 'Create conversion opportunities with on-site sales, sampling, and customer interaction zones.',
  },
  {
    icon: 'fa-solid fa-tower-broadcast',
    title: '4. TV, Radio & Digital Visibility',
    body: 'Gain exposure across DSTV Showcase Channel, NTA Network, State TV, FRCN, and social media.',
  },
  {
    icon: 'fa-solid fa-users',
    title: '5. Youth Market Penetration',
    body: 'Connect with young, culture-shaping Nigerian audiences through music, film, and live experiences.',
  },
  {
    icon: 'fa-solid fa-clapperboard',
    title: '6. Brand Content Integration',
    body: 'Feature your brand in episodes, digital content, backstage moments, and audience engagement campaigns.',
  },
];

const brandPerformanceMetrics = [
  ['fa-solid fa-location-dot', '20-State', 'Audition Tour'],
  ['fa-solid fa-star', '60', 'Contestants'],
  ['fa-solid fa-calendar-days', '60-Day', 'Bootcamp'],
  ['fa-solid fa-tv', 'Multi-Platform', 'Media Reach'],
  ['fa-solid fa-people-group', 'On-Ground', 'Activations'],
];

export default function SponsorPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-[#f7f0e4] text-[#07371f]">
        <div className="absolute inset-y-0 left-0 w-full lg:w-[58%] bg-[radial-gradient(circle_at_18%_20%,rgba(255,255,255,0.82),transparent_42%),linear-gradient(90deg,#fbf6ea_0%,#f7f0e4_72%,rgba(247,240,228,0)_100%)]" />
        <div className="absolute inset-y-0 right-0 hidden lg:block w-[56%] overflow-hidden z-0">
          <img
            src="/assets/img/shape/sponsor1.png"
            alt=""
            className="h-full w-[165%] max-w-none -translate-x-[35%] object-cover object-top"
          />
          <div className="absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-[#f7f0e4] via-[#f7f0e4]/85 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />
        </div>

        <div className="relative max-w-[1720px] mx-auto px-4 md:px-8 pt-14 md:pt-20 lg:pt-24 pb-8 md:pb-12">
          <div className="grid grid-cols-1 lg:grid-cols-[0.52fr_0.48fr] lg:min-h-[760px] items-start">
            <div className="relative z-10 max-w-3xl py-6 lg:py-10">
              <p className="text-[11px] md:text-xs uppercase tracking-[0.28em] text-[#b8871f] font-semibold">Sponsor Partnership · Season 2</p>
              <h1 className="font-display mt-4 text-[4rem] leading-[0.9] md:text-[6.8rem] lg:text-[7.8rem] text-[#06391f] max-w-3xl">
                Partner with Spotlight
              </h1>
              <div className="mt-5 h-px w-full max-w-xl bg-[#c99a2e]" />
              <p className="mt-5 font-display italic text-2xl md:text-3xl leading-tight text-[#123e2a] max-w-2xl">
                Powering Nigeria's Next Generation of Creative Stars.
              </p>
              <p className="mt-7 text-lg md:text-xl leading-relaxed text-[#1d2421] max-w-2xl">
                Spotlight is a proven creative-economy platform that discovers and elevates Nigerian talent, driving youth empowerment, national visibility, premium content production, and lasting cultural impact.
              </p>
              <div className="mt-9 flex flex-col sm:flex-row gap-4">
                <Link href="/media-room" className="inline-flex items-center justify-center rounded-md border border-[#c99a2e] bg-[#064024] px-6 py-4 text-sm font-bold text-[#f3cf72] shadow-[0_12px_28px_rgba(6,64,36,0.22)]">
                  Request Sponsorship Deck
                </Link>
                <Link href="/contact" className="inline-flex items-center justify-center rounded-md border border-[#c99a2e] bg-white/55 px-6 py-4 text-sm font-bold text-[#b07617]">
                  Become a Strategic Sponsor
                </Link>
              </div>
              <div className="mt-9 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
                {[
                  ['5,000+', 'Applications'],
                  ['45', 'Pilot Contestants'],
                  ['NTA & DSTV', 'Broadcast'],
                  ['4', 'Jobs Created'],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-md border border-[#ddcaa9] bg-white/70 px-4 py-5 text-center shadow-[0_10px_30px_rgba(38,23,8,0.08)]">
                    <p className="font-display text-3xl md:text-4xl leading-none text-[#06391f]">{value}</p>
                    <p className="mt-2 text-sm font-semibold text-[#28251f]">{label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative mt-8 lg:hidden rounded-md overflow-hidden min-h-[420px]">
              <img
                src="/assets/img/shape/sponsor.png"
                alt="Spotlight stage performance"
                className="absolute inset-0 h-full w-[165%] max-w-none -translate-x-[35%] object-cover object-top"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
            </div>
          </div>

          <div className="relative z-20 -mt-2 lg:-mt-28 mx-auto max-w-[1500px] rounded-xl border border-[#d3a23a] bg-[#00411f] px-5 py-6 shadow-[0_22px_50px_rgba(6,45,27,0.24)]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-[#d3a23a]/55">
              {[
                ['fa-solid fa-map-location-dot', 'Nationwide', 'Visibility'],
                ['fa-solid fa-tower-broadcast', 'TV, Radio &', 'Digital Reach'],
                ['fa-solid fa-bullhorn', 'Product', 'Activation'],
                ['fa-solid fa-landmark', 'Activation Zone', 'Sales'],
                ['fa-solid fa-users', 'Youth Market', 'Penetration'],
              ].map(([iconClass, lineOne, lineTwo]) => (
                <div key={`${lineOne}-${lineTwo}`} className="px-5 py-5 text-center text-white">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#d3a23a] bg-[#06391f] text-[#f2c767]">
                    <i className={`${iconClass} text-2xl`} aria-hidden="true" />
                  </div>
                  <p className="text-lg md:text-xl font-bold leading-tight">{lineOne}<br />{lineTwo}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── DIVIDER ── */}
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        <div className="h-px bg-gradient-to-r from-transparent via-[rgba(212,168,67,0.25)] to-transparent" />
      </div>

      {/* ── WHY PARTNER ── */}
      <section className="relative overflow-hidden bg-[#fbf5e9] px-4 md:px-8 py-16 md:py-20 text-[#0a3822]">
        <div className="pointer-events-none absolute inset-0 opacity-[0.08] bg-[radial-gradient(circle_at_8%_24%,#0a3822_0,transparent_24%),radial-gradient(circle_at_92%_16%,#0a3822_0,transparent_20%),radial-gradient(circle_at_88%_78%,#c9972a_0,transparent_24%)]" />
        <div className="relative mx-auto max-w-[1500px]">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mx-auto mb-5 flex max-w-sm items-center gap-3 text-[#c9972a]">
              <span className="h-px flex-1 bg-[#c9972a]" />
              <span className="font-display text-2xl leading-none">✥</span>
              <span className="h-px flex-1 bg-[#c9972a]" />
            </div>
            <h2 className="font-display text-4xl md:text-6xl lg:text-7xl leading-[0.98] text-[#07371f]">
            A National Platform Built for Brand Performance
            </h2>
            <div className="mx-auto mt-6 flex max-w-lg items-center gap-3 text-[#c9972a]">
              <span className="h-px flex-1 bg-[#d8b765]" />
              <span className="font-display text-xl leading-none">✥</span>
              <span className="h-px flex-1 bg-[#d8b765]" />
            </div>
            <p className="mx-auto mt-5 max-w-3xl text-lg md:text-xl leading-relaxed text-[#1f2b28]">
              Spotlight gives brands measurable visibility, audience engagement, and real-world activation opportunities across Nigeria.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-5">
            {brandPerformanceCards.map((card) => (
              <div key={card.title} className="rounded-xl border border-[#e2cfad] bg-white/78 p-6 shadow-[0_16px_34px_rgba(64,42,18,0.12)]">
                <div className="grid grid-cols-[88px_1fr] items-center gap-5">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-[#d5a13b] bg-[#04391f] text-[#f0c865] shadow-inner">
                    <i className={`${card.icon} text-3xl`} aria-hidden="true" />
                  </div>
                  <div className="border-l border-[#d6aa54] pl-5">
                    <h3 className="font-display text-xl md:text-2xl leading-tight text-[#102820]">{card.title}</h3>
                    <p className="mt-3 text-base leading-relaxed text-[#303530]">{card.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 grid grid-cols-1 xl:grid-cols-[1.45fr_0.85fr] gap-6 items-stretch">
            <div className="rounded-xl border border-[#d5a13b] bg-[#00411f] p-5 md:p-7 text-white shadow-[0_18px_38px_rgba(3,45,25,0.22)]">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 lg:divide-x divide-[#d5a13b]/55">
                {brandPerformanceMetrics.map(([iconClass, value, label]) => (
                  <div key={`${value}-${label}`} className="px-4 py-5 text-center">
                    <i className={`${iconClass} mb-3 text-4xl text-[#f0c865]`} aria-hidden="true" />
                    <p className="font-display text-3xl leading-none">{value}</p>
                    <p className="mt-2 text-lg font-semibold leading-tight">{label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-[#e0c48c] bg-white/78 p-7 text-center shadow-[0_16px_34px_rgba(64,42,18,0.12)]">
              <h3 className="font-display text-3xl md:text-4xl leading-tight text-[#07371f]">Ready to Activate With Spotlight?</h3>
              <div className="mx-auto mt-3 h-px w-40 bg-[#d5a13b]" />
              <div className="mt-6 flex flex-col sm:flex-row xl:flex-col gap-3 justify-center">
                <Link href="/media-room" className="inline-flex items-center justify-center rounded-md border border-[#d5a13b] bg-[#064024] px-5 py-3 text-sm font-bold text-[#f0c865]">
                  Request Sponsorship Deck
                </Link>
                <Link href="/contact" className="inline-flex items-center justify-center rounded-md border border-[#d5a13b] bg-white/70 px-5 py-3 text-sm font-bold text-[#b07617]">
                  Become a Sponsor
                </Link>
              </div>
              <p className="mt-5 text-sm leading-relaxed text-[#3a3934]">
                Custom sponsor packages available for banks, telecoms, FMCG, media, and lifestyle brands.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SEASON SNAPSHOT ── */}
      <section className="max-w-7xl mx-auto px-4 md:px-8 pb-16">
        <div className="rounded-2xl border border-[rgba(245,240,232,0.07)] bg-[#161616] overflow-hidden">
          <div className="px-7 py-6 border-b border-[rgba(245,240,232,0.07)] flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <p className="text-accent-gold text-xs uppercase tracking-widest font-semibold">Campaign Lifecycle</p>
              <h2 className="font-display text-3xl md:text-4xl text-foreground mt-2">Season 2 Sponsor Snapshot</h2>
            </div>
            <p className="text-foreground/50 text-sm max-w-xs">What sponsors plug into — from state auditions through to the grand finale.</p>
          </div>
          <div className="divide-y divide-[rgba(245,240,232,0.05)]">
            {snapshotRows.map(([asset, value], i) => (
              <div key={asset} className="grid grid-cols-1 md:grid-cols-2 gap-2 px-7 py-4 hover:bg-[rgba(212,168,67,0.02)] transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-accent-gold/50 w-5">{String(i + 1).padStart(2, '0')}</span>
                  <p className="text-foreground font-medium text-sm">{asset}</p>
                </div>
                <p className="text-foreground/55 text-sm pl-8 md:pl-0">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SPONSORSHIP TIERS ── */}
      <section id="tiers" className="relative overflow-hidden py-16 md:py-20">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[2px] bg-gradient-to-r from-transparent via-[rgba(212,168,67,0.2)] to-transparent" />
        </div>
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="text-center max-w-2xl mx-auto">
            <p className="text-accent-gold text-xs uppercase tracking-widest font-semibold">Sponsorship Tiers</p>
            <h2 className="font-display text-4xl md:text-5xl text-foreground mt-3">Choose Your Level of Ownership</h2>
            <p className="text-foreground/60 mt-4 leading-relaxed">
              Every tier is a campaign model. Pick the one aligned with your budget, market, and growth objectives — then we build around your outcomes.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-5">
            {sponsorTiers.map((tier) => (
              <div
                key={tier.tier}
                className="relative overflow-hidden rounded-2xl p-7"
                style={{ background: tier.colorBg, border: `1px solid ${tier.colorBorder}` }}
              >
                <div className="absolute top-0 right-0 w-48 h-48 rounded-full opacity-30" style={{ background: `radial-gradient(circle, ${tier.color}20, transparent 70%)` }} />
                <div className="relative">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h3 className="font-display text-2xl text-foreground">{tier.tier}</h3>
                      <span className="mt-1.5 inline-block rounded-full px-3 py-0.5 text-xs font-semibold" style={{ background: `${tier.color}15`, color: tier.color, border: `1px solid ${tier.color}30` }}>
                        {tier.tag}
                      </span>
                    </div>
                    <Link href="/contact" className="text-xs py-2.5 px-5 rounded-md border font-medium transition-colors" style={{ borderColor: `${tier.color}40`, color: tier.color }}>
                      Enquire
                    </Link>
                  </div>
                  <ul className="mt-6 space-y-2.5">
                    {tier.perks.map((perk) => (
                      <li key={perk} className="flex items-start gap-2.5 text-sm text-foreground/75">
                        <svg viewBox="0 0 16 16" fill="none" className="mt-0.5 flex-shrink-0 w-4 h-4" style={{ color: tier.color }}>
                          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.3" />
                          <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {perk}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-foreground/40 text-sm mt-8">
            All packages are custom-built around your brand objectives. <Link href="/contact" className="text-accent-gold hover:underline">Contact us to discuss a bespoke model.</Link>
          </p>
        </div>
      </section>

      {/* ── SPONSOR CATEGORIES ── */}
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-2">
            <p className="text-accent-gold text-xs uppercase tracking-widest font-semibold">Who Should Partner</p>
            <h2 className="font-display text-3xl md:text-4xl text-foreground mt-3">Sectors We Activate</h2>
            <p className="text-foreground/60 mt-4 leading-relaxed text-sm">
              From telcos to fintech, FMCG to government agencies — Spotlight's audience profile and campaign structure make it relevant across every major sector.
            </p>
            <Link href="/contact" className="mt-6 inline-block btn-primary text-xs py-3 px-6">Book Partnership Meeting</Link>
          </div>
          <div className="lg:col-span-3 flex flex-wrap gap-2.5">
            {sponsorCategories.map((cat) => (
              <span key={cat} className="rounded-full border border-[rgba(245,240,232,0.1)] bg-[rgba(245,240,232,0.03)] px-4 py-2 text-sm text-foreground/75 hover:border-[rgba(212,168,67,0.3)] hover:text-foreground/90 transition-colors cursor-default">
                {cat}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── ACTIVATION GRID ── */}
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-12">
        <div className="rounded-2xl border border-[rgba(245,240,232,0.07)] bg-[#161616] p-7 md:p-10">
          <p className="text-accent-gold text-xs uppercase tracking-widest font-semibold">How Your Brand Shows Up</p>
          <h2 className="font-display text-3xl md:text-4xl text-foreground mt-2">Activation Touchpoints</h2>
          <p className="text-foreground/60 mt-3 text-sm max-w-2xl">Every activation is designed to connect your brand with audience behaviour — not just eyeballs.</p>

          <div className="mt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {activationExamples.map((item, i) => (
              <div key={item} className="group relative overflow-hidden rounded-xl border border-[rgba(245,240,232,0.07)] bg-[rgba(245,240,232,0.02)] p-4 hover:border-[rgba(212,168,67,0.2)] transition-colors">
                <span className="text-xs font-mono text-foreground/25 block">{String(i + 1).padStart(2, '0')}</span>
                <p className="text-sm text-foreground/80 mt-1.5 group-hover:text-foreground transition-colors">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── KPI FRAMEWORK ── */}
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 items-start">
          <div>
            <p className="text-accent-gold text-xs uppercase tracking-widest font-semibold">Performance</p>
            <h2 className="font-display text-3xl md:text-4xl text-foreground mt-3">KPI Framework</h2>
            <p className="text-foreground/60 mt-4 leading-relaxed text-sm">
              We measure from awareness to conversion — so every sponsor gets a documented picture of impact, not just reach.
            </p>
          </div>
          <div className="lg:col-span-2 rounded-2xl border border-[rgba(245,240,232,0.07)] bg-[#161616] overflow-hidden">
            {kpiRows.map(([area, metric], i) => (
              <div key={area} className={`grid grid-cols-1 md:grid-cols-2 gap-1 px-6 py-4 ${i !== kpiRows.length - 1 ? 'border-b border-[rgba(245,240,232,0.05)]' : ''} hover:bg-[rgba(212,168,67,0.02)] transition-colors`}>
                <p className="text-foreground text-sm font-medium">{area}</p>
                <p className="text-foreground/50 text-sm">{metric}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OBJECTIVES TAG CLOUD ── */}
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-12">
        <div className="rounded-2xl border border-[rgba(212,168,67,0.15)] bg-[rgba(212,168,67,0.03)] p-7 md:p-10">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
            <div>
              <p className="text-accent-gold text-xs uppercase tracking-widest font-semibold">What You Get</p>
              <h2 className="font-display text-3xl text-foreground mt-2">Sponsor Objectives We Deliver</h2>
              <p className="text-foreground/55 text-sm mt-3 leading-relaxed">Tell us what outcome matters most — we'll build the activation model around it.</p>
            </div>
            <div className="lg:col-span-2 flex flex-wrap gap-2.5">
              {[
                'Customer Acquisition', 'Product Trial', 'App Downloads', 'Sales Conversion',
                'Lead Generation', 'Brand Trust', 'Youth Market Penetration', 'Social Media Engagement',
                'Community Activation', 'Data Capture', 'Loyalty and Advocacy', 'CSR / Youth Empowerment',
              ].map((obj) => (
                <span key={obj} className="rounded-full border border-[rgba(212,168,67,0.25)] bg-[rgba(212,168,67,0.05)] px-4 py-2 text-sm text-accent-gold/80">
                  {obj}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="max-w-7xl mx-auto px-4 md:px-8 pb-20">
        <div className="relative overflow-hidden rounded-2xl p-8 md:p-14 text-center" style={{ background: 'linear-gradient(135deg,rgba(212,168,67,0.08) 0%,rgba(56,75,255,0.06) 100%)', border: '1px solid rgba(212,168,67,0.2)' }}>
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[200px] rounded-full bg-[radial-gradient(ellipse,rgba(212,168,67,0.1),transparent_70%)]" />
            <div className="absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(56,75,255,0.08),transparent_70%)]" />
          </div>
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(212,168,67,0.35)] bg-[rgba(212,168,67,0.08)] px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-accent-gold mb-6">
              Let's Build Together
            </span>
            <h2 className="font-display text-4xl md:text-6xl text-foreground max-w-3xl mx-auto leading-tight">
              Build a Sponsor Model Around Your Business Objectives
            </h2>
            <p className="text-foreground/60 mt-5 max-w-xl mx-auto leading-relaxed">
              Share your target outcomes, budget direction, and timeline. We'll map a sponsor package designed specifically around your goals — no off-the-shelf templates.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <Link href="/contact" className="btn-primary text-xs py-3.5 px-8">Book a Partnership Meeting</Link>
              <Link href="/media-room" className="btn-outline text-xs py-3.5 px-8">Request Sponsorship Deck</Link>
            </div>
          </div>
        </div>
      </section>

    </Layout>
  );
}
