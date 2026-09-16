'use client'
import { useEffect, useRef, useState } from 'react';
import CountUp from "react-countup";

export default function CounterUp({ count, time }) {
    const [counterOn, setCounterOn] = useState(false);
    const triggerRef = useRef(null);

    useEffect(() => {
        const element = triggerRef.current;
        if (!element) return undefined;

        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setCounterOn(true);
                observer.unobserve(element);
            }
        }, { threshold: 0.1 });

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <span ref={triggerRef}>
            {counterOn && (
                <CountUp end={count} duration={time} redraw={true}>
                    {({ countUpRef }) => (
                        <span ref={countUpRef} className='count'></span>
                    )}
                </CountUp>
            )}
        </span>
    );
}
