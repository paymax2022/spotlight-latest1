import type { Metadata } from 'next';

const title = 'Spotlight SME Pitch Contest | The Next Move';
const description =
  'Prepare your business for the Spotlight SME Pitch Contest. Explore the founder journey and meet the funding ecosystem.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    images: [
      {
        url: '/service-details/sme-pitch-contest/pitch-1.webp',
        width: 1774,
        height: 887,
        alt: 'Illustrative Spotlight SME funding contest montage.',
      },
    ],
  },
};

export default function SmePitchContestLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
