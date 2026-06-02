import Link from 'next/link';

const links = [
  ['About Spotlight', '/about'], ['Season 2', '/season-2'], ['Apply/Register', '/apply'], ['Sponsor Partnership', '/sponsor'],
  ['Voting', '/voting'], ['Talent Vault', '/talent-vault'], ['Government Partnerships', '/government-partnerships'],
  ['Spotlight Studios', '/studios'], ['Media Room', '/media-room'], ['Contact', '/contact'], ['Privacy Policy', '/privacy-policy'], ['Terms & Conditions', '/terms-and-conditions'],
];

export default function Footer1() {
  return (
    <footer className="footer-section">
      <div className="footer-widgets-wrapper footer-bg">
        <div className="container">
          <div className="row g-4">
            <div className="col-lg-5"><h3 className="text-white">Spotlight</h3><p className="text-white-50 mt-3">Spotlight is a national youth empowerment and entertainment platform connecting talent, media, brands, and opportunity through auditions, bootcamps, reality TV, public voting, and post-show career development.</p></div>
            <div className="col-lg-4"><h3 className="text-white">Explore</h3><ul className="list-area mt-3">{links.slice(0, 8).map(([label, href]) => <li key={href}><Link href={href}><i className="fa-solid fa-chevron-right" />{label}</Link></li>)}</ul></div>
            <div className="col-lg-3"><h3 className="text-white">More</h3><ul className="list-area mt-3">{links.slice(8).map(([label, href]) => <li key={href}><Link href={href}><i className="fa-solid fa-chevron-right" />{label}</Link></li>)}</ul></div>
          </div>
        </div>
      </div>
      <div className="footer-bottom"><div className="container"><div className="footer-wrapper d-flex align-items-center justify-content-between"><p className="color-2">© {new Date().getFullYear()} Spotlight</p></div></div></div>
    </footer>
  );
}
