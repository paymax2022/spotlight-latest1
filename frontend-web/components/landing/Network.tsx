import Link from 'next/link';
import { partners } from './content';

function LogoTile({ name, image }: { name: string; image: string }) {
  return (
    <div className="logo-tile">
      <img src={image} alt={`${name} logo`} loading="lazy" decoding="async" />
      <span>{name}</span>
    </div>
  );
}

/**
 * Media and institutional logos are listed as network entries because the
 * official site shows them; none of them is presented as an endorsement — the
 * records that would carry that claim live in the recognition band below.
 */
export default function Network() {
  const media = partners.filter((partner) => partner.group === 'media');
  const institutions = partners.filter((partner) => partner.group === 'institution');

  return (
    <section className="network paper" id="network" aria-labelledby="network-title">
      <div className="wrap">
        <div className="network-heading">
          <p className="eyebrow dark">THE NETWORK BEHIND THE POSSIBILITY</p>
          <h2 id="network-title">
            Partners. Collaborators.
            <br />
            <em>A shared ambition.</em>
          </h2>
          <p>Media and institutional organisations featured on Spotlight’s official platform.</p>
        </div>
        <div className="network-label">
          <span>MEDIA &amp; COLLABORATORS</span>
          <Link href="/sponsors-partners">View the sponsors &amp; partners page</Link>
        </div>
        <div className="logo-wall">
          {media.map((partner) => (
            <LogoTile key={partner.name} {...partner} />
          ))}
        </div>
        <div className="institution-strip">
          <div>
            <span className="eyebrow dark">INSTITUTIONAL NETWORK</span>
            <p>
              Connecting talent with
              <br />
              the wider creative economy.
            </p>
          </div>
          <div className="institution-logos">
            {institutions.map((partner) => (
              <LogoTile key={partner.name} {...partner} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
