export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true">
      <div className="h-12 w-2/3 rounded-lg bg-panel-2" />
      <div className="h-11 rounded-lg bg-panel-2" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 h-[420px] rounded-xl bg-panel-2" />
        <div className="h-[420px] rounded-xl bg-panel-2" />
      </div>
    </div>
  );
}
