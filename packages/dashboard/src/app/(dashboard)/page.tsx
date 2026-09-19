import { ChatPanel } from "@/components/chat/chat-panel";
import { WorkflowRow } from "@/components/workflows/workflow-row";
import { mockWorkflows } from "@/lib/mock-data";

export default function HomePage() {
  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-6 lg:flex-row">
      <div className="flex-1 lg:max-w-md">
        <ChatPanel className="h-full min-h-[400px]" />
      </div>
      <div className="flex-1 overflow-y-auto">
        <h2 className="mb-4 text-lg font-semibold">Seus Workflows</h2>
        {mockWorkflows.map((workflow) => (
          <WorkflowRow key={workflow.id} workflow={workflow} />
        ))}
      </div>
    </div>
  );
}
