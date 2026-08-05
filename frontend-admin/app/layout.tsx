import './globals.css';
import type { PropsWithChildren } from 'react';
import { Kumbh_Sans } from 'next/font/google';

const kumbh = Kumbh_Sans({
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-kumbh',
});

export const metadata = {
  title: 'Spotlight Admin',
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en" className={kumbh.variable}>
      <body style={{ margin: 0, fontFamily: "'Kumbh Sans', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
