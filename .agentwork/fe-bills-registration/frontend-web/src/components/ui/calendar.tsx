import * as React from 'react';
import { format } from 'date-fns';

export const Calendar = ({ selected, onSelect, className, ...props }: any) => {
  return (
    <div className={`p-2 bg-white border rounded-md ${className}`}>
      <div className="text-center font-bold mb-2">
        {format(selected || new Date(), 'MMMM yyyy')}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div key={d} className="text-center text-xs font-medium text-gray-500">
            {d}
          </div>
        ))}
        {Array.from({ length: 31 }).map((_, i) => {
          const date = new Date();
          date.setDate(i + 1);
          const isSelected = selected && isSameDay(date, selected);
          return (
            <div
              key={i}
              onClick={() => onSelect(date)}
              className={`p-2 text-center text-xs cursor-pointer rounded-md ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
            >
              {i + 1}
            </div>
          );
        })}
      </div>
    </div>
  );
};

function isSameDay(d1: Date, d2: Date) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}
