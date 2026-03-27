import { Card, Button } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useDifyWorkflowStore } from "../store";

type Props = {
  onDeleteSelection: () => void;
  onClose: () => void;
};

function SelectionContextMenu({ onDeleteSelection, onClose }: Props) {
  const { selectionMenu } = useDifyWorkflowStore();
  if (!selectionMenu) return null;

  return (
    <div style={{ position: "fixed", left: selectionMenu.clientX, top: selectionMenu.clientY, zIndex: 1200 }} onMouseLeave={onClose}>
      <Card size="small" styles={{ body: { padding: 8 } }}>
        <Button type="text" danger icon={<DeleteOutlined />} onClick={onDeleteSelection}>
          删除选中项
        </Button>
      </Card>
    </div>
  );
}

export default SelectionContextMenu;

