import Link from 'next/link';
import SpotlightShell from '@/src/components/spotlight/SpotlightShell';
import { services, spotlightStats } from '@/src/data/services';
import { featuredPrograms, partnershipPathways } from '@/src/data/programs';

export const metadata = {
  title: 'Spotlight | National Creative Economy & Youth Empowerment Platform',
  description:
    'Spotlight is a media-powered youth empowerment platform for talent discovery, reality TV, music, film, STEM innovation, entrepreneurship, and strategic partnerships.',
};

const corePillars = [
  {
    title: 'Music & Entertainment',
    body: 'Discover and develop performers through auditions, bootcamps, competitions, and professional showcase pathways.',
    href: '/services/music-bootcamp-artist-development',
  },
  {
    title: 'Film Production & Creative Academy',
    body: 'Train creative professionals and produce high-quality media assets for audiences, partners, and institutions.',
    href: '/services/film-academy-production',
  },
  {
    title: 'STEM Innovation',
    body: 'Enable students and innovators to solve real problems and gain mentorship, visibility, and partnership opportunities.',
    href: '/services/stem-innovation-contest',
  },
  {
    title: 'SME Pitch & Entrepreneurship',
    body: 'Support founders with pitch visibility, investor readiness, mentorship, and market access pathways.',
    href: '/services/sme-pitch-entrepreneurship',
  },
  {
    title: 'Digital Content & Creator Economy',
    body: 'Activate creator-led campaigns that connect brands with youth audiences through measurable storytelling.',
    href: '/services/digital-content-influencer-campaigns',
  },
  {
    title: 'Government & Corporate Empowerment',
    body: 'Convert public and private empowerment goals into broadcast-ready, measurable youth impact programs.',
    href: '/services/government-youth-empowerment-programs',
  },
];

