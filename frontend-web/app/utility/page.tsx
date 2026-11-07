import type { Metadata } from 'next';
import UtilityDesk from '@/src/components/utility/UtilityDesk';
import { UtilityFooter, UtilityHeader, UtilitySprite } from '@/src/components/utility/UtilityChrome';
import '@/src/components/utility/utility.css';

export const metadata: Metadata = {
  title: 'Spotlight Utility — Pay Bills',
  description: 'Pay airtime, data, electricity, cable TV, internet and education bills from your Spotlight wallet.',
};

export default function UtilityPage() {
  return (
    <div className="sp-utility">
      <UtilitySprite />
      <a className="u-skip" href="#payment">Skip to bill payment</a>
      <UtilityHeader />

      <main>
        <section className="u-wrap u-intro" aria-labelledby="utility-title">
          <div>
            <p className="u-eyebrow"><i /> SPOTLIGHT / PERSONAL UTILITIES</p>
            <h1 id="utility-title">Pay your bills.</h1>
            <p className="u-lede">Manage airtime, data, electricity and other everyday payments from one place.</p>
          </div>
          <div className="u-intro-index" aria-hidden="true">
            <span>UTILITY DESK</span>
            <strong>NG<span> / </span>01</strong>
            <span>NIGERIA · NAIRA</span>
          </div>
        </section>

        <UtilityDesk />
      </main>

      <UtilityFooter />
    </div>
  );
}
