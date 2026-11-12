import type { Metadata } from 'next';

const title = 'Spotlight STEM & Tech Competitions';
const description =
  'Two competitions for Nigerian innovators. School teams build and test prototypes, while older youth tackle statewide tech challenges and pitch for a place at nationals.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    images: [
      {
        url: '/service-details/stem-contest/photo-school.webp',
        width: 1334,
        height: 1000,
        alt: 'Students working together in a classroom.',
      },
    ],
  },
};

export default function StemContestLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
