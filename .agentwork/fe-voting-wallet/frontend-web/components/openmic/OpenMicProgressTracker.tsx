import { OPEN_MIC_PROGRESS_STEPS } from '@/src/features/openmic/workflow';

type Props = {
  currentStep?: number;
};

export default function OpenMicProgressTracker({ currentStep = 1 }: Props) {
  return (
    <div className="glass-card rounded-md p-4">
      <p className="text-xs uppercase tracking-wide text-foreground/60 mb-3">Artist Journey</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {OPEN_MIC_PROGRESS_STEPS.map((step, index) => {
          const active = index + 1 <= currentStep;
          return (
            <div
              key={step}
              className={`rounded-sm px-3 py-2 text-xs border ${active ? 'border-accent-gold text-foreground bg-accent-gold/10' : 'border-border text-foreground/60'}`}
            >
              <span className="mr-1 font-semibold">{index + 1}.</span>
              {step}
            </div>
          );
        })}
      </div>
    </div>
  );
}
