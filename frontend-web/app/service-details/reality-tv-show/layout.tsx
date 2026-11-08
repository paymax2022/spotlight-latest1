import type { Metadata } from 'next';

const title = 'Spotlight Reality TV Show | From your state to the national stage';
const description =
  'How the Spotlight reality TV show runs: statewide auditions, regional contests, the mansion and bootcamp, the national finale and the industry pathways that follow.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    images: [
      {
        url: '/assets/reality-tv-show/music.webp',
        width: 1536,
        height: 1024,
        alt: 'A Spotlight performer sings into a microphone on stage.',
      },
    ],
  },
};

export default function RealityTvShowLayout({ children }: { children: React.ReactNode }) {
  return children;
}
