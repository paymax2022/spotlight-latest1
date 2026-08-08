import * as React from 'react';

export const Card = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { className?: string }) => (
  <div
    className={`rounded-lg border bg-white text-card-foreground shadow-sm ${className}`}
    {...props}
  />
);

export const CardHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { className?: string }) => (
  <div className={`flex flex-col space-y-1.5 p-6 ${className}`} {...props} />
);

export const CardTitle = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { className?: string }) => (
  <h3 className={`font-semibold leading-none tracking-tight ${className}`} {...props} />
);

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & { className?: string }) => (
  <p className={`text-sm text-muted-foreground ${className}`} {...props} />
);

export const CardContent = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { className?: string }) => (
  <div className={`p-6 pt-0 ${className}`} {...props} />
);

export const CardFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { className?: string }) => (
  <div className={`flex items-center p-6 pt-0 ${className}`} {...props} />
);
