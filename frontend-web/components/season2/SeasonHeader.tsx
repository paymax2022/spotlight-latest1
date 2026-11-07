'use client';

import Link from 'next/link';
import { RegistrationTrigger } from './RegistrationPanel';
import { ArrowIcon } from './Icons';
import { LOGO, seasonNav } from './content';

/**
 * The mock's own sticky chrome, kept instead of the shared template header so
 * this page can carry the type and colour system it was designed around.
 */
export default function SeasonHeader() {
  return (
    <header className="site-header">
      <div className="wrap header-inner">
        <Link className="brand" href="/" aria-label="Spotlight home">
          <img src={LOGO} alt="Spotlight" width={200} height={72} />
          <small>REALITY TV SHOW</small>
        </Link>
        <nav aria-label="Season navigation">
          {seasonNav.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <RegistrationTrigger className="button light">
          Register <ArrowIcon />
        </RegistrationTrigger>
      </div>
    </header>
  );
}
