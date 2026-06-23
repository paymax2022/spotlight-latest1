'use client';

import React from 'react';

type IconVariant = 'outline' | 'solid';

interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  variant?: IconVariant;
  size?: number;
  onClick?: () => void;
  disabled?: boolean;
}

function Icon({
  name,
  variant = 'outline',
  size = 24,
  className = '',
  onClick,
  disabled = false,
  ...props
}: IconProps) {
  return (
    <span
      aria-label={name}
      role="img"
      className={`${disabled ? 'opacity-50 cursor-not-allowed' : onClick ? 'cursor-pointer hover:opacity-80' : ''} inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.75, lineHeight: 1 }}
      onClick={disabled ? undefined : onClick}
      {...props}
    >
      {variant === 'solid' ? '●' : '○'}
    </span>
  );
}

export default Icon;
