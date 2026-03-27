import { useMemo } from "react";
import { Alert, Card, Empty, Space, Tag, Typography } from "antd";
import { useSearchParams } from "react-router-dom";
import { getRunnerPayload } from "../../services/workflowStore";

function WorkflowRunnerPage() {
  const [searchParams] = useSearchParams();
  const payloadKey = searchParams.get("key");

  const payload = useMemo(() => {
    if (!payloadKey) return null;
    return getRunnerPayload(payloadKey);
  }, [payloadKey]);

  if (!payloadKey || !payload) {
    return (
      <Card>
        <Empty description="未找到可运行的流程数据" />
      </Card>
    );
  }

  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload.edges) ? payload.edges : [];

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Alert type="success" showIcon message="运行态已加载（浏览器版）" description="当前页面展示编辑器传入的流程快照，可继续扩展真实执行引擎。" />
      <Card title="运行摘要">
        <Space size={16} wrap>
          <Tag color="blue">节点数：{nodes.length}</Tag>
          <Tag color="purple">连线数：{edges.length}</Tag>
          <Tag color="green">Payload Key：{payloadKey}</Tag>
        </Space>
      </Card>
      <Card title="节点列表">
        <Space direction="vertical" style={{ width: "100%" }}>
          {nodes.map((node: any) => (
            <Typography.Text key={node.id}>
              {node.id} - {node.data?.name ?? "未命名"} ({node.data?.code ?? "-"})
            </Typography.Text>
          ))}
        </Space>
      </Card>
      <Card title="运行数据">
        <pre style={{ margin: 0, maxHeight: 360, overflow: "auto", background: "#fafafa", padding: 12, borderRadius: 6 }}>
          {JSON.stringify(payload, null, 2)}
        </pre>
      </Card>
    </Space>
  );
}

export default WorkflowRunnerPage;
