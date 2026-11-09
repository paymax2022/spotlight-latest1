import Link from 'next/link';

const serviceMenuItems = [
  { label: 'STEM & TECH', href: '/service-details/stem-contest' },
  { label: 'Entertainment', href: '/service-details/reality-tv-show' },
  { label: 'Sports', href: '/service-details/sports' },
  { label: 'SME Funding', href: '/service-details/sme-pitch-contest' },
];

export default function Menu() {
  return (
    <ul>
      <li><Link href="/">Home</Link></li>
      <li><Link href="/about">About</Link></li>
      <li><Link href="/season-2">Season 2</Link></li>
      <li className="has-dropdown">
        <Link href="/service">
          Programes
          <i className="fas fa-angle-down" />
        </Link>
        <ul className="submenu">
          {serviceMenuItems.map((item) => (
            <li key={item.href}><Link href={item.href}>{item.label}</Link></li>
          ))}
        </ul>
      </li>
      <li><Link href="/contact">Contact Us</Link></li>
    </ul>
  );
}
