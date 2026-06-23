import * as React from 'react';

export const Select = ({ children, onValueChange, ...props }: any) => (
  <div className="relative w-full" {...props}>
    {children}
  </div>
);

export const SelectTrigger = ({ children, className, ...props }: any) => (
  <div
    className={`flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background ${className}`}
    {...props}
  >
    {children}
  </div>
);

export const SelectValue = ({ placeholder, ...props }: any) => (
  <span className="text-sm" {...props}>
    {placeholder || 'Select...'}
  </span>
);

export const SelectContent = ({ children, ...props }: any) => (
  <div className="absolute z-50 h-full w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
    {children}
  </div>
);

export const SelectItem = ({ children, value, ...props }: any) => (
  <div
    className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
    onClick={() => {
      const event = new CustomEvent('select-value-change', { detail: value });
      window.dispatchEvent(event);
    }}
    {...props}
  >
    {children}
  </div>
);
