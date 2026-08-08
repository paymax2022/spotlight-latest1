import React from 'react'

export const AlertDialog = ({ children, ...props }: any) => (
  <div data-alert-dialog {...props}>{children}</div>
)

export const AlertDialogTrigger = ({ children, asChild, ...props }: any) => (
  asChild ? children : <button {...props}>{children}</button>
)

export const AlertDialogContent = ({ children, ...props }: any) => (
  <div data-alert-dialog-content {...props}>{children}</div>
)

export const AlertDialogHeader = ({ children, ...props }: any) => (
  <div data-alert-dialog-header {...props}>{children}</div>
)

export const AlertDialogFooter = ({ children, ...props }: any) => (
  <div data-alert-dialog-footer {...props}>{children}</div>
)

export const AlertDialogTitle = ({ children, ...props }: any) => (
  <h2 data-alert-dialog-title {...props}>{children}</h2>
)

export const AlertDialogDescription = ({ children, ...props }: any) => (
  <p data-alert-dialog-description {...props}>{children}</p>
)

export const AlertDialogAction = ({ children, ...props }: any) => (
  <button data-alert-dialog-action {...props}>{children}</button>
)

export const AlertDialogCancel = ({ children, ...props }: any) => (
  <button data-alert-dialog-cancel {...props}>{children}</button>
)
