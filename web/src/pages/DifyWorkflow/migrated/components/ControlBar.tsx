import { useState } from "react";
import { Button, Space, Tooltip } from "antd";
import { PlusOutlined, AimOutlined, DragOutlined } from "@ant-design/icons";
import { useDifyWorkflowStore } from "../store";
import MoreActions from "./MoreActions";

type Props = {
  onOpenBlockSelector: () => void;
  onAutoLayout: () => void;
  onFitView: () => void;
  onReset: () => void;
};

function ControlBar({ onOpenBlockSelector, onAutoLayout, onFitView, onReset }: Props) {
  const { controlMode, setControlMode } = useDifyWorkflowStore();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        top: 12,
        zIndex: 10,
        padding: 6,
        borderRadius: 10,
        background: "#fff",
        border: "1px solid #eaecf0",
        boxShadow: hovered ? "0 4px 12px rgba(16,24,40,0.12)" : "0 1px 2px rgba(16,24,40,0.08)"
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Space direction="vertical" size={6}>
        <Tooltip title="Add Block">
          <Button icon={<PlusOutlined />} onClick={onOpenBlockSelector} />
        </Tooltip>
        <Tooltip title="Pointer Mode">
          <Button type={controlMode === "pointer" ? "primary" : "default"} icon={<AimOutlined />} onClick={() => setControlMode("pointer")} />
        </Tooltip>
        <Tooltip title="Hand Mode">
          <Button type={controlMode === "hand" ? "primary" : "default"} icon={<DragOutlined />} onClick={() => setControlMode("hand")} />
        </Tooltip>
        <MoreActions onAutoLayout={onAutoLayout} onFitView={onFitView} onReset={onReset} />
      </Space>
    </div>
  );
}

export default ControlBar;
