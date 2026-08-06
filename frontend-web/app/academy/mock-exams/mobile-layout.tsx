'use client';

import { ReactNode } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface MobileLayoutProps {
  children: ReactNode;
  title?: string;
  showBackButton?: boolean;
  onBack?: () => void;
}

/**
 * Mobile-optimized layout for exam pages
 * - Adaptive padding and margins
 * - Touch-friendly button sizing (min 44px)
 * - Bottom navigation for easy access
 * - Optimized for viewport < 768px
 */
export function MobileLayout({
  children,
  title,
  showBackButton,
  onBack,
}: MobileLayoutProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1024px)');

  if (!isMobile && !isTablet) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Mobile Header */}
      {isMobile && (
        <div className="sticky top-0 z-40 bg-white border-b border-slate-200 px-4 py-3">
          <div className="flex items-center justify-between">
            {showBackButton && (
              <button
                onClick={onBack}
                className="p-2 -m-2 text-slate-700 hover:bg-slate-100 rounded-lg"
                aria-label="Go back"
              >
                ← Back
              </button>
            )}
            {title && (
              <h1 className="text-lg font-bold text-slate-900 flex-1 text-center">
                {title}
              </h1>
            )}
            <div className="w-10" /> {/* Spacer for balance */}
          </div>
        </div>
      )}

      {/* Content with mobile-safe padding */}
      <div
        className={`
          ${isMobile ? 'px-3 py-4 pb-24' : 'px-6 py-6'}
          ${isTablet ? 'max-w-2xl mx-auto' : ''}
        `}
      >
        {children}
      </div>

      {/* Safe area for bottom navigation */}
      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 h-20 bg-white border-t border-slate-200 pointer-events-none" />
      )}
    </div>
  );
}

/**
 * Mobile-safe button component
 * - Minimum 44px tap target
 * - Full width on mobile
 * - Proper spacing
 */
export function MobileButton({
  children,
  onClick,
  fullWidth = true,
  variant = 'primary',
  disabled = false,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  fullWidth?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  className?: string;
}) {
  const isMobile = useMediaQuery('(max-width: 767px)');

  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-slate-200 hover:bg-slate-300 text-slate-900',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        ${isMobile ? 'h-12' : 'h-10'}
        ${fullWidth && isMobile ? 'w-full' : ''}
        px-4 py-2 rounded-lg font-medium
        transition-colors duration-200
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]}
        ${className}
      `}
    >
      {children}
    </button>
  );
}

/**
 * Mobile-optimized question navigator
 * - Horizontal scroll on mobile
 * - Grid on tablet+
 * - Tap-friendly buttons
 */
export function QuestionNavigator({
  totalQuestions,
  answeredQuestions,
  flaggedQuestions,
  currentQuestion,
  onSelectQuestion,
}: {
  totalQuestions: number;
  answeredQuestions: Set<number>;
  flaggedQuestions: Set<number>;
  currentQuestion: number;
  onSelectQuestion: (q: number) => void;
}) {
  const isMobile = useMediaQuery('(max-width: 767px)');

  if (isMobile) {
    return (
      <div className="sticky top-12 bg-white border-b border-slate-200 py-3 px-3 overflow-x-auto z-30">
        <div className="flex gap-1 min-w-min pb-2">
          {Array.from({ length: totalQuestions }).map((_, idx) => {
            const qNum = idx + 1;
            const isAnswered = answeredQuestions.has(qNum);
            const isFlagged = flaggedQuestions.has(qNum);
            const isCurrent = qNum === currentQuestion;

            return (
              <button
                key={qNum}
                onClick={() => onSelectQuestion(qNum)}
                className={`
                  w-10 h-10 rounded font-semibold text-sm flex-shrink-0
                  transition-colors duration-150
                  ${
                    isCurrent
                      ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                      : isAnswered
                        ? 'bg-green-100 text-green-700'
                        : isFlagged
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-slate-100 text-slate-700'
                  }
                `}
                aria-label={`Question ${qNum}${isAnswered ? ', answered' : ''}${isFlagged ? ', flagged' : ''}`}
              >
                {qNum}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Tablet/Desktop grid
  return (
    <div className="grid grid-cols-10 gap-2 p-4 bg-slate-50 rounded-lg">
      {Array.from({ length: totalQuestions }).map((_, idx) => {
        const qNum = idx + 1;
        const isAnswered = answeredQuestions.has(qNum);
        const isFlagged = flaggedQuestions.has(qNum);
        const isCurrent = qNum === currentQuestion;

        return (
          <button
            key={qNum}
            onClick={() => onSelectQuestion(qNum)}
            className={`
              p-2 rounded font-semibold text-sm
              transition-colors duration-150
              ${
                isCurrent
                  ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                  : isAnswered
                    ? 'bg-green-100 text-green-700'
                    : isFlagged
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-slate-100 text-slate-700'
              }
            `}
          >
            {qNum}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Mobile timer component
 * - Large, readable font on mobile
 * - Sticky position
 * - Color warning at low time
 */
export function ExamTimer({
  timeRemaining,
  totalTime,
}: {
  timeRemaining: number;
  totalTime: number;
}) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const percentRemaining = (timeRemaining / totalTime) * 100;
  const isLowTime = percentRemaining < 15;
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;

  return (
    <div
      className={`
        ${isMobile ? 'text-2xl font-bold' : 'text-lg font-semibold'}
        ${isLowTime ? 'text-red-600 animate-pulse' : 'text-slate-700'}
        transition-colors duration-300
      `}
    >
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </div>
  );
}

/**
 * Mobile-safe stats display
 * - Vertical stacking on mobile
 * - Horizontal grid on tablet+
 */
export function ExamStats({
  answered,
  unanswered,
  flagged,
}: {
  answered: number;
  unanswered: number;
  flagged: number;
}) {
  const isMobile = useMediaQuery('(max-width: 767px)');

  const stats = [
    { label: 'Answered', value: answered, color: 'bg-green-100 text-green-700' },
    { label: 'Unanswered', value: unanswered, color: 'bg-slate-100 text-slate-700' },
    { label: 'Flagged', value: flagged, color: 'bg-orange-100 text-orange-700' },
  ];

  return (
    <div
      className={`
        gap-3
        ${isMobile ? 'flex flex-col' : 'grid grid-cols-3'}
      `}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`p-3 rounded-lg text-center ${stat.color} ${isMobile ? 'py-2' : ''}`}
        >
          <div className={isMobile ? 'text-sm' : 'text-xs opacity-75'}>
            {stat.label}
          </div>
          <div className={isMobile ? 'text-2xl font-bold' : 'text-lg font-bold'}>
            {stat.value}
          </div>
        </div>
      ))}
    </div>
  );
}
