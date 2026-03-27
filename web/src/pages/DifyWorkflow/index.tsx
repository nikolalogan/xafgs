import { useMemo } from "react";
import DifyWorkflowMigratedCanvas from "./components/DifyWorkflowMigratedCanvas";

function DifyWorkflowPage() {
  const content = useMemo(() => <DifyWorkflowMigratedCanvas />, []);
  return content;
}

export default DifyWorkflowPage;
