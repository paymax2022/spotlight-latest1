import type { Metadata } from 'next';
import { Barlow_Condensed, DM_Sans, Manrope } from 'next/font/google';
import Layout from '@/components/layout/Layout';
import LandingHeader from '@/components/landing/LandingHeader';
import Closing from '@/components/landing/Closing';
import Faq from '@/components/landing/Faq';
import Hero from '@/components/landing/Hero';
import { JoinDialogProvider } from '@/components/landing/JoinDialog';
import Journey from '@/components/landing/Journey';
import Network from '@/components/landing/Network';
import Opportunities from '@/components/landing/Opportunities';
import Partnership from '@/components/landing/Partnership';
import PeopleRail from '@/components/landing/PeopleRail';
import PhotoGallery from '@/components/landing/PhotoGallery';
import Programmes from '@/components/landing/Programmes';
import Recognition from '@/components/landing/Recognition';
import Season from '@/components/landing/Season';
import Testimonials from '@/components/landing/Testimonials';
import Voices from '@/components/landing/Voices';
import { LANDING_IMG } from '@/components/landing/content';
import { getAcademyCatalogue } from '@/src/server/services/academy/catalogue';
import { formatNaira } from './service-details/film-academy/format';
import '@/components/landing/landing.css';

// Tuition on the Film Academy tile is the one figure here that comes from the
// database, so the page renders per request. On the prerendered/ISR path that
// read comes back empty in production and the tile silently loses its price;
// /service-details/film-academy already renders this same read dynamically.
export const dynamic = 'force-dynamic';

const display = Barlow_Condensed({
  weight: ['500', '600', '700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
});
const ui = Manrope({
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-ui',
});
const body = DM_Sans({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

const HERO_IMAGE = `${LANDING_IMG}/spotlight-worlds.webp`;
const TITLE = 'Spotlight — Your Moment Starts Here';
const DESCRIPTION =
  'Find your Spotlight. Explore reality TV in music, comedy and acting, tech hackathons and STEM, indoor football, SME pitch competitions, Open Mic and the Film Academy.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: 'The stage. The lab. The court. The pitch. A platform for Nigeria’s next generation.',
    url: '/',
    images: [
      {
        url: HERO_IMAGE,
        width: 1774,
        height: 887,
        alt: 'Illustrative cinematic montage of Nigerian talent across music, technology, sport and enterprise.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: 'The stage. The lab. The court. The pitch. A platform for Nigeria’s next generation.',
    images: [HERO_IMAGE],
  },
};

/**
 * The cheapest honest version of the Film Academy price floor: the lowest
 * tuition any active area of study offers. `null` means no price is published,
 * and the tile says so by saying nothing about money.
 */
async function readAcademyPriceFloor(): Promise<string | null> {
  try {
    const { areas } = await getAcademyCatalogue();
    const prices = areas.flatMap((area) => area.pricing_options.map((option) => option.price_ngn));
    return prices.length > 0 ? formatNaira(Math.min(...prices)) : null;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const academyFrom = await readAcademyPriceFloor();

  return (
    // `#top` has to sit on the document's first box: the header is sticky, so
    // scrolling to it leaves the page exactly where it was.
    <Layout
      // The two props that pick a template header and nav have no bearing on
      // this page: `templateHeader={false}` means Layout draws neither.
      headerStyle={undefined}
      onePageNav={undefined}
      templateHeader={false}
      footerStyle={2}
      breadcrumbTitle={null}
      breadcrumbClassName={undefined}
      breadcrumbPadding={undefined}
    >
      <div id="top" className={`sp-home ${display.variable} ${ui.variable} ${body.variable}`}>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <JoinDialogProvider>
          <LandingHeader />
          <main id="main">
            <Hero />
            <Network />
            <Programmes />
            <Opportunities academyFrom={academyFrom} />
            <Season />
            <Journey />
            <PeopleRail />
            <Voices />
            <Recognition />
            <PhotoGallery />
            <Testimonials />
            <Partnership />
            <Faq />
            <Closing />
          </main>
        </JoinDialogProvider>
      </div>
    </Layout>
  );
}
