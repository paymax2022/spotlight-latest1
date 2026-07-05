import React from 'react';
import * as Icons from 'lucide-react-native';

/** Render a lucide icon by name, falling back to a sensible default. */
export default function DynamicIcon({
  name,
  size = 22,
  color,
  strokeWidth = 1.8,
}: {
  name?: string;
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  const IC = (Icons as unknown as Record<string, Icons.LucideIcon>)[name ?? ''] ?? Icons.Utensils;
  return <IC size={size} color={color} strokeWidth={strokeWidth} />;
}
