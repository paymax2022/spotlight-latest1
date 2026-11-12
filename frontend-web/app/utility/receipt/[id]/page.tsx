import type { Metadata } from 'next';
import UtilityReceiptClient from '@/src/components/utility/UtilityReceiptClient';
import { UtilityFooter, UtilityHeader, UtilitySprite } from '@/src/components/utility/UtilityChrome';
import '@/src/components/utility/utility.css';

export const metadata: Metadata = {
  title: 'Payment receipt | Spotlight Utility',
  description: 'Your Spotlight Utility bill payment receipt.',
};

export default async function UtilityReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="sp-utility">
      <UtilitySprite />
      <a className="u-skip" href="#receipt">Skip to receipt</a>
      <UtilityHeader />

      <main>
        <section className="u-wrap u-intro" aria-labelledby="receipt-title">
          <div>
            <p className="u-eyebrow"><i /> SPOTLIGHT / PERSONAL UTILITIES</p>
            <h1 id="receipt-title">Your receipt.</h1>
            <p className="u-lede">Every utility payment is recorded here with its provider reference and total.</p>
          </div>
          <div className="u-intro-index" aria-hidden="true">
            <span>UTILITY DESK</span>
            <strong>NG<span> / </span>02</strong>
            <span>NIGERIA · NAIRA</span>
          </div>
        </section>

        <UtilityReceiptClient transactionId={id} />
      </main>

      <UtilityFooter />
    </div>
  );
}
