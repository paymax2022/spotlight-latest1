import type { ReactNode } from 'react';
import Link from 'next/link';
import { LOGO, footerLinks } from './content';

/** `footerLinks` mixes routes with `#section`, mailto and tel targets, and only
 *  the first of those belongs to next/link. */
function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith('/')) return <Link href={href}>{children}</Link>;
  return <a href={href}>{children}</a>;
}

export default function LandingFooter() {
  return (
    <footer className="footer">
      <div className="wrap footer-main">
        <div>
          <a className="brand" href="#top" aria-label="Spotlight home">
            <img src={LOGO} alt="Spotlight" width={200} height={72} />
          </a>
          <p>
            Talent. Opportunity. Possibility.
            <br />
            A platform for Nigeria’s next generation.
          </p>
        </div>
        <div>
          <p className="footer-label">EXPLORE</p>
          {footerLinks.explore.map((link) => (
            <FooterLink key={link.label} href={link.href}>
              {link.label}
            </FooterLink>
          ))}
        </div>
        <div>
          <p className="footer-label">CONNECT</p>
          {footerLinks.connect.map((link) => (
            <FooterLink key={link.label} href={link.href}>
              {link.label}
            </FooterLink>
          ))}
        </div>
      </div>
      <div className="wrap footer-base">
        <span>© {new Date().getFullYear()} Spotlight. All rights reserved.</span>
        <span>MADE FOR YOUR NEXT CHAPTER.</span>
        <a href="#top">Back to top ↑</a>
      </div>
    </footer>
  );
}
