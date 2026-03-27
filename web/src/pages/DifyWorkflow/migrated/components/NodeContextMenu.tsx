import { Card, Button, Space, Typography } from "antd";
import { CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import { useDifyWorkflowStore } from "../store";

type Props = {
  onCopyNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
};

function NodeContextMenu({ onCopyNode, onDeleteNode, onClose }: Props) {
  const { nodeMenu } = useDifyWorkflowStore();
  if (!nodeMenu?.nodeId) return null;

  return (
    <div style={{ position: "fixed", left: nodeMenu.clientX, top: nodeMenu.clientY, zIndex: 1200 }} onMouseLeave={onClose}>
      <Card size="small" styles={{ body: { padding: 8, minWidth: 200 } }}>
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            节点：{nodeMenu.nodeId}
          </Typography.Text>
          <Button type="text" icon={<CopyOutlined />} onClick={() => onCopyNode(nodeMenu.nodeId!)}>
            复制节点
          </Button>
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => onDeleteNode(nodeMenu.nodeId!)}>
            删除节点
          </Button>
        </Space>
      </Card>
    </div>
  );
}

export default NodeContextMenu;
