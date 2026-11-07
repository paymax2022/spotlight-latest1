'use client';

import { worldLinks } from './content';
import { ArrowIcon } from './Icons';
import { selectProgramme } from './programmeBus';

/**
 * Four tiles that both scroll to the programme tablist and put the matching tab
 * in front of the visitor, which is what the mock's data-world wiring did.
 */
export default function WorldNav() {
  return (
    <div className="world-nav" aria-label="Choose your Spotlight world">
      {worldLinks.map((world) => (
        <a
          key={world.programme}
          href="#programmes"
          onClick={() => selectProgramme(world.programme)}
        >
          <span className="world-number">{world.number}</span>
          <span>
            <small>{world.kicker}</small>
            <b>{world.title}</b>
            <em>{world.sub}</em>
          </span>
          <ArrowIcon />
        </a>
      ))}
    </div>
  );
}
