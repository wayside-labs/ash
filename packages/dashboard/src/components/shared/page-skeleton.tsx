/** Lightweight placeholder while a dashboard route chunk loads. */
export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-md bg-muted" />
        <div className="h-4 w-72 max-w-full rounded-md bg-muted/70" />
      </div>
      <div className="space-y-3 pt-2">
        <div className="h-24 rounded-lg bg-muted/60" />
        <div className="h-24 rounded-lg bg-muted/60" />
        <div className="h-24 rounded-lg bg-muted/40" />
      </div>
    </div>
  );
}
