'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowIcon } from './Icons';
import { faqs } from './content';

/**
 * Native <details> carries the disclosure, and only one stays open at a time —
 * the mock closed its siblings by hand, and a page-wide `name` group would
 * depend on browser support this site cannot assume yet.
 */
export default function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="faq wrap" id="faq" aria-labelledby="faq-title">
      <div>
        <p className="eyebrow">BEFORE YOU STEP IN</p>
        <h2 id="faq-title">
          Good questions.
          <br />
          <em>Clear answers.</em>
        </h2>
        <Link className="text-link" href="/contact">
          Talk to the team <ArrowIcon />
        </Link>
      </div>

      <div className="faq-list">
        {faqs.map((faq, index) => (
          <details
            key={faq.question}
            open={index === openIndex}
            // Closing a sibling is done by this component, and the browser fires
            // `toggle` for that too — answering it unconditionally would clear
            // the index the click just set and close the panel being opened.
            onToggle={(event) => {
              if (event.currentTarget.open) setOpenIndex(index);
              else setOpenIndex((current) => (current === index ? null : current));
            }}
          >
            <summary>
              {faq.question}
              <span aria-hidden="true">+</span>
            </summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
