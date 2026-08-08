import React from 'react'

export const Tabs = ({ children, defaultValue, ...props }: any) => (
  <div data-tabs-root {...props}>{children}</div>
)

export const TabsList = ({ children, ...props }: any) => (
  <div data-tabs-list {...props}>{children}</div>
)

export const TabsTrigger = ({ children, value, ...props }: any) => (
  <button data-tabs-trigger={value} {...props}>{children}</button>
)

export const TabsContent = ({ children, value, ...props }: any) => (
  <div data-tabs-content={value} {...props}>{children}</div>
)
