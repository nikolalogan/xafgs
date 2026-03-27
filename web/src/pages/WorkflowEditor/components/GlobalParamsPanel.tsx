import { useMemo } from "react";
import { Empty, Space, Tag, Typography } from "antd";
import type { Node } from "@xyflow/react";
import type { BaseNodeData, GlobalParamDefinition } from "../utils/types";

type Props = {
  params: GlobalParamDefinition[];
  nodes: Node<BaseNodeData, "baseNode">[];
};

function GlobalParamsPanel(props: Props) {
  const { params, nodes } = props;
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const formatNodeLabel = (nodeID: string | undefined) => {
    if (!nodeID) return "-";
    const node = nodeMap.get(nodeID);
    if (!node) return "-";
    const code = (node.data?.code ?? "").trim() || "-";
    return `${node.type}+${code}`;
  };

  const formatUsage = (param: GlobalParamDefinition) => {
    const usageSet = new Set<string>([...param.consumerNodeIds]);
    if (usageSet.size === 0) return "-";
    const labels = Array.from(usageSet)
      .map((id) => formatNodeLabel(id))
      .filter((label) => label && label !== "-");
    return labels.length > 0 ? labels.join("，") : "-";
  };

  return (
    <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 16, background: "#fff" }}>
      <Typography.Title level={5} style={{ margin: 0, marginBottom: 12 }}>
        全局参数
      </Typography.Title>

      {params.length === 0 ? (
        <Empty description="暂无全局参数" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {params.map((param) => (
            <div
              key={param.id}
              style={{
                border: "1px solid #f0f0f0",
                borderRadius: 6,
                padding: 12,
                background: "#fafafa"
              }}
            >
              <Typography.Text strong>{param.name || "未命名参数"}</Typography.Text>
              <Space direction="vertical" size={4} style={{ display: "block", marginTop: 8 }}>
                <Typography.Text type="secondary">字段标识：{param.field || "-"}</Typography.Text>
                <Typography.Text type="secondary">类型：{param.type}</Typography.Text>
                <Typography.Text>写入：{`${param.writerNodeType}+${(param.writerNodeCode || "").trim() || "-"}`}</Typography.Text>
                <Typography.Text>使用：{formatUsage(param)}</Typography.Text>
                {param.type === "select" && (param.options ?? []).length > 0 ? (
                  <div>
                    <Typography.Text type="secondary">选项：</Typography.Text>
                    <Space size={4} wrap>
                      {(param.options ?? []).map((opt) => (
                        <Tag key={opt.id}>{`${opt.name || "未命名"}(${opt.value || "-"})`}</Tag>
                      ))}
                    </Space>
                  </div>
                ) : null}
              </Space>
            </div>
          ))}
        </Space>
      )}
    </div>
  );
}

export default GlobalParamsPanel;
