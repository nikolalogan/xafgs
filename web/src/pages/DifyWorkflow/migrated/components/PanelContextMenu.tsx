import { Card, Button, Dropdown, Space, type MenuProps } from "antd";
import { PlusOutlined, CopyOutlined } from "@ant-design/icons";
import { useDifyWorkflowStore } from "../store";
import { BlockEnum } from "../types";

type Props = {
  onAddNode: (type: BlockEnum) => void;
  onPaste: () => void;
  hasClipboard: boolean;
  onClose: () => void;
};

function PanelContextMenu({ onAddNode, onPaste, hasClipboard, onClose }: Props) {
  const { panelMenu } = useDifyWorkflowStore();
  if (!panelMenu) return null;

  const addNodeItems: MenuProps["items"] = [
    { key: BlockEnum.Start, label: "Start" },
    { key: BlockEnum.Input, label: "Input" },
    { key: BlockEnum.LLM, label: "LLM" },
    { key: BlockEnum.IfElse, label: "If/Else" },
    { key: BlockEnum.HttpRequest, label: "HTTP Request" },
    { key: BlockEnum.Code, label: "Code" },
    { key: BlockEnum.End, label: "End" }
  ];

  return (
    <div style={{ position: "fixed", left: panelMenu.clientX, top: panelMenu.clientY, zIndex: 1200 }} onMouseLeave={onClose}>
      <Card size="small" styles={{ body: { padding: 8, minWidth: 120 } }}>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Dropdown
            trigger={["click"]}
            placement="bottomLeft"
            align={{ points: ["tl", "tr"], offset: [0, 0] }}
            menu={{
              items: addNodeItems,
              style: { width: 180 },
              onClick: ({ key }) => onAddNode(key as BlockEnum)
            }}
          >
            <Button type="text" icon={<PlusOutlined />} style={{ textAlign: "left", justifyContent: "flex-start" }}>
              添加节点
            </Button>
          </Dropdown>
          <Button
            type="text"
            icon={<CopyOutlined />}
            style={{ textAlign: "left", justifyContent: "flex-start" }}
            disabled={!hasClipboard}
            onClick={onPaste}
          >
            粘贴节点
          </Button>
        </Space>
      </Card>
    </div>
  );
}

export default PanelContextMenu;
