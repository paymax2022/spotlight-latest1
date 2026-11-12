import { overviewPhotos } from './content';
import MansionChapters from './MansionChapters';
import PhotoBand from './PhotoBand';

export default function MansionExperience() {
  return (
    <section className="paper section" id="mansion" aria-labelledby="mansion-title">
      <div className="wrap">
        <div className="section-head">
          <div>
            <p className="eyebrow">01 / THE MANSION EXPERIENCE</p>
            <h2 id="mansion-title">
              Life between
              <br />
              <em>performances.</em>
            </h2>
          </div>
          <p>Living together meant learning together. Open a chapter to explore what housemates faced on and off the stage.</p>
        </div>

        <h3 className="gallery-heading">Season 1 in pictures</h3>
        <PhotoBand label="Season 1 mansion and stage overview" photos={overviewPhotos} />

        <MansionChapters />

        <aside className="gallery-invitation">
          <p>Can you picture yourself in the house? See what Season 2 has planned.</p>
          <a className="button orange" href="#season-two">
            Explore Season 2 <span aria-hidden="true">→</span>
          </a>
        </aside>
      </div>
    </section>
  );
}
