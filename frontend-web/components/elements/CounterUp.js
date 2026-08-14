'use client'
import CountUp from "react-countup";

// Counts up when scrolled into view. Uses react-countup's built-in scroll spy
// (enableScrollSpy + scrollSpyOnce) instead of the unmaintained
// `react-scroll-trigger`, which relied on ReactDOM.findDOMNode — removed in
// modern React / broken under Next 15's bundling ("findDOMNode is not a function").
export default function CounterUp({ count, time }) {
    return (
        <CountUp end={count} duration={time} enableScrollSpy scrollSpyOnce>
            {({ countUpRef }) => (
                <span ref={countUpRef} className='count'></span>
            )}
        </CountUp>
    );
}
