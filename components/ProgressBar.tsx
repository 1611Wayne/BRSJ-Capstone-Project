export function ProgressBar({ step, title }: { step: number; title: string }) {
  const pct = Math.min(100, step * 25);
  return (
    <div>
      <div className="flex justify-between text-[11px] font-semibold text-brand-primary mb-2">
        <span>Step {step} of 4: {title}</span><span>{pct}%</span>
      </div>
      <div role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-[7px] bg-brand-border rounded-full overflow-hidden">
        <div className="h-full bg-brand-primary rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
