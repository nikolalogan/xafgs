import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import AppLayout from "./pages/AppLayout";
import DashboardPage from "./pages/DashboardPage";
import ProfilePage from "./pages/ProfilePage";
import WorkflowEditorPage from "./pages/WorkflowEditor";
import WorkflowRunnerPage from "./pages/WorkflowRunner";
import DifyWorkflowPage from "./pages/DifyWorkflow";
import { getAccessToken } from "./api";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const token = getAccessToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="workflow-editor" element={<WorkflowEditorPage />} />
        <Route path="dify-workflow" element={<DifyWorkflowPage />} />
        <Route path="workflow-runner" element={<WorkflowRunnerPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
