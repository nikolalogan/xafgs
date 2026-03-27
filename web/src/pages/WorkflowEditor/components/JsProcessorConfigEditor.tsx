import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Divider, Empty, Flex, Input, Select, Space, Tooltip, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { GlobalParamDefinition, JsOutputConfig, NodeJsConfig, SelectOption } from "../utils/types";

type Props = {
  value?: NodeJsConfig;
  availableParams: GlobalParamDefinition[];
  nodeID: string;
  onBeforeRemoveParam?: (writerNodeID: string, paramField: string) => Promise<boolean>;
  onChange?: (value: NodeJsConfig) => void;
};

const genID = () => Math.random().toString(36).slice(2, 10);

const defaultConfig: NodeJsConfig = {
  script: "// 在此编写 JS 逻辑，例如：return inputA + inputB;",
  inputs: [],
  outputs: []
};

function JsProcessorConfigEditor(props: Props) {
  const { value, availableParams, nodeID, onBeforeRemoveParam, onChange } = props;
  const [config, setConfig] = useState<NodeJsConfig>(value ?? defaultConfig);

  useEffect(() => {
    setConfig(value ?? defaultConfig);
  }, [value]);

  const trigger = useCallback(
    (next: NodeJsConfig) => {
      setConfig(next);
      onChange?.(next);
    },
    [onChange]
  );

  const updateOutputs = useCallback(
    (outputs: JsOutputConfig[]) => {
      trigger({ ...config, outputs });
    },
    [config, trigger]
  );

  const addOutput = useCallback(() => {
    const index = (config.outputs?.length ?? 0) + 1;
    const next: JsOutputConfig = {
      id: genID(),
      field: `output_${genID()}`,
      label: `输出参数${index}`,
      type: "input"
    };
    updateOutputs([...(config.outputs ?? []), next]);
  }, [config.outputs, updateOutputs]);

  const removeOutput = useCallback(
    async (id: string) => {
      const target = (config.outputs ?? []).find((output) => output.id === id);
      const field = target?.field?.trim();
      if (field && onBeforeRemoveParam) {
        const canRemove = await onBeforeRemoveParam(nodeID, field);
        if (!canRemove) return;
      }
      updateOutputs((config.outputs ?? []).filter((output) => output.id !== id));
    },
    [config.outputs, nodeID, onBeforeRemoveParam, updateOutputs]
  );

  const updateOutput = useCallback(
    (id: string, patch: Partial<JsOutputConfig>) => {
      const outputs = (config.outputs ?? []).map((output) =>
        output.id === id
          ? {
              ...output,
              ...patch,
              options: patch.type && patch.type !== "select" ? undefined : patch.options ?? output.options
            }
          : output
      );
      updateOutputs(outputs);
    },
    [config.outputs, updateOutputs]
  );

  const addOption = useCallback(
    (outputID: string) => {
      const outputs = (config.outputs ?? []).map((output) => {
        if (output.id !== outputID) return output;
        const options = output.options ?? [];
        const option: SelectOption = { id: genID(), name: "选项", value: "" };
        return { ...output, options: [...options, option] };
      });
      updateOutputs(outputs);
    },
    [config.outputs, updateOutputs]
  );

  const updateOption = useCallback(
    (outputID: string, optionID: string, patch: Partial<SelectOption>) => {
      const outputs = (config.outputs ?? []).map((output) => {
        if (output.id !== outputID) return output;
        const nextOptions = (output.options ?? []).map((option) => (option.id === optionID ? { ...option, ...patch } : option));
        return { ...output, options: nextOptions };
      });
      updateOutputs(outputs);
    },
    [config.outputs, updateOutputs]
  );

  const removeOption = useCallback(
    (outputID: string, optionID: string) => {
      const outputs = (config.outputs ?? []).map((output) => {
        if (output.id !== outputID) return output;
        const nextOptions = (output.options ?? []).filter((option) => option.id !== optionID);
        return { ...output, options: nextOptions };
      });
      updateOutputs(outputs);
    },
    [config.outputs, updateOutputs]
  );

  const availableOptions = useMemo(
    () =>
      availableParams.map((param) => ({
        label: `${param.name}（${param.field}）`,
        value: param.field
      })),
    [availableParams]
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Text strong>脚本逻辑</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          可直接在脚本中使用 <code>{"{{字段}}"}</code> 引用输入参数。
        </Typography.Paragraph>
        <Input.TextArea
          autoSize={{ minRows: 6 }}
          value={config.script}
          onChange={(event) => trigger({ ...config, script: event.target.value })}
          placeholder="// return {{a}} + {{b}};"
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
        <Typography.Text strong>输出的全局参数</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          声明脚本产出的新参数，保存后会同步到全局参数列表。
        </Typography.Paragraph>
        <Button icon={<PlusOutlined />} size="small" type="dashed" onClick={addOutput} style={{ marginBottom: 12 }}>
          新增输出参数
        </Button>
        {config.outputs.length === 0 ? (
          <Empty description="暂无输出参数" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Space direction="vertical" style={{ width: "100%" }} size={8}>
            {config.outputs.map((output) => (
              <Card
                key={output.id}
                size="small"
                title={`字段：${output.field}`}
                extra={
                  <Tooltip title="删除输出参数">
                    <Button danger size="small" icon={<DeleteOutlined />} onClick={() => void removeOutput(output.id)} />
                  </Tooltip>
                }
              >
                <Space direction="vertical" style={{ width: "100%" }} size={8}>
                  <Input
                    value={output.label}
                    onChange={(event) => updateOutput(output.id, { label: event.target.value })}
                    placeholder="参数名称"
                  />
                  <Input
                    value={output.field}
                    onChange={(event) => updateOutput(output.id, { field: event.target.value })}
                    placeholder="字段标识（全局唯一）"
                  />
                  <Select
                    value={output.type}
                    onChange={(type) => updateOutput(output.id, { type })}
                    options={[
                      { label: "文本", value: "input" },
                      { label: "文件", value: "file" },
                      { label: "选择", value: "select" }
                    ]}
                  />
                  {output.type === "select" ? (
                    <>
                      <Divider orientation="left" style={{ margin: "8px 0" }}>
                        选项
                      </Divider>
                      <Button icon={<PlusOutlined />} size="small" onClick={() => addOption(output.id)} style={{ marginBottom: 8 }}>
                        新增选项
                      </Button>
                      {(output.options ?? []).length === 0 ? (
                        <Empty description="暂无选项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : (
                        <Space direction="vertical" style={{ width: "100%" }} size={6}>
                          {(output.options ?? []).map((option) => (
                            <Flex key={option.id} gap={8} align="center">
                              <Input
                                style={{ width: 160 }}
                                placeholder="选项名称"
                                value={option.name}
                                onChange={(event) => updateOption(output.id, option.id, { name: event.target.value })}
                              />
                              <Input
                                style={{ width: 200 }}
                                placeholder="选项值"
                                value={option.value}
                                onChange={(event) => updateOption(output.id, option.id, { value: event.target.value })}
                              />
                              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeOption(output.id, option.id)} />
                            </Flex>
                          ))}
                        </Space>
                      )}
                    </>
                  ) : null}
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </div>
    </Space>
  );
}

export default JsProcessorConfigEditor;
