import { useMemo } from "react";
import WorkflowCanvas from "./components/WorkflowCanvas";

function WorkflowPage() {
  const content = useMemo(() => <WorkflowCanvas />, []);
  return content;
}

export default WorkflowPage;
