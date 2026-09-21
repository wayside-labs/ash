export const dynamic = "force-dynamic";

export default function WorkflowCanvasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="-m-4 flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden md:-m-6">
      {children}
    </div>
  );
}
