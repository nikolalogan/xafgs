import { Button, Space } from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { useReactFlow } from "@xyflow/react";

function ZoomInOut() {
  const instance = useReactFlow();

  return (
    <Space>
      <Button size="small" icon={<MinusOutlined />} onClick={() => instance.zoomOut({ duration: 150 })} />
      <Button size="small" icon={<PlusOutlined />} onClick={() => instance.zoomIn({ duration: 150 })} />
    </Space>
  );
}

export default ZoomInOut;

