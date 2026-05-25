import Link from 'next/link';

export default function SpotlightFooter() {
  return (
    <footer className="border-t border-border bg-bg-card mt-20">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <h3 className="font-display text-xl text-foreground">Spotlight</h3>
          <p className="text-sm text-foreground/60 mt-3 leading-relaxed">
            A national creative economy, youth empowerment, media production, talent discovery, and innovation platform.
          </p>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-foreground">Quick Links</h4>
          <div className="mt-3 flex flex-col gap-2 text-sm text-foreground/70">
            <Link href="/services">Services</Link>
            <Link href="/programs">Programs</Link>
            <Link href="/stem/contests">STEM Contests</Link>
            <Link href="/stem/schools/register">School Registration</Link>
            <Link href="/sponsors-partners">Sponsors & Partners</Link>
            <Link href="/impact">Impact</Link>
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-foreground">Strategic Action</h4>
          <div className="mt-3 flex flex-col gap-2 text-sm text-foreground/70">
            <Link href="/services/government-youth-empowerment-programs">Request Institutional Proposal</Link>
            <Link href="/services/corporate-sponsorship-activation">Sponsor a Program</Link>
            <Link href="/apply/reality-tv-show">Apply / Register</Link>
            <Link href="/contact">Book a Partnership Meeting</Link>
            <Link href="/admin" className="text-foreground/45 hover:text-foreground transition-colors">
              Admin Portal
            </Link>
          </div>
        </div>
      </div>
      <div className="border-t border-border py-4 px-4 md:px-8 text-xs text-foreground/40 text-center">
        © {new Date().getFullYear()} Spotlight. All rights reserved.
      </div>
    </footer>
  );
}
