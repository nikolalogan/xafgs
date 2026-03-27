import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Empty, Input, Select, Space, Tooltip, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { GlobalParamDefinition, NodeDecisionConfig } from "../utils/types";

type Props = {
  value?: NodeDecisionConfig;
  availableParams: GlobalParamDefinition[];
  onChange?: (value: NodeDecisionConfig) => void;
};

const genID = () => Math.random().toString(36).slice(2, 10);

const defaultConfig: NodeDecisionConfig = {
  script: "// 示例：return 'branchCode';",
  inputs: [],
  branches: []
};

function DecisionConfigEditor(props: Props) {
  const { value, availableParams, onChange } = props;
  const [config, setConfig] = useState<NodeDecisionConfig>(value ?? defaultConfig);

  useEffect(() => {
    setConfig(value ?? defaultConfig);
  }, [value]);

  const trigger = useCallback(
    (next: NodeDecisionConfig) => {
      setConfig(next);
      onChange?.(next);
    },
    [onChange]
  );

  const availableOptions = useMemo(
    () =>
      availableParams.map((param) => ({
        label: `${param.name}（${param.field}）`,
        value: param.field
      })),
    [availableParams]
  );

  const addBranch = useCallback(() => {
    const nextBranches = [
      ...(config.branches ?? []),
      { id: genID(), name: `分支${(config.branches?.length ?? 0) + 1}`, code: `branch_${genID()}` }
    ];
    trigger({ ...config, branches: nextBranches });
  }, [config, trigger]);

  const updateBranch = useCallback(
    (id: string, patch: Partial<{ name: string; code: string }>) => {
      const nextBranches = (config.branches ?? []).map((branch) => (branch.id === id ? { ...branch, ...patch } : branch));
      trigger({ ...config, branches: nextBranches });
    },
    [config, trigger]
  );

  const removeBranch = useCallback(
    (id: string) => {
      const nextBranches = (config.branches ?? []).filter((branch) => branch.id !== id);
      trigger({ ...config, branches: nextBranches });
    },
    [config, trigger]
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Text strong>脚本逻辑</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          返回已在下方配置的分支编码字符串，脚本支持使用 <code>{"{{字段}}"}</code> 引用输入参数。
        </Typography.Paragraph>
        <Input.TextArea
          autoSize={{ minRows: 6 }}
          value={config.script}
          onChange={(event) => trigger({ ...config, script: event.target.value })}
          placeholder="// return 'branch_code';"
        />
      </div>

      <div>
        <Typography.Text strong>引用的全局参数</Typography.Text>
        <Select
          mode="multiple"
          allowClear
          style={{ width: "100%", marginTop: 8 }}
          placeholder="选择全局参数字段标识"
          options={availableOptions}
          value={config.inputs}
          onChange={(values) => trigger({ ...config, inputs: values })}
        />
      </div>

      <div>
        <Typography.Text strong>分支配置</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          定义可用的分支名称及编码，脚本需返回对应编码。
        </Typography.Paragraph>
        <Button icon={<PlusOutlined />} size="small" type="dashed" onClick={addBranch} style={{ marginBottom: 12 }}>
          新增分支
        </Button>
        {(config.branches ?? []).length === 0 ? (
          <Empty description="暂无分支" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {(config.branches ?? []).map((branch) => (
              <Card
                key={branch.id}
                size="small"
                type="inner"
                title={branch.name || "未命名分支"}
                extra={
                  <Tooltip title="删除分支">
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeBranch(branch.id)} />
                  </Tooltip>
                }
              >
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Input
                    value={branch.name}
                    onChange={(event) => updateBranch(branch.id, { name: event.target.value })}
                    placeholder="分支名称"
                  />
                  <Input
                    value={branch.code}
                    onChange={(event) => updateBranch(branch.id, { code: event.target.value })}
                    placeholder="分支编码（需在脚本中返回）"
                  />
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </div>
    </Space>
  );
}

export default DecisionConfigEditor;
