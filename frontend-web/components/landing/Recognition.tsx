import Link from 'next/link';
import { endorsements, type Endorsement } from './content';

/**
 * Endorsement records are issued documents, not intentions: the review of the
 * official pages found none, so the archive shows its empty state and points at
 * the team instead of presenting a named ministry as proof.
 */
export default function Recognition() {
  return (
    <section className="recognition paper" id="endorsements" aria-labelledby="recognition-title">
      <div className="wrap recognition-layout">
        <div>
          <p className="eyebrow dark">STATE &amp; GOVERNMENT RECOGNITION</p>
          <h2 id="recognition-title">
            Recognition.
            <br />
            <em>With the record.</em>
          </h2>
          <p>Official endorsements and institutional letters, presented with their issuing authority and supporting document.</p>
          <Link className="text-link" href="/government-partnerships">
            Explore institutional partnerships <span aria-hidden="true">↗</span>
          </Link>
        </div>

        {endorsements.length === 0 ? <NoRecordsYet /> : <div>{endorsements.map((record) => <Record key={record.documentUrl} record={record} />)}</div>}
      </div>
    </section>
  );
}

function NoRecordsYet() {
  return (
    <div>
      <article className="endorsement-empty">
        <span className="document-icon" aria-hidden="true">
          ↗
        </span>
        <span className="record-status">ENDORSEMENT ARCHIVE</span>
        <h3>{'Official records,\nin one place.'}</h3>
        <p>State and government endorsement documents will appear here when published.</p>
        <Link className="text-link" href="/contact">
          Contact the Spotlight team <span aria-hidden="true">↗</span>
        </Link>
      </article>
    </div>
  );
}

function Record({ record }: { record: Endorsement }) {
  return (
    <article className="endorsement-card">
      {record.logo ? <img src={record.logo} alt={`${record.issuer} logo`} loading="lazy" decoding="async" /> : null}
      <span className="eyebrow dark">{record.issuer}</span>
      <h3>{record.title}</h3>
      {record.date ? <p>{record.date}</p> : null}
      <a className="text-link" href={record.documentUrl} target="_blank" rel="noopener noreferrer">
        View official document <span aria-hidden="true">↗</span>
      </a>
    </article>
  );
}
