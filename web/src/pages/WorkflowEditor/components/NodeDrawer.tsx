import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Divider, Drawer, Empty, Form, Input, Modal, Space, message } from "antd";
import type { BaseNodeData, GlobalParamDefinition, NodeDecisionConfig, NodeHttpConfig, NodeJsConfig, NodeParams } from "../utils/types";
import FormConfigEditor from "./FormConfig/FormConfigEditor";
import JsProcessorConfigEditor from "./JsProcessorConfigEditor";
import DecisionConfigEditor from "./DecisionConfigEditor";
import ScriptTestModal from "./ScriptTestModal";
import HttpRequestConfigEditor from "./HttpRequestConfigEditor";
import EndOutputConfigEditor from "./EndOutputConfigEditor";

type NodeDrawerProps = {
  open: boolean;
  onClose: () => void;
  data?: BaseNodeData;
  onChange: (data: BaseNodeData) => void;
  nodeId?: string;
  globalParams: GlobalParamDefinition[];
  availableParams: GlobalParamDefinition[];
  onBeforeRemoveParam?: (writerNodeID: string, paramField: string) => Promise<boolean>;
  onDeleteNode?: (nodeID: string) => Promise<void>;
};

function NodeDrawer(props: NodeDrawerProps) {
  const { open, onClose, data, onChange, nodeId, globalParams, availableParams, onBeforeRemoveParam, onDeleteNode } = props;
  const [form] = Form.useForm<BaseNodeData>();
  const [testOpen, setTestOpen] = useState(false);
  const params: NodeParams | undefined = data?.params;
  const nodeCode = (data?.code || "").toLowerCase();
  const supportsFormParams = new Set(["start", "input"]);
  const canEditFormParams = supportsFormParams.has(nodeCode);
  const isProcessorNode = nodeCode === "processor";
  const isDecisionNode = nodeCode === "decision";
  const isHTTPNode = nodeCode === "http";
  const isEndNode = nodeCode === "end";
  const jsConfig: NodeJsConfig | undefined = params?.jsConfig;
  const decisionConfig: NodeDecisionConfig | undefined = params?.decisionConfig;
  const httpConfig: NodeHttpConfig | undefined = params?.httpConfig;

  useEffect(() => {
    form.setFieldsValue({ name: data?.name, code: data?.code });
  }, [data, form]);

  useEffect(() => {
    if (!open) setTestOpen(false);
  }, [open]);

  const mergeAndSubmit = useCallback(
    (patch: Partial<NodeParams>) => {
      const values = form.getFieldsValue();
      const nextParams: NodeParams = { ...(params ?? {}), ...patch };
      if (isProcessorNode) {
        delete nextParams.decisionConfig;
        delete nextParams.httpConfig;
        delete nextParams.endConfig;
      }
      if (isDecisionNode) {
        delete nextParams.jsConfig;
        delete nextParams.httpConfig;
        delete nextParams.endConfig;
      }
      if (isHTTPNode) {
        delete nextParams.jsConfig;
        delete nextParams.decisionConfig;
        delete nextParams.endConfig;
      }
      if (isEndNode) {
        delete nextParams.jsConfig;
        delete nextParams.decisionConfig;
        delete nextParams.httpConfig;
      }
      onChange({ name: values.name ?? "", code: values.code ?? "", params: nextParams });
    },
    [form, isDecisionNode, isEndNode, isHTTPNode, isProcessorNode, onChange, params]
  );

  const handleValidate = useCallback(() => {
    if (!data?.validate) {
      message.info("当前节点无需校验");
      return;
    }
    const result = data.validate({ data, globalParams });
    if (result.ok) {
      message.success("校验通过");
    } else {
      Modal.error({
        title: "校验未通过",
        content: (
          <Space direction="vertical" size={4} style={{ marginTop: 8 }}>
            {result.messages.map((msg, idx) => (
              <div key={idx}>{msg}</div>
            ))}
          </Space>
        )
      });
    }
  }, [data, globalParams]);

  const handleTest = useCallback(() => {
    if (isProcessorNode && !jsConfig) {
      message.warning("请先配置脚本与输入");
      return;
    }
    if (isDecisionNode && !decisionConfig) {
      message.warning("请先配置分支脚本");
      return;
    }
    if (isHTTPNode && !httpConfig) {
      message.warning("请先配置请求信息");
      return;
    }
    setTestOpen(true);
  }, [decisionConfig, httpConfig, isDecisionNode, isHTTPNode, isProcessorNode, jsConfig]);

  const testMode = useMemo(() => {
    if (isProcessorNode) return "processor" as const;
    if (isDecisionNode) return "decision" as const;
    if (isHTTPNode) return "http" as const;
    return null;
  }, [isDecisionNode, isHTTPNode, isProcessorNode]);

  return (
    <>
      <Drawer title="节点属性" width={480} open={open} onClose={onClose} destroyOnHidden>
        <Divider orientation="left" style={{ marginTop: 0 }}>
          基础属性
        </Divider>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ name: data?.name, code: data?.code }}
          onValuesChange={(_, all) => {
            onChange({ name: all.name ?? "", code: all.code ?? "", params });
          }}
        >
          <Form.Item label="节点名称" name="name" rules={[{ required: true, message: "请输入节点名称" }]}>
            <Input placeholder="例如：开始节点" allowClear />
          </Form.Item>
          <Form.Item label="节点编码" name="code" rules={[{ required: true, message: "请输入节点编码" }]}>
            <Input placeholder="例如：start" allowClear />
          </Form.Item>
        </Form>

        {nodeId ? (
          <Space style={{ marginBottom: 12 }}>
            <Button
              danger
              onClick={() => {
                if (!onDeleteNode) return;
                void onDeleteNode(nodeId);
              }}
            >
              删除当前节点
            </Button>
          </Space>
        ) : null}

        <Divider orientation="left">节点参数</Divider>
        {canEditFormParams ? (
          <FormConfigEditor
            value={params}
            nodeID={nodeId ?? ""}
            onBeforeRemoveParam={onBeforeRemoveParam}
            onChange={(value) => {
              mergeAndSubmit(value);
            }}
          />
        ) : isProcessorNode ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <JsProcessorConfigEditor
              value={jsConfig}
              nodeID={nodeId ?? ""}
              availableParams={availableParams}
              onBeforeRemoveParam={onBeforeRemoveParam}
              onChange={(config) => mergeAndSubmit({ jsConfig: config })}
            />
            <Space>
              <Button type="primary" onClick={handleValidate}>
                校验配置
              </Button>
              <Button onClick={handleTest}>测试脚本</Button>
            </Space>
          </Space>
        ) : isDecisionNode ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <DecisionConfigEditor
              value={decisionConfig}
              availableParams={availableParams}
              onChange={(config) => mergeAndSubmit({ decisionConfig: config })}
            />
            <Space>
              <Button type="primary" onClick={handleValidate}>
                校验配置
              </Button>
              <Button onClick={handleTest}>测试脚本</Button>
            </Space>
          </Space>
        ) : isHTTPNode ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <HttpRequestConfigEditor
              value={httpConfig}
              nodeID={nodeId ?? ""}
              availableParams={availableParams}
              onBeforeRemoveParam={onBeforeRemoveParam}
              onChange={(config) => mergeAndSubmit({ httpConfig: config })}
            />
            <Space>
              <Button type="primary" onClick={handleValidate}>
                校验配置
              </Button>
              <Button onClick={handleTest}>测试请求</Button>
            </Space>
          </Space>
        ) : isEndNode ? (
          <EndOutputConfigEditor
            value={params?.endConfig}
            availableParams={availableParams}
            onChange={(config) => mergeAndSubmit({ endConfig: config })}
          />
        ) : (
          <Empty description="预留区域，后续扩展" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Drawer>

      {testMode ? (
        <ScriptTestModal
          open={testOpen}
          onClose={() => setTestOpen(false)}
          mode={testMode}
          jsConfig={jsConfig}
          decisionConfig={decisionConfig}
          httpConfig={httpConfig}
        />
      ) : null}
    </>
  );
}

export default NodeDrawer;
