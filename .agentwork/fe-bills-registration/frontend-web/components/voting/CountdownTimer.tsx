'use client';

import { useEffect, useState } from 'react';

interface Props {
  endsAt: string;
  className?: string;
}

function formatDuration(ms: number) {
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  return { days, hours, minutes, seconds };
}

export default function CountdownTimer({ endsAt, className = '' }: Props) {
  const [remaining, setRemaining] = useState(() => Date.parse(endsAt) - Date.now());

  useEffect(() => {
    const id = setInterval(() => setRemaining(Date.parse(endsAt) - Date.now()), 1_000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (remaining <= 0) {
    return <div className={`text-red-400 text-sm font-semibold ${className}`}>Voting has closed</div>;
  }

  const { days, hours, minutes, seconds } = formatDuration(remaining);

  return (
    <div className={`${className}`}>
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Voting closes in</p>
      <div className="flex gap-2">
        {[
          { label: 'Days', value: days },
          { label: 'Hours', value: hours },
          { label: 'Mins', value: minutes },
          { label: 'Secs', value: seconds },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-800 rounded-lg px-2 py-1.5 text-center min-w-[44px]">
            <p className="text-white text-lg font-bold leading-none">{String(value).padStart(2, '0')}</p>
            <p className="text-gray-500 text-xs mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
