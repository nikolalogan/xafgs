import { useMemo } from "react";
import WorkflowCanvas from "./components/WorkflowCanvas";

function WorkflowEditorPage() {
  const content = useMemo(() => <WorkflowCanvas />, []);

  return content;
}

export default WorkflowEditorPage;
