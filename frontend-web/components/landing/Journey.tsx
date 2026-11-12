import { ArrowIcon } from './Icons';
import { JoinTrigger } from './JoinDialog';
import { journeySteps } from './content';

export default function Journey() {
  return (
    <section className="journey paper" id="journey" aria-labelledby="journey-title">
      <div className="wrap">
        <div className="section-head">
          <div>
            <p className="eyebrow dark">03 / THE FIRST STEP IS YOURS</p>
            <h2 id="journey-title">
              Big moments.
              <br />
              <em>Real preparation.</em>
            </h2>
          </div>
          <p className="supporting-copy">
            Every programme has its own process.
            <br />
            Here’s where your journey begins.
          </p>
        </div>

        <div className="journey-steps">
          {journeySteps.map((step) => (
            <article key={step.number}>
              <span className="step-no">
                {step.number} <ArrowIcon />
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>

        <div className="journey-action">
          <span>Your talent doesn’t need another “one day”.</span>
          <JoinTrigger className="button ink">Find my programme</JoinTrigger>
        </div>
      </div>
    </section>
  );
}
