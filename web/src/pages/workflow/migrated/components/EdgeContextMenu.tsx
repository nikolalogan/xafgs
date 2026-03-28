import { Card, Button, Space } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useWorkflowStore } from "../store";

type Props = {
  onDelete: (edgeId: string) => void;
  onClose: () => void;
};

function EdgeContextMenu({ onDelete, onClose }: Props) {
  const { edgeMenu } = useWorkflowStore();
  if (!edgeMenu?.edgeId) return null;

  return (
    <div style={{ position: "fixed", left: edgeMenu.clientX, top: edgeMenu.clientY, zIndex: 1200 }} onMouseLeave={onClose}>
      <Card size="small" styles={{ body: { padding: 8 } }}>
        <Space direction="vertical" size={4}>
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => onDelete(edgeMenu.edgeId!)}>
            删除连线
          </Button>
        </Space>
      </Card>
    </div>
  );
}

export default EdgeContextMenu;

