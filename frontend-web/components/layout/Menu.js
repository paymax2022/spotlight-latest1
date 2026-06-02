import Link from 'next/link';

const serviceMenuItems = [
  { label: 'Open Mic Contest', href: '/service-details/open-mic-competition' },
  { label: 'Reality TV Show', href: '/service-details/reality-tv-show' },
  { label: 'STEM Contest', href: '/service-details/stem-contest' },
  { label: 'SME Pitch Competition', href: '/service-details/sme-pitch-contest' },
  { label: 'Film Academy', href: '/service-details/film-academy' },
];

export default function Menu() {
  return (
    <ul>
      <li><Link href="/">Home</Link></li>
      <li><Link href="/about">About</Link></li>
      <li><Link href="/season-2">Season 2</Link></li>
      <li className="has-dropdown">
        <Link href="/service">
          Our Services
          <i className="fas fa-angle-down" />
        </Link>
        <ul className="submenu">
          {serviceMenuItems.map((item) => (
            <li key={item.href}><Link href={item.href}>{item.label}</Link></li>
          ))}
        </ul>
      </li>
      <li><Link href="/sponsor">Sponsors</Link></li>
      <li><Link href="/contact">Contact Us</Link></li>
    </ul>
  );
}
