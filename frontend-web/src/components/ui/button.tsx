import * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'outline' | 'ghost';
  size?: 'sm' | 'medium' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'medium', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`px-4 py-2 rounded-md font-medium transition-colors ${
          variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-700'
        } ${variant === 'secondary' && 'bg-gray-200 text-gray-900 hover:bg-gray-300'} ${
          variant === 'destructive' && 'bg-red-600 text-white hover:bg-red-700'
        } ${variant === 'outline' && 'border border-gray-300 bg-transparent hover:bg-gray-100'} ${
          variant === 'ghost' && 'bg-transparent hover:bg-gray-100'
        } ${size === 'sm' && 'px-3 py-1.5 text-sm'} ${
          size === 'lg' && 'px-6 py-3 text-lg'
        } ${className}`}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
