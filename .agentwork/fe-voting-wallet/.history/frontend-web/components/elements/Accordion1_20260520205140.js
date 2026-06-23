'use client'
import { useState } from 'react';
export default function Accordion1() {
    const [activeItem, setActiveItem] = useState(1);

    const handleClick = (index) => {
      setActiveItem(index);
    };
    return (
        <>
            <div className="accordion" id="accordion">
                <div className="accordion-item mb-3 wow fadeInUp" data-wow-delay=".3s">
                    <h5 className="accordion-header" onClick={() => handleClick(1)}>
                        <button className={activeItem  == 1 ? "accordion-button" : "accordion-button collapsed"} type="button" data-bs-toggle="collapse" data-bs-target="#faq1" aria-expanded="true" aria-controls="faq1">
                            Who can apply for Spotlight auditions?
                        </button>
                    </h5>
                    <div id="faq1" className={activeItem  == 1 ? "accordion-collapse collapse show" : "accordion-collapse collapse"} data-bs-parent="#accordion">
                        <div className="accordion-body">
                            Anyone with talent in music, acting, comedy, content creation, dance, performance, innovation, or entrepreneurship can apply, provided they meet the age, location, and program requirements for the specific audition or contest.    </div>
                    </div>
                </div>
                <div className="accordion-item mb-3 wow fadeInUp" data-wow-delay=".5s">
                    <h5 className="accordion-header" onClick={() => handleClick(2)}>
                        <button className={activeItem  == 2 ? "accordion-button" : "accordion-button collapsed"} type="button" data-bs-toggle="collapse" data-bs-target="#faq2" aria-expanded="false" aria-controls="faq2">
                            How does the Spotlight Reality TV Show work?
                        </button>
                    </h5>
                    <div id="faq2" className={activeItem  == 2 ? "accordion-collapse collapse show" : "accordion-collapse collapse"} data-bs-parent="#accordion">
                        <div className="accordion-body">
                            Selected contestants go through auditions, screening, bootcamp, mentorship, weekly performances, tasks, public voting, evictions, and a grand finale where winners and standout talents are recognized and supported.
                        </div>
                    </div>
                </div>
                <div className="accordion-item mb-3 wow fadeInUp" data-wow-delay=".7s">
                    <h5 className="accordion-header" onClick={() => handleClick(3)}>
                        <button className={activeItem  == 3 ? "accordion-button" : "accordion-button collapsed"} type="button" data-bs-toggle="collapse" data-bs-target="#faq3" aria-expanded="false" aria-controls="faq3">
                            Is Spotlight only for singers?
                        </button>
                    </h5>
                    <div id="faq3" className={activeItem  == 3 ? "accordion-collapse collapse show" : "accordion-collapse collapse"} data-bs-parent="#accordion">
                        <div className="accordion-body">
                       No. Spotlight is a multi-talent platform covering music, acting, film, comedy, content creation, STEM innovation, SME pitch, entrepreneurship, and other creative or performance-based categories.
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}
