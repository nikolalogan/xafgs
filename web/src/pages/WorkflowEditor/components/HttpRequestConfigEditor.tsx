import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Empty, Flex, Input, Select, Space, Switch, Tooltip, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { GlobalParamDefinition, HttpHeaderConfig, JsOutputConfig, NodeHttpConfig, SelectOption } from "../utils/types";

type Props = {
  value?: NodeHttpConfig;
  availableParams: GlobalParamDefinition[];
  nodeID: string;
  onBeforeRemoveParam?: (writerNodeID: string, paramField: string) => Promise<boolean>;
  onChange?: (value: NodeHttpConfig) => void;
};

const genID = () => Math.random().toString(36).slice(2, 10);

const defaultConfig: NodeHttpConfig = {
  method: "GET",
  url: "",
  inputs: [],
  headers: [],
  bodyMode: "none",
  outputs: []
};

function HttpRequestConfigEditor(props: Props) {
  const { value, availableParams, nodeID, onBeforeRemoveParam, onChange } = props;
  const [config, setConfig] = useState<NodeHttpConfig>(value ?? defaultConfig);

  useEffect(() => {
    setConfig(value ?? defaultConfig);
  }, [value]);

  const trigger = useCallback(
    (next: NodeHttpConfig) => {
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

  const updateHeaders = useCallback(
    (headers: HttpHeaderConfig[]) => {
      trigger({ ...config, headers });
    },
    [config, trigger]
  );

  const addHeader = useCallback(() => {
    updateHeaders([...(config.headers ?? []), { id: genID(), key: "", value: "" }]);
  }, [config.headers, updateHeaders]);

  const updateHeader = useCallback(
    (id: string, patch: Partial<HttpHeaderConfig>) => {
      const nextHeaders = (config.headers ?? []).map((header) => (header.id === id ? { ...header, ...patch } : header));
      updateHeaders(nextHeaders);
    },
    [config.headers, updateHeaders]
  );

  const removeHeader = useCallback(
    (id: string) => {
      const nextHeaders = (config.headers ?? []).filter((header) => header.id !== id);
      updateHeaders(nextHeaders);
    },
    [config.headers, updateHeaders]
  );

  const updateOutputs = useCallback(
    (outputs: JsOutputConfig[]) => {
      trigger({ ...config, outputs });
    },
    [config, trigger]
  );

  const addOutput = useCallback(() => {
    const next: JsOutputConfig = {
      id: genID(),
      field: `response_${genID()}`,
      label: "响应参数",
      type: "input",
      path: ""
    };
    updateOutputs([...(config.outputs ?? []), next]);
  }, [config.outputs, updateOutputs]);

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

  const addOption = useCallback(
    (outputID: string) => {
      const outputs = (config.outputs ?? []).map((output) => {
        if (output.id !== outputID) return output;
        const options = output.options ?? [];
        return { ...output, options: [...options, { id: genID(), name: "选项", value: "" }] };
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

  const methodOptions = useMemo(
    () => [
      { label: "GET", value: "GET" },
      { label: "POST", value: "POST" },
      { label: "PUT", value: "PUT" },
      { label: "PATCH", value: "PATCH" },
      { label: "DELETE", value: "DELETE" }
    ],
    []
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Text strong>请求基础信息</Typography.Text>
        <Space style={{ width: "100%", marginTop: 8 }} size={8}>
          <Select
            style={{ width: 120 }}
            options={methodOptions}
            value={config.method}
            onChange={(method) => {
              const next: NodeHttpConfig = { ...config, method };
              if (method === "GET") {
                next.bodyMode = "none";
                next.bodyTemplate = undefined;
              }
              trigger(next);
            }}
          />
          <Input
            value={config.url}
            onChange={(event) => trigger({ ...config, url: event.target.value })}
            placeholder="https://example.com/api"
          />
        </Space>
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
        <Typography.Text strong>请求头部</Typography.Text>
        <Button size="small" style={{ margin: "8px 0" }} icon={<PlusOutlined />} onClick={addHeader}>
          新增 Header
        </Button>
        {(config.headers ?? []).length === 0 ? (
          <Empty description="暂无请求头" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {config.headers.map((header) => (
              <Space key={header.id} align="center" style={{ width: "100%" }} size={8}>
                <Input
                  style={{ width: "40%" }}
                  placeholder="Header Key"
                  value={header.key}
                  onChange={(event) => updateHeader(header.id, { key: event.target.value })}
                />
                <Input
                  style={{ width: "45%" }}
                  placeholder="Header Value (支持 {{字段}})"
                  value={header.value}
                  onChange={(event) => updateHeader(header.id, { value: event.target.value })}
                />
                <Tooltip title="删除 Header">
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeHeader(header.id)} />
                </Tooltip>
              </Space>
            ))}
          </Space>
        )}
      </div>

      <div>
        <Typography.Text strong>请求体</Typography.Text>
        <Flex align="center" gap={8} style={{ margin: "8px 0" }}>
          <span>启用请求体</span>
          <Switch
            checked={config.bodyMode !== "none"}
            disabled={config.method === "GET"}
            onChange={(checked) => trigger({ ...config, bodyMode: checked ? "json" : "none", bodyTemplate: checked ? "{}" : undefined })}
          />
          {config.bodyMode !== "none" ? (
            <Select
              style={{ width: 120 }}
              value={config.bodyMode}
              disabled={config.method === "GET"}
              onChange={(mode) => trigger({ ...config, bodyMode: mode })}
              options={[
                { label: "JSON", value: "json" },
                { label: "文本", value: "text" }
              ]}
            />
          ) : null}
        </Flex>
        {config.bodyMode !== "none" ? (
          <Input.TextArea
            autoSize={{ minRows: 6 }}
            value={config.bodyTemplate}
            onChange={(event) => trigger({ ...config, bodyTemplate: event.target.value })}
            placeholder={config.bodyMode === "json" ? '{ "userId": "{{uid}}" }' : "name={{userName}}"}
          />
        ) : null}
      </div>

      <div>
        <Typography.Text strong>响应参数</Typography.Text>
        <Button icon={<PlusOutlined />} size="small" type="dashed" onClick={addOutput} style={{ margin: "8px 0 12px" }}>
          新增响应参数
        </Button>
        {(config.outputs ?? []).length === 0 ? (
          <Empty description="暂无响应参数" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Space direction="vertical" style={{ width: "100%" }} size={8}>
            {(config.outputs ?? []).map((output) => (
              <Card
                key={output.id}
                size="small"
                type="inner"
                title={output.label || "响应字段"}
                extra={
                  <Tooltip title="删除响应参数">
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void removeOutput(output.id)} />
                  </Tooltip>
                }
              >
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
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
                  <Input
                    value={output.path}
                    onChange={(event) => updateOutput(output.id, { path: event.target.value })}
                    placeholder="取值路径，例如：data.token"
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
                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                      <Button size="small" type="dashed" onClick={() => addOption(output.id)}>
                        新增选项
                      </Button>
                      {(output.options ?? []).map((option) => (
                        <Space key={option.id}>
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
                        </Space>
                      ))}
                    </Space>
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

export default HttpRequestConfigEditor;
