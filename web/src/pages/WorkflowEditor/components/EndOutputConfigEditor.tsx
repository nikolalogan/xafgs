import { useMemo } from "react";
import { Checkbox, Empty, Space, Typography } from "antd";
import type { GlobalParamDefinition, NodeEndConfig } from "../utils/types";

type Props = {
  value?: NodeEndConfig;
  availableParams: GlobalParamDefinition[];
  onChange: (config?: NodeEndConfig) => void;
};

function EndOutputConfigEditor(props: Props) {
  const { value, availableParams, onChange } = props;
  const selected = value?.outputs ?? [];

  const options = useMemo(
    () =>
      availableParams.map((param) => ({
        label: `${param.name || "未命名"}(${param.field || "-"})`,
        value: param.field
      })),
    [availableParams]
  );

  if (availableParams.length === 0) {
    return <Empty description="暂无可选择的全局参数" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Typography.Text strong>选择最终输出的全局参数</Typography.Text>
      <Checkbox.Group options={options} value={selected} onChange={(values) => onChange({ outputs: (values as string[]) ?? [] })} />
      <Typography.Text type="secondary">提示：仅勾选后将作为工作流最终输出。</Typography.Text>
    </Space>
  );
}

export default EndOutputConfigEditor;
