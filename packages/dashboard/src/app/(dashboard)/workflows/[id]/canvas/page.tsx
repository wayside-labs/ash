"use client";

import dynamic from "next/dynamic";
import { use } from "react";

const WorkflowCanvas = dynamic(
  () => import("@/components/flow/workflow-canvas").then((m) => ({ default: m.WorkflowCanvas })),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading canvas…
      </div>
    ),
  },
);

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function WorkflowCanvasRoute({ params }: PageProps) {
  const { id } = use(params);
  return <WorkflowCanvas workflowId={id} />;
}
