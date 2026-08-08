import React from 'react'

export const Progress = ({ value = 0, ...props }: { value?: number } & React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props}>
    <div style={{ width: `${value}%`, transition: 'width 0.3s' }}>
      {value}%
    </div>
  </div>
)
