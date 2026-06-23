import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHero({
  label,
  title,
  subtitle,
  ctas,
  heroImage,
}: {
  label?: string;
  title: string;
  subtitle: string;
  ctas?: { label: string; href: string; style?: 'primary' | 'outline' }[];
  heroImage?: { src: string; alt: string };
}) {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,75,255,0.16),transparent_45%)]" />
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-16 md:py-24 relative">
        <div className={heroImage ? 'grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center' : ''}>
          <div>
            {label ? <p className="section-label">{label}</p> : null}
            <h1 className="font-display text-4xl md:text-6xl text-foreground mt-4 max-w-5xl">{title}</h1>
            <p className="text-foreground/70 text-lg mt-5 max-w-4xl leading-relaxed">{subtitle}</p>
            {ctas?.length ? (
              <div className="mt-7 flex flex-wrap gap-3">
                {ctas.map((cta) => (
                  <Link key={cta.label} href={cta.href} className={cta.style === 'outline' ? 'btn-outline text-xs py-3 px-6' : 'btn-primary text-xs py-3 px-6'}>
                    {cta.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          {heroImage ? (
            <div className="relative">
              <img src={heroImage.src} alt={heroImage.alt} className="w-full h-auto rounded-md object-cover" />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="font-display text-3xl md:text-4xl text-foreground">{title}</h2>
      {description ? <p className="text-foreground/70 mt-3 max-w-4xl">{description}</p> : null}
    </div>
  );
}

export function CardGrid({ items }: { items: ReactNode[] }) {
  return (
    <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item, index) => (
        <div key={index} className="glass-card rounded-md p-5 text-sm text-foreground/80">
          {item}
        </div>
      ))}
    </div>
  );
}

export function TimelineSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
      {steps.map((step, index) => (
        <li key={step} className="glass-card rounded-md p-5">
          <p className="text-xs text-accent-gold">Step {index + 1}</p>
          <p className="text-foreground mt-1">{step}</p>
        </li>
      ))}
    </ol>
  );
}

export function JourneyRoadmap({ steps }: { steps: string[] }) {
  const pinColors = ['#f06292', '#fb8c00', '#8e7dff', '#1abc9c', '#e53935', '#4fc3f7'];
  const pinPositions = [
    { x: 12, y: 38, cardX: 6, cardY: 8, side: 'top' },
    { x: 27, y: 64, cardX: 20, cardY: 70, side: 'bottom' },
    { x: 43, y: 36, cardX: 37, cardY: 8, side: 'top' },
    { x: 59, y: 64, cardX: 53, cardY: 70, side: 'bottom' },
    { x: 75, y: 36, cardX: 69, cardY: 8, side: 'top' },
    { x: 89, y: 64, cardX: 82, cardY: 70, side: 'bottom' },
  ];

  return (
    <>
      <div className="mt-6 hidden md:block relative rounded-md border border-border/50 bg-[#efefef] p-5 overflow-hidden">
        <svg viewBox="0 0 1200 520" className="w-full h-auto" aria-hidden="true">
          <defs>
            <linearGradient id="roadFill" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#5f6368" />
              <stop offset="100%" stopColor="#2f3136" />
            </linearGradient>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" floodOpacity="0.25" />
            </filter>
          </defs>
          <path
            d="M45 205 C145 70, 245 70, 305 205 C365 340, 465 340, 525 205 C585 70, 685 70, 745 205 C805 340, 905 340, 965 205 C1025 70, 1115 70, 1155 210"
            stroke="url(#roadFill)"
            strokeWidth="82"
            fill="none"
            strokeLinecap="round"
            filter="url(#shadow)"
          />
          <polygon points="1120,165 1190,210 1120,255" fill="#2f3136" filter="url(#shadow)" />
          <path
            d="M45 205 C145 70, 245 70, 305 205 C365 340, 465 340, 525 205 C585 70, 685 70, 745 205 C805 340, 905 340, 965 205 C1025 70, 1115 70, 1155 210"
            stroke="#d8dadd"
            strokeWidth="6"
            fill="none"
            strokeDasharray="14 10"
            strokeLinecap="round"
          />
        </svg>

        {steps.slice(0, 6).map((step, index) => {
          const point = pinPositions[index];
          const color = pinColors[index];
          const connectorTop = point.side === 'top' ? `${point.cardY + 17}%` : `${point.y + 2}%`;
          const connectorHeight = point.side === 'top' ? '8%' : '6%';
          return (
            <div key={step}>
              <div
                className="absolute border-l border-dashed border-[#7f7f7f]/80"
                style={{ left: `${point.x}%`, top: connectorTop, height: connectorHeight }}
              />
              <div className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1" style={{ left: `${point.x}%`, top: `${point.y}%` }}>
                <div className="h-10 w-10 rounded-full bg-white border-[5px] text-black text-lg font-extrabold flex items-center justify-center shadow-sm" style={{ borderColor: color }}>
                  {index + 1}
                </div>
                <div
                  className="w-0 h-0 border-y-[10px] border-y-transparent border-l-[16px]"
                  style={{ borderLeftColor: color, transform: point.side === 'bottom' ? 'rotate(180deg)' : 'none' }}
                />
              </div>
              <div
                className="absolute w-52 rounded-xl border border-[#bfc4ca] bg-white/95 p-3"
                style={{ left: `${point.cardX}%`, top: `${point.cardY}%` }}
              >
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
                  Milestone {String(index + 1).padStart(2, '0')}
                </p>
                <p className="text-[12px] leading-4 text-[#3f3f3f] mt-1">{step}</p>
              </div>
            </div>
          );
        })}
      </div>

      <ol className="mt-6 grid grid-cols-1 gap-4 md:hidden">
        {steps.map((step, index) => (
          <li key={step} className="glass-card rounded-md p-5">
            <p className="text-xs uppercase tracking-wide text-accent-gold">Milestone {String(index + 1).padStart(2, '0')}</p>
            <p className="text-foreground mt-1">{step}</p>
          </li>
        ))}
      </ol>
    </>
  );
}

export function InfoTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mt-5 overflow-x-auto glass-card rounded-md p-2">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h) => (
              <th key={h} className="text-left px-3 py-3 text-foreground/70">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-b last:border-b-0 border-border/50">
              <td className="px-3 py-3 text-foreground">{row[0]}</td>
              <td className="px-3 py-3 text-foreground/75">{row[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CtaBand({ title, text, ctas }: { title: string; text?: string; ctas: { label: string; href: string }[] }) {
  return (
    <section className="max-w-7xl mx-auto px-4 md:px-8 py-6">
      <div className="glass-card rounded-md p-7 md:p-10">
        <h2 className="font-display text-2xl md:text-4xl text-foreground">{title}</h2>
        {text ? <p className="text-foreground/70 mt-3 max-w-4xl">{text}</p> : null}
        <div className="mt-6 flex flex-wrap gap-3">
          {ctas.map((cta, i) => (
            <Link key={cta.label} href={cta.href} className={i === 0 ? 'btn-primary text-xs py-3 px-6' : 'btn-outline text-xs py-3 px-6'}>
              {cta.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
