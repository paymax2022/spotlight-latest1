import Link from 'next/link';

export default function SpotlightFooter() {
  const links = [
    { label: 'About Spotlight', href: '/about' },
    { label: 'Season 2', href: '/season-2' },
    { label: 'Apply/Register', href: '/apply' },
    { label: 'Sponsor Partnership', href: '/sponsor' },
    { label: 'Voting', href: '/voting' },
    { label: 'Talent Vault', href: '/talent-vault' },
    { label: 'Government Partnerships', href: '/government-partnerships' },
    { label: 'Spotlight Studios', href: '/studios' },
    { label: 'Media Room', href: '/media-room' },
    { label: 'Contact', href: '/contact' },
    { label: 'Privacy Policy', href: '/privacy-policy' },
    { label: 'Terms & Conditions', href: '/terms-and-conditions' },
  ];

  return (
    <footer className="border-t border-border bg-bg-card mt-20">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <h3 className="font-display text-xl text-foreground">Spotlight</h3>
          <p className="text-sm text-foreground/60 mt-3 leading-relaxed">
            Spotlight is a national youth empowerment and entertainment platform connecting talent, media, brands, and opportunity through auditions, bootcamps, reality TV, public voting, and post-show career development.
          </p>
        </div>
        <div className="md:col-span-2">
          <h4 className="text-sm font-semibold text-foreground">Explore</h4>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm text-foreground/70">
            {links.map((link) => <Link key={link.label} href={link.href}>{link.label}</Link>)}
          </div>
        </div>
      </div>
      <div className="border-t border-border py-4 px-4 md:px-8 text-xs text-foreground/40 text-center">© {new Date().getFullYear()} Spotlight. All rights reserved.</div>
    </footer>
  );
}
