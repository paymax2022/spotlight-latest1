import type { ReactNode } from 'react';
import SpotlightHeader from './SpotlightHeader';
import SpotlightFooter from './SpotlightFooter';

export default function SpotlightShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SpotlightHeader />
      <main className="pt-24">{children}</main>
      <SpotlightFooter />
    </>
  );
}