export default function SpotlightHomePage() {
  return (
    <SpotlightShell>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(212,168,67,0.2),transparent_45%)]" />
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-20 md:py-28 relative">
          <p className="section-label">National Empowerment Platform</p>
          <h1 className="font-display text-4xl md:text-7xl text-foreground mt-5 max-w-5xl">
            Empowering Africa&apos;s Next Generation of Creative, Innovative & Entrepreneurial Talent
          </h1>
          <p className="text-foreground/70 text-lg mt-6 max-w-4xl leading-relaxed">
            Spotlight is a creative empowerment and talent discovery platform built to identify, train, promote, and connect young talents across music, film, STEM, entrepreneurship, content creation, and entertainment through reality TV, bootcamps, competitions, media production, public voting, and strategic partnerships.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sponsors-partners" className="btn-primary text-xs py-3 px-6">Partner With Spotlight</Link>
            <Link href="/apply" className="btn-outline text-xs py-3 px-6">Apply / Register Now</Link>
            <Link href="/services" className="btn-outline text-xs py-3 px-6">Explore Our Services</Link>
            <Link href="/services/corporate-sponsorship-activation" className="btn-outline text-xs py-3 px-6">Sponsor a Program</Link>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8 grid grid-cols-1 md:grid-cols-5 gap-4">
        {[
          'Reality TV & talent development platform',
          'Music, film, STEM and entrepreneurship programs',
          'Sponsor-ready brand activation ecosystem',
          'National media and broadcast potential',
          'Youth empowerment and creative economy impact',
        ].map((item) => (
          <div key={item} className="glass-card rounded-md p-4 text-sm text-foreground/75">{item}</div>
        ))}
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-12">
        <h2 className="font-display text-3xl md:text-5xl text-foreground max-w-4xl">More Than a Talent Hunt — A Complete Creative Economy Empowerment Platform</h2>
        <p className="text-foreground/70 mt-5 leading-relaxed max-w-5xl">
          Spotlight combines entertainment, skills development, innovation, entrepreneurship, media visibility, sponsorship activation, and public engagement into one integrated empowerment system. For government and sponsors, it offers a visible and measurable platform to drive youth impact. For participants, it creates practical pathways from raw potential to opportunity.
        </p>
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        <h2 className="font-display text-3xl text-foreground">Core Pillars</h2>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          {corePillars.map((pillar) => (
            <Link key={pillar.title} href={pillar.href} className="glass-card rounded-md p-5 hover:border-gold transition-colors">
              <h3 className="text-foreground font-semibold">{pillar.title}</h3>
              <p className="text-sm text-foreground/65 mt-2">{pillar.body}</p>
              <p className="text-xs text-accent-gold mt-3">Explore Service</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <h2 className="font-display text-3xl text-foreground">Services Overview</h2>
          <Link href="/services" className="text-sm text-accent-gold">View All Services</Link>
        </div>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((service) => (
            <Link key={service.slug} href={`/services/${service.slug}`} className="glass-card rounded-md p-5 hover:border-gold transition-colors">
              <p className="text-xs text-foreground/50 uppercase tracking-wider">{service.category}</p>
              <h3 className="text-foreground font-semibold mt-1">{service.title}</h3>
              <p className="text-sm text-foreground/65 mt-2">{service.summary}</p>
              <p className="text-xs text-accent-gold mt-3">Learn More</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card rounded-md p-6">
          <h3 className="font-display text-2xl text-foreground">Why Government Should Partner With Spotlight</h3>
          <p className="text-sm text-foreground/70 mt-3 leading-relaxed">
            Spotlight offers ministries and agencies a practical platform for youth employment pathways, skills development, STEM advancement, entrepreneurship support, creative economy growth, and measurable public engagement backed by broadcast-ready storytelling.
          </p>
          <div className="mt-5 flex gap-3 flex-wrap">
            <Link href="/services/government-youth-empowerment-programs" className="btn-primary text-xs py-3 px-5">Explore Government Partnership</Link>
            <Link href="/contact" className="btn-outline text-xs py-3 px-5">Request Institutional Proposal</Link>
          </div>
        </div>
        <div className="glass-card rounded-md p-6">
          <h3 className="font-display text-2xl text-foreground">Why Sponsors Should Partner With Spotlight</h3>
          <p className="text-sm text-foreground/70 mt-3 leading-relaxed">
            Beyond visibility, Spotlight enables product integration, audience engagement, voting-driven participation, creator-led storytelling, campaign reporting, and youth market access through a media-powered activation ecosystem.
          </p>
          <div className="mt-5 flex gap-3 flex-wrap">
            <Link href="/services/corporate-sponsorship-activation" className="btn-primary text-xs py-3 px-5">Sponsor Spotlight</Link>
            <Link href="/contact" className="btn-outline text-xs py-3 px-5">Book Partnership Meeting</Link>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <h2 className="font-display text-3xl text-foreground">The Spotlight Ecosystem</h2>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="glass-card rounded-md p-5 text-foreground/70">Auditions → Bootcamp → Reality Show → Public Voting → Mentorship → Production → Promotion → Sponsorship → Career Opportunities</div>
          <div className="glass-card rounded-md p-5 text-foreground/70">Schools → STEM Contest → Innovation Showcase → Mentorship → Partnership/Funding Pathways</div>
          <div className="glass-card rounded-md p-5 text-foreground/70">SMEs → Pitch Contest → Business Training → Investor Exposure → Funding and Growth Pathway</div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {spotlightStats.map((stat) => (
          <div key={stat.label} className="glass-card rounded-md p-4 text-center">
            <p className="font-display text-3xl text-accent-gold">{stat.value}</p>
            <p className="text-xs text-foreground/60 mt-2">{stat.label}</p>
          </div>
        ))}
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <h2 className="font-display text-3xl text-foreground">Featured Programs</h2>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {featuredPrograms.map((program) => (
            <Link key={program.title} href={program.href} className="glass-card rounded-md p-5 hover:border-gold transition-colors">
              <h3 className="text-foreground font-semibold">{program.title}</h3>
              <p className="text-sm text-foreground/65 mt-2">{program.overview}</p>
              <p className="text-xs text-foreground/50 mt-2">For: {program.targetAudience}</p>
              <p className="text-xs text-accent-gold mt-2">{program.howItWorks}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <h2 className="font-display text-3xl text-foreground">Partnership Pathways</h2>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          {partnershipPathways.map((path) => (
            <Link key={path.title} href={path.href} className="glass-card rounded-md p-4 text-sm text-foreground/80 hover:border-gold transition-colors">
              {path.title}
            </Link>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-14">
        <div className="glass-card rounded-md p-8 md:p-12 text-center">
          <h2 className="font-display text-3xl md:text-5xl text-foreground max-w-4xl mx-auto">
            Let&apos;s Build Africa&apos;s Next Generation of Talent, Innovation and Creative Enterprise
          </h2>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/sponsors-partners" className="btn-primary text-xs py-3 px-6">Partner With Us</Link>
            <Link href="/apply" className="btn-outline text-xs py-3 px-6">Apply Now</Link>
            <Link href="/services/corporate-sponsorship-activation" className="btn-outline text-xs py-3 px-6">Sponsor a Program</Link>
            <Link href="/contact" className="btn-outline text-xs py-3 px-6">Contact Spotlight</Link>
          </div>
        </div>
      </section>
    </SpotlightShell>
  );
}
