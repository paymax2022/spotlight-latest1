import Link from 'next/link';
import { testimonials } from './content';

/**
 * Short excerpts the platform has already published, each still credited to the
 * person who said it.
 */
export default function Testimonials() {
  return (
    <section className="testimonials paper" id="testimonials" aria-labelledby="testimonials-title">
      <div className="wrap">
        <div className="section-head">
          <div>
            <p className="eyebrow dark">07 / THE EXPERIENCE, IN THEIR WORDS</p>
            <h2 id="testimonials-title">
              More than a moment.
              <br />
              <em>A personal journey.</em>
            </h2>
          </div>
          <p className="supporting-copy">
            Perspectives published by Spotlight
            <br />
            from its Season 1 community.
          </p>
        </div>

        <div className="testimonial-grid">
          {testimonials.map((testimonial) => (
            <article className="testimonial-card" key={testimonial.name}>
              <span className="quote-mark" aria-hidden="true">
                “
              </span>
              <blockquote>{testimonial.quote}</blockquote>
              <div className="testimonial-person">
                <span className="testimonial-initials" aria-hidden="true">
                  {testimonial.initials}
                </span>
                <div>
                  <h3>{testimonial.name}</h3>
                  <p>{testimonial.role}</p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <Link className="testimonial-source" href="/about">
          More about the Spotlight community <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </section>
  );
}
