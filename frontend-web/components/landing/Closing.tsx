import { ArrowIcon } from './Icons';
import { JoinTrigger } from './JoinDialog';

export default function Closing() {
  return (
    <section className="closing">
      <div className="wrap closing-inner">
        <span className="eyebrow">DON’T JUST WATCH THE MOMENT.</span>
        <h2>
          Be the <em>moment.</em>
          <ArrowIcon />
        </h2>
        <div>
          <p>Your story deserves a place to begin.</p>
          <JoinTrigger className="button ink">Find your Spotlight</JoinTrigger>
        </div>
      </div>
    </section>
  );
}
