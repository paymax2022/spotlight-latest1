// /register aliases the Season 2 application page but is shared as the
// registration entry point — it must carry its own metadata instead of
// re-exporting /apply's (which previously leaked "Apply" copy into
// registration share unfurls).

import { SITE_URL } from '@/src/lib/site-url';

export { default } from '../apply/page';

const title = 'Register for Spotlight | Contestant Sign-Up';
const description =
  'Register for Spotlight. Create your contestant entry for auditions, talent categories, public voting, and national reality TV exposure.';

export const metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/register` },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/register`,
    siteName: 'Spotlight',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
};
