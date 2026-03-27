import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Empty, Input, Modal, Space, Typography } from "antd";
import type { NodeDecisionConfig, NodeHttpConfig, NodeJsConfig } from "../utils/types";
import { transformScriptPlaceholders } from "../utils/script";

type ScriptTestMode = "processor" | "decision" | "http";

type Props = {
  open: boolean;
  onClose: () => void;
  mode: ScriptTestMode;
  jsConfig?: NodeJsConfig;
  decisionConfig?: NodeDecisionConfig;
  httpConfig?: NodeHttpConfig;
};

const parseValue = (raw: string) => {
  const value = raw.trim();
  if (value === "") return "";
  try {
    return JSON.parse(value);
  } catch {
    if (value === "true") return true;
    if (value === "false") return false;
    if (!Number.isNaN(Number(value))) return Number(value);
    return raw;
  }
};

function ScriptTestModal(props: Props) {
  const { open, onClose, mode, jsConfig, decisionConfig, httpConfig } = props;
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  const inputs = useMemo(() => {
    if (mode === "processor") return jsConfig?.inputs ?? [];
    if (mode === "decision") return decisionConfig?.inputs ?? [];
    return httpConfig?.inputs ?? [];
  }, [decisionConfig?.inputs, httpConfig?.inputs, jsConfig?.inputs, mode]);

  useEffect(() => {
    if (!open) return;
    const initialValues: Record<string, string> = {};
    inputs.forEach((field) => {
      initialValues[field] = "";
    });
    setInputValues(initialValues);
    setResult(undefined);
    setError(null);
    setExecuting(false);
  }, [inputs, open]);

  const handleChange = useCallback((field: string, value: string) => {
    setInputValues((previous) => ({ ...previous, [field]: value }));
  }, []);

  const applyTemplate = useCallback((template: string | undefined, context: Record<string, unknown>) => {
    if (!template) return "";
    return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
      const value = context[key];
      return value === undefined || value === null ? "" : String(value);
    });
  }, []);

  const executeScript = useCallback(async () => {
    setError(null);
    setResult(undefined);
    setExecuting(true);

    try {
      const contextParams: Record<string, unknown> = {};
      inputs.forEach((field) => {
        contextParams[field] = parseValue(inputValues[field] ?? "");
      });

      if (mode === "processor") {
        if (!jsConfig?.script) throw new Error("当前节点尚未配置脚本");
        const runScript = new Function("context", transformScriptPlaceholders(jsConfig.script));
        setResult(runScript({ params: contextParams }));
        return;
      }

      if (mode === "decision") {
        if (!decisionConfig?.script) throw new Error("当前节点尚未配置脚本");
        const runScript = new Function("context", transformScriptPlaceholders(decisionConfig.script));
        setResult(runScript({ params: contextParams }));
        return;
      }

      if (!httpConfig) throw new Error("当前节点尚未配置请求信息");
      const finalURL = applyTemplate(httpConfig.url, contextParams);
      if (!finalURL) throw new Error("请求 URL 为空，无法发送请求");

      const headers: Record<string, string> = {};
      (httpConfig.headers ?? []).forEach((header) => {
        if (!header.key) return;
        headers[applyTemplate(header.key, contextParams)] = applyTemplate(header.value, contextParams);
      });

      const requestInit: RequestInit = {
        method: httpConfig.method,
        headers
      };

      if (httpConfig.bodyMode !== "none") {
        const bodyTemplate = applyTemplate(httpConfig.bodyTemplate ?? "", contextParams);
        if (httpConfig.bodyMode === "json") {
          requestInit.body = JSON.stringify(bodyTemplate ? JSON.parse(bodyTemplate) : {});
          requestInit.headers = { ...headers, "Content-Type": "application/json" };
        } else {
          requestInit.body = bodyTemplate;
          requestInit.headers = { ...headers, "Content-Type": "text/plain;charset=UTF-8" };
        }
      }

      const response = await fetch(finalURL, requestInit);
      const raw = await response.text();
      try {
        setResult(JSON.parse(raw));
      } catch {
        setResult(raw);
      }
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : String(exception));
    } finally {
      setExecuting(false);
    }
  }, [applyTemplate, decisionConfig?.script, httpConfig, inputValues, inputs, jsConfig?.script, mode]);

  return (
    <Modal
      title="脚本测试"
      open={open}
      width={920}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
      destroyOnHidden
    >
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          <Card size="small" title="输入参数">
            {inputs.length === 0 ? (
              <Empty description="无输入参数" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                {inputs.map((field) => (
                  <div key={field}>
                    <Typography.Text>{field}</Typography.Text>
                    <Input
                      value={inputValues[field]}
                      onChange={(event) => handleChange(field, event.target.value)}
                      placeholder="可输入 JSON、数值或文本"
                      style={{ marginTop: 4 }}
                    />
                  </div>
                ))}
              </Space>
            )}
          </Card>

          <Space>
            <Button type="primary" loading={executing} onClick={() => void executeScript()}>
              {mode === "http" ? "发送请求" : "执行测试"}
            </Button>
            {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
          </Space>

          <Card size="small" title="执行结果">
            {result === undefined ? (
              <Typography.Text type="secondary">暂无执行结果</Typography.Text>
            ) : (
              <pre style={{ background: "#f5f5f5", padding: 12, borderRadius: 4, margin: 0, whiteSpace: "pre-wrap" }}>
                {typeof result === "object" ? JSON.stringify(result, null, 2) : String(result)}
              </pre>
            )}
          </Card>
        </div>
      </div>
    </Modal>
  );
}

export default ScriptTestModal;
