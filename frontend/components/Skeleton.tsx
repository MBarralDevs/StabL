export function SkeletonPulse({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`animate-pulse rounded bg-surface-overlay ${className || ''}`} style={style} />
  );
}

export function StatCardSkeleton() {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <SkeletonPulse className="w-8 h-8 rounded-lg" />
        <SkeletonPulse className="w-12 h-4" />
      </div>
      <SkeletonPulse className="w-24 h-7 mb-2" />
      <SkeletonPulse className="w-16 h-3" />
    </div>
  );
}

export function PaymentRowSkeleton() {
  return (
    <div className="px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <SkeletonPulse className="w-8 h-8 rounded-full" />
        <div>
          <SkeletonPulse className="w-20 h-4 mb-1.5" />
          <SkeletonPulse className="w-28 h-3" />
        </div>
      </div>
      <div className="text-right">
        <SkeletonPulse className="w-14 h-4 mb-1.5 ml-auto" />
        <SkeletonPulse className="w-10 h-3 ml-auto" />
      </div>
    </div>
  );
}

export function TableRowSkeleton({ cols }: { cols: number[] }) {
  return (
    <div className="grid grid-cols-12 gap-4 px-6 py-4 items-center">
      {cols.map((span, i) => (
        <div key={i} className={`col-span-${span}`}>
          <SkeletonPulse className="w-full h-4" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="h-48 flex items-end gap-1.5 px-4 pb-4">
      {[40, 65, 45, 80, 55, 70, 90, 60, 75, 50, 85, 65].map((h, i) => (
        <SkeletonPulse
          key={i}
          className="flex-1 rounded-t"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

export function StatusCardSkeleton() {
  return (
    <div className="card p-5">
      <SkeletonPulse className="w-32 h-4 mb-4" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <SkeletonPulse className="w-24 h-3" />
            <SkeletonPulse className="w-16 h-3" />
          </div>
        ))}
      </div>
    </div>
  );
}