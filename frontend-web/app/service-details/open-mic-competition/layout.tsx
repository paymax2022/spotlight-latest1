import type { Metadata } from 'next';

const title = 'Spotlight Open Mic Competition';
const description =
  'Record an original song on the Spotlight beat. Share your entry, bring your audience and compete for ₦1 million, a studio session and a music video shoot.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    images: [
      {
        url: '/service-details/stem-contest/photo-spotlight-stage.webp',
        width: 1080,
        height: 1080,
        alt: 'Spotlight performers share the stage.',
      },
    ],
  },
};

export default function OpenMicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
