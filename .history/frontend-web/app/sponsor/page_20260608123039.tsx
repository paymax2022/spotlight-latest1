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

const pillars = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
      </svg>
    ),
    badge: 'Reach',
    title: 'National Scale Audience',
    body: 'Multi-state coverage across on-ground auditions, live events, TV/radio broadcasts, and digital platforms reaching millions of engaged youth and their networks.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
      </svg>
    ),
    badge: 'Engagement',
    title: 'Deep Audience Interaction',
    body: 'Weekly participation loops through performances, public voting, branded tasks, and creator-led campaigns keep your brand top-of-mind throughout the season.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
      </svg>
    ),
    badge: 'Outcomes',
    title: 'Measurable ROI',
    body: 'Conversion-oriented programs with weekly reporting across acquisition, activation, data capture, app downloads, and sales. Full post-season ROI documentation.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    badge: 'Youth Impact',
    title: 'CSR & Brand Trust',
    body: 'Align your brand with youth empowerment, creative economy, STEM, and entrepreneurship narratives that earn authentic public trust and brand love across demographics.',
  },
];

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

export default function SponsorPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-[#f7f0e4] text-[#07371f]">
        <div className="absolute inset-y-0 left-0 w-full lg:w-[58%] bg-[radial-gradient(circle_at_18%_20%,rgba(255,255,255,0.82),transparent_42%),linear-gradient(90deg,#fbf6ea_0%,#f7f0e4_72%,rgba(247,240,228,0)_100%)]" />
        <div className="absolute inset-y-0 right-0 hidden lg:block w-[56%] overflow-hidden z-0">
          <img
            src="/assets/img/shape/sponsor.png"
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
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-16 md:py-20">
        <div className="max-w-2xl">
          <p className="text-accent-gold text-xs uppercase tracking-widest font-semibold">Why Spotlight</p>
          <h2 className="font-display text-4xl md:text-5xl text-foreground mt-3">
            A National Platform Built for Brand Performance
          </h2>
          <p className="text-foreground/60 mt-4 leading-relaxed">
            Spotlight is a media-powered youth engagement, talent discovery, and consumer activation platform — built end-to-end for measurable brand outcomes.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-5">
          {pillars.map((p) => (
            <div key={p.badge} className="group relative overflow-hidden rounded-xl border border-[rgba(245,240,232,0.07)] bg-[#161616] p-7 hover:border-[rgba(212,168,67,0.25)] transition-colors duration-300">
              <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[rgba(212,168,67,0.2)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 rounded-lg border border-[rgba(212,168,67,0.2)] bg-[rgba(212,168,67,0.06)] p-3 text-accent-gold">
                  {p.icon}
                </div>
                <div>
                  <p className="text-xs text-accent-gold uppercase tracking-widest font-semibold">{p.badge}</p>
                  <h3 className="text-foreground font-semibold text-lg mt-1">{p.title}</h3>
                  <p className="text-foreground/60 text-sm mt-2 leading-relaxed">{p.body}</p>
                </div>
              </div>
            </div>
          ))}
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
