import Link from 'next/link';
import { ArrowIcon } from './Icons';
import { CONTACT, partnershipList } from './content';

export default function Partnership() {
  return (
    <section className="partnership" id="partners" aria-labelledby="partners-title">
      <div className="wrap partner-layout">
        <div>
          <p className="eyebrow">FOR BRANDS. INSTITUTIONS. CHANGEMAKERS.</p>
          <h2 id="partners-title">
            Put your brand
            <br />
            behind the
            <br />
            <em>next big thing.</em>
          </h2>
          <Link className="button orange" href="/sponsor">
            Partner with Spotlight <ArrowIcon />
          </Link>
        </div>
        <div className="partner-aside">
          <p>
            Connect your brand to Nigeria’s creative energy, emerging innovators, sporting talent and entrepreneurial
            ambition.
          </p>
          <ul>
            {partnershipList.map((item) => (
              <li key={item.number}>
                <span>{item.number}</span> {item.label} <ArrowIcon />
              </li>
            ))}
          </ul>
          <a className="text-link" href={`mailto:${CONTACT.email}?subject=Spotlight%20Partnership%20Enquiry`}>
            Let’s start a conversation <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
      <span className="partner-watermark" aria-hidden="true">
        SPOTLIGHT
      </span>
    </section>
  );
}
