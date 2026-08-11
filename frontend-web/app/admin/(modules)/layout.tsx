// Unified layout for all admin modules
import { ReactNode } from 'react';

interface ModulesLayoutProps {
  children: ReactNode;
}

export default function ModulesLayout({ children }: ModulesLayoutProps) {
  // Module layout wrapper - inherits parent admin layout
  return <>{children}</>;
}
