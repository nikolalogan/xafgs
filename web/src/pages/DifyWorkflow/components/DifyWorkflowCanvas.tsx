import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { App, Button, Form, Input, Modal, Select, Space, Switch, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, UploadOutlined } from "@ant-design/icons";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
  type ReactFlowInstance
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useNavigate } from "react-router-dom";
import demoFlow from "../../WorkflowEditor/demo.json";
import NodeDrawer from "../../WorkflowEditor/components/NodeDrawer";
import GlobalParamsPanel from "../../WorkflowEditor/components/GlobalParamsPanel";
import BaseNode from "../../WorkflowEditor/components/nodes/BaseNode";
import type { BaseNodeData } from "../../WorkflowEditor/utils/types";
import { buildParamGraphIndex } from "../../WorkflowEditor/utils/paramIndex";
import { defaultNodeValidate, validateDecisionNode, validateHttpNode, validateProcessorNode } from "../../WorkflowEditor/utils/validation";
import { getWorkflowByCode, saveRunnerPayload, saveWorkflow } from "../../../services/workflowStore";

const initialNodes: Node<BaseNodeData, "baseNode">[] = (demoFlow as any).nodes ?? [];
const initialEdges: Edge[] = (demoFlow as any).edges ?? [];
const nodeTypes = { baseNode: BaseNode } as const;

const containerStyle: CSSProperties = {
  width: "100%",
  height: "70vh",
  minHeight: 560,
  border: "1px solid #f0f0f0",
  borderRadius: 8,
  background: "#fafafa"
};

const leftPanelStyle: CSSProperties = {
  width: 228,
  minWidth: 228,
  border: "1px solid #f0f0f0",
  borderRadius: 8,
  background: "#fff",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 12
};

const statusOptions = [
  { label: "草稿", value: "draft" },
  { label: "评审中", value: "review" },
  { label: "已上线", value: "online" },
  { label: "归档", value: "archived" }
] as const;

type WorkflowDetailMeta = {
  id?: number;
  workflow_code: string;
  name: string;
  version?: string;
  status?: string;
  is_public?: boolean;
  summary?: string;
  workflow_description?: string;
  owner?: string;
  tags?: string[];
  metadata_json?: string;
};

type WorkflowDefinitionGraph = {
  nodes?: Node<BaseNodeData, "baseNode">[];
  edges?: Edge[];
};

const cloneNodes = (source: Node<BaseNodeData, "baseNode">[]) =>
  source.map((node) => ({
    ...node,
    data: { ...node.data },
    position: { ...node.position }
  }));

const cloneEdges = (source: Edge[]) => source.map((edge) => ({ ...edge }));

const getFallbackNodes = () => cloneNodes(initialNodes);
const getFallbackEdges = () => cloneEdges(initialEdges);

const safeParseDefinition = (
  raw: unknown
): {
  graph: WorkflowDefinitionGraph;
  parseFailed: boolean;
} => {
  if (!raw) return { graph: {}, parseFailed: false };
  if (typeof raw === "string") {
    try {
      return { graph: JSON.parse(raw) as WorkflowDefinitionGraph, parseFailed: false };
    } catch {
      return { graph: {}, parseFailed: true };
    }
  }
  if (typeof raw === "object") return { graph: raw as WorkflowDefinitionGraph, parseFailed: false };
  return { graph: {}, parseFailed: false };
};

type NodeBlueprint = {
  label: string;
  code: string;
  color: string;
  buildParams?: () => BaseNodeData["params"];
};

const nodeBlueprints: NodeBlueprint[] = [
  { label: "开始节点", code: "start", color: "green" },
  { label: "输入节点", code: "input", color: "gold", buildParams: () => ({ forms: [] }) },
  {
    label: "处理节点",
    code: "processor",
    color: "blue",
    buildParams: () => ({
      jsConfig: {
        script: "// TODO: 返回处理结果",
        inputs: [],
        outputs: []
      }
    })
  },
  {
    label: "决策节点",
    code: "decision",
    color: "purple",
    buildParams: () => ({
      decisionConfig: {
        script: "// TODO: return 'branch_code';",
        inputs: [],
        branches: []
      }
    })
  },
  {
    label: "HTTP节点",
    code: "http",
    color: "cyan",
    buildParams: () => ({
      httpConfig: {
        method: "GET",
        url: "",
        inputs: [],
        headers: [],
        bodyMode: "none",
        outputs: []
      }
    })
  },
  {
    label: "结束节点",
    code: "end",
    color: "red",
    buildParams: () => ({
      endConfig: {
        outputs: []
      }
    })
  }
];

const resolveValidate = (code: string) => {
  if (code === "processor") return validateProcessorNode;
  if (code === "decision") return validateDecisionNode;
  if (code === "http") return validateHttpNode;
  return defaultNodeValidate;
};

function DifyWorkflowCanvas() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const reactFlowRef = useRef<ReactFlowInstance<Node<BaseNodeData, "baseNode">, Edge> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BaseNodeData, "baseNode">>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeID, setActiveID] = useState<string | null>(null);
  const [selectedNodeIDs, setSelectedNodeIDs] = useState<string[]>([]);
  const [selectedEdgeIDs, setSelectedEdgeIDs] = useState<string[]>([]);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [exportContent, setExportContent] = useState("");
  const [importContent, setImportContent] = useState("");
  const [saveForm] = Form.useForm();
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowDetailMeta | null>(null);
  const nodeIDRef = useRef(initialNodes.length + 1);

  const { workflowID, editorMode } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("workflowId") ?? undefined;
    const modeParam = params.get("mode");
    const normalizedMode = modeParam === "edit" || modeParam === "create" ? modeParam : code ? "edit" : "create";
    return { workflowID: code, editorMode: normalizedMode };
  }, []);

  const isEditMode = editorMode === "edit" && !!workflowID;

  const applyDetailToForm = useCallback(
    (detail: WorkflowDetailMeta) => {
      saveForm.setFieldsValue({
        workflow_code: detail.workflow_code,
        name: detail.name,
        version: detail.version ?? "1.0.0",
        status: detail.status ?? "draft",
        is_public: detail.is_public ?? false,
        summary: detail.summary ?? "",
        workflow_description: detail.workflow_description ?? "",
        owner: detail.owner ?? "",
        tags: detail.tags ?? [],
        metadata_json: detail.metadata_json ?? ""
      });
    },
    [saveForm]
  );

  useEffect(() => {
    if (!workflowID) return;
    const record = getWorkflowByCode(workflowID);
    if (!record) {
      message.warning("未找到对应工作流，已加载默认模板");
      return;
    }
    const parsedResult = safeParseDefinition(record.definition_json);
    if (parsedResult.parseFailed) message.warning("流程数据解析失败，已加载默认模板");
    const parsed = parsedResult.graph;
    const nextNodes = Array.isArray(parsed.nodes) ? parsed.nodes : getFallbackNodes();
    const nextEdges = Array.isArray(parsed.edges) ? parsed.edges : getFallbackEdges();
    setNodes(nextNodes);
    setEdges(nextEdges);
    nodeIDRef.current = nextNodes.length + 1;
    const detailMeta: WorkflowDetailMeta = {
      id: record.id,
      workflow_code: record.workflow_code,
      name: record.name,
      version: record.version ?? "1.0.0",
      status: record.status ?? "draft",
      is_public: record.is_public ?? false,
      summary: record.summary ?? "",
      workflow_description: record.workflow_description ?? "",
      owner: record.owner ?? "",
      tags: record.tags ?? [],
      metadata_json: record.metadata_json ?? ""
    };
    applyDetailToForm(detailMeta);
    setWorkflowDetail(detailMeta);
  }, [applyDetailToForm, message, setEdges, setNodes, workflowID]);

  const paramGraphIndex = useMemo(() => buildParamGraphIndex(nodes, edges), [edges, nodes]);
  const globalParams = useMemo(() => paramGraphIndex.params, [paramGraphIndex.params]);
  const activeNode = useMemo(() => nodes.find((node) => node.id === activeID), [activeID, nodes]);
  const availableParamsForActiveNode = useMemo(() => {
    if (!activeID) return [];
    return paramGraphIndex.getAvailableParamsForNode(activeID);
  }, [activeID, paramGraphIndex]);

  const onConnect = useCallback(
    (connection: Edge | Connection) => {
      setEdges((current) => addEdge(connection, current));
    },
    [setEdges]
  );

  const handleSelectionChange = useCallback((selection: OnSelectionChangeParams) => {
    const nextNodeIDs = (selection.nodes ?? []).map((item) => item.id);
    const nextEdgeIDs = (selection.edges ?? []).map((item) => item.id);
    setSelectedNodeIDs(nextNodeIDs);
    setSelectedEdgeIDs(nextEdgeIDs);

    if (nextNodeIDs.length === 1) {
      setActiveID(nextNodeIDs[0]);
      setDrawerOpen(true);
      return;
    }
    if (nextNodeIDs.length === 0) {
      setActiveID(null);
      setDrawerOpen(false);
    }
  }, []);

  const handleNodeClick = useCallback((_: unknown, node: Node<BaseNodeData, "baseNode">) => {
    setActiveID(node.id);
    setDrawerOpen(true);
  }, []);

  const updateActiveNodeData = useCallback(
    (patch: BaseNodeData) => {
      if (!activeID) return;
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== activeID) return node;
          const nextData: BaseNodeData = { ...node.data, ...patch };
          if ("code" in patch) nextData.validate = resolveValidate((patch.code || "").toLowerCase());
          return { ...node, data: nextData };
        })
      );
    },
    [activeID, setNodes]
  );

  const addNodeByCode = useCallback(
    (blueprint: NodeBlueprint) => {
      const nextID = nodeIDRef.current++;
      const id = `node-${nextID}`;
      const index = nextID - initialNodes.length;
      const code = blueprint.code.toLowerCase();
      const newNode: Node<BaseNodeData, "baseNode"> = {
        id,
        type: "baseNode",
        position: { x: 200 + (nodes.length % 4) * 180, y: 80 + Math.floor(nodes.length / 4) * 120 },
        data: {
          name: `${blueprint.label}${index}`,
          code,
          params: blueprint.buildParams?.(),
          validate: resolveValidate(code)
        }
      };
      setNodes((current) => [...current, newNode]);
      setActiveID(id);
      setDrawerOpen(true);
    },
    [nodes.length, setNodes]
  );

  const fitView = useCallback(() => {
    reactFlowRef.current?.fitView({ padding: 0.2, duration: 300 });
    reactFlowRef.current?.zoomTo(0.5, { duration: 300 });
  }, []);

  const onBeforeRemoveParam = useCallback(
    async (writerNodeID: string, paramField: string) => {
      const impacts = paramGraphIndex.findImpactsByParamDelete(writerNodeID, paramField);
      if (impacts.length === 0) return true;
      return new Promise<boolean>((resolve) => {
        modal.confirm({
          title: "删除参数影响提示",
          content: (
            <Space direction="vertical" size={4}>
              <div>参数「{paramField}」被以下节点引用：</div>
              {impacts.map((impact) => (
                <div key={`${impact.readerNodeId}-${impact.readerFieldPath}`}>
                  · {impact.readerNodeName}（{impact.readerFieldPath}）
                </div>
              ))}
              <div>确认后将继续删除，请同步处理这些引用。</div>
            </Space>
          ),
          okText: "继续删除",
          cancelText: "取消",
          onOk: () => resolve(true),
          onCancel: () => resolve(false)
        });
      });
    },
    [modal, paramGraphIndex]
  );

  const handleDeleteNode = useCallback(
    async (nodeID: string) => {
      const impacts = paramGraphIndex.findImpactsByNodeDelete(nodeID);
      const confirmed = impacts.length
        ? await new Promise<boolean>((resolve) => {
            modal.confirm({
              title: "删除节点影响提示",
              content: (
                <Space direction="vertical" size={4}>
                  <div>该节点输出参数正在被以下节点引用：</div>
                  {impacts.map((impact) => (
                    <div key={`${impact.paramKey}-${impact.readerNodeId}-${impact.readerFieldPath}`}>
                      · 参数「{impact.paramField}」→ {impact.readerNodeName}（{impact.readerFieldPath}）
                    </div>
                  ))}
                  <div>确认后将删除节点及其连线，请同步处理引用。</div>
                </Space>
              ),
              okText: "继续删除",
              cancelText: "取消",
              onOk: () => resolve(true),
              onCancel: () => resolve(false)
            });
          })
        : true;
      if (!confirmed) return;
      setNodes((current) => current.filter((node) => node.id !== nodeID));
      setEdges((current) => current.filter((edge) => edge.source !== nodeID && edge.target !== nodeID));
      if (activeID === nodeID) {
        setActiveID(null);
        setDrawerOpen(false);
      }
      message.success("节点已删除");
    },
    [activeID, message, modal, paramGraphIndex, setEdges, setNodes]
  );

  const deleteSelection = useCallback(async () => {
    if (selectedNodeIDs.length === 0 && selectedEdgeIDs.length === 0) {
      message.info("请先选中要删除的节点或连线");
      return;
    }

    const impacts = selectedNodeIDs.flatMap((nodeID) => paramGraphIndex.findImpactsByNodeDelete(nodeID));
    const confirmed = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: "删除选中项",
        content: (
          <Space direction="vertical" size={4}>
            <div>将删除 {selectedNodeIDs.length} 个节点、{selectedEdgeIDs.length} 条连线。</div>
            {impacts.length > 0 ? <div>以下引用将受影响：</div> : null}
            {impacts.slice(0, 8).map((impact) => (
              <div key={`${impact.paramKey}-${impact.readerNodeId}-${impact.readerFieldPath}`}>
                · {impact.readerNodeName}（{impact.readerFieldPath}）引用了「{impact.paramField}」
              </div>
            ))}
            {impacts.length > 8 ? <div>... 其余 {impacts.length - 8} 项未展开</div> : null}
          </Space>
        ),
        okText: "确认删除",
        cancelText: "取消",
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });

    if (!confirmed) return;
    setNodes((current) => current.filter((node) => !selectedNodeIDs.includes(node.id)));
    setEdges((current) =>
      current.filter(
        (edge) =>
          !selectedEdgeIDs.includes(edge.id) && !selectedNodeIDs.includes(edge.source) && !selectedNodeIDs.includes(edge.target)
      )
    );
    if (activeID && selectedNodeIDs.includes(activeID)) {
      setActiveID(null);
      setDrawerOpen(false);
    }
    setSelectedEdgeIDs([]);
    setSelectedNodeIDs([]);
    message.success("选中项已删除");
  }, [activeID, message, modal, paramGraphIndex, selectedEdgeIDs, selectedNodeIDs, setEdges, setNodes]);

  const handleExport = useCallback(() => {
    setExportContent(JSON.stringify({ nodes, edges }, null, 2));
    setExportModalOpen(true);
  }, [edges, nodes]);

  const handleImportConfirm = useCallback(() => {
    try {
      const payload = JSON.parse(importContent);
      if (!payload || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
        throw new Error("JSON 中缺少 nodes 或 edges 数组");
      }
      const importedNodes = payload.nodes as Node<BaseNodeData, "baseNode">[];
      const importedEdges = payload.edges as Edge[];
      setNodes(importedNodes);
      setEdges(importedEdges);
      setActiveID(null);
      setDrawerOpen(false);

      let maxID = initialNodes.length;
      importedNodes.forEach((node) => {
        const match = /node-(\d+)/.exec(node.id);
        if (match) {
          const num = Number.parseInt(match[1], 10);
          if (!Number.isNaN(num)) maxID = Math.max(maxID, num);
        }
      });
      nodeIDRef.current = maxID + 1;
      setImportModalOpen(false);
      setImportContent("");
      message.success("流程导入成功");
    } catch (error) {
      message.error(`导入失败：${error instanceof Error ? error.message : "JSON 解析错误"}`);
    }
  }, [importContent, message, setEdges, setNodes]);

  const handleRun = useCallback(() => {
    const payload = { nodes, edges };
    const key = saveRunnerPayload(payload);
    navigate(`/app/workflow-runner?key=${encodeURIComponent(key)}`);
  }, [edges, navigate, nodes]);

  const handleReset = useCallback(() => {
    modal.confirm({
      title: "重置画布",
      content: "将清空当前内容并恢复默认模板，是否继续？",
      okText: "确认",
      cancelText: "取消",
      onOk: () => {
        const nextNodes = getFallbackNodes();
        const nextEdges = getFallbackEdges();
        setNodes(nextNodes);
        setEdges(nextEdges);
        setActiveID(null);
        setDrawerOpen(false);
        setSelectedNodeIDs([]);
        setSelectedEdgeIDs([]);
        nodeIDRef.current = nextNodes.length + 1;
        message.success("已恢复默认模板");
      }
    });
  }, [message, modal, setEdges, setNodes]);

  const openSaveModal = useCallback(() => {
    if (isEditMode && workflowDetail) applyDetailToForm(workflowDetail);
    else {
      saveForm.resetFields();
      const timestamp = Date.now();
      saveForm.setFieldsValue({
        workflow_code: `dify_workflow_${timestamp}`,
        name: `Dify工作流_${nodes.length || 1}`,
        version: "1.0.0",
        status: "draft",
        is_public: false,
        summary: "",
        workflow_description: "",
        owner: "",
        tags: [],
        metadata_json: ""
      });
    }
    setSaveModalOpen(true);
  }, [applyDetailToForm, isEditMode, nodes.length, saveForm, workflowDetail]);

  const saveCurrentWorkflow = useCallback(async () => {
    try {
      const values = await saveForm.validateFields();
      const referenceErrors = paramGraphIndex.validateResolvableReferences();
      if (referenceErrors.length > 0) {
        modal.error({
          title: "保存失败：参数引用校验未通过",
          content: (
            <Space direction="vertical" size={4}>
              {referenceErrors.map((item, index) => (
                <div key={index}>{item}</div>
              ))}
            </Space>
          )
        });
        return;
      }
      setSaveLoading(true);
      const workflowCode = (workflowDetail?.workflow_code ?? values.workflow_code ?? "").trim();
      const normalizedTags = Array.isArray(values.tags) ? values.tags.map((tag: string) => tag.trim()).filter(Boolean) : [];
      const saved = saveWorkflow({
        id: workflowDetail?.id,
        workflow_code: workflowCode,
        name: values.name.trim(),
        version: values.version?.trim() || "1.0.0",
        status: values.status,
        is_public: values.is_public ?? false,
        summary: values.summary?.trim() || "",
        workflow_description: values.workflow_description?.trim() || "",
        owner: values.owner?.trim() || "",
        tags: normalizedTags,
        metadata_json: values.metadata_json ?? "",
        definition_json: {
          nodes,
          edges
        }
      });
      setWorkflowDetail({
        id: saved.id,
        workflow_code: saved.workflow_code,
        name: saved.name,
        version: saved.version,
        status: saved.status,
        is_public: saved.is_public,
        summary: saved.summary,
        workflow_description: saved.workflow_description,
        owner: saved.owner,
        tags: saved.tags,
        metadata_json: saved.metadata_json
      });
      setSaveModalOpen(false);
      message.success("Dify工作流已保存");
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error instanceof Error ? error.message : "保存工作流失败");
    } finally {
      setSaveLoading(false);
    }
  }, [edges, message, modal, nodes, paramGraphIndex, saveForm, workflowDetail]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
        <Space>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Dify 工作流
          </Typography.Title>
          <Tag color={paramGraphIndex.hasCycle ? "error" : "success"}>{paramGraphIndex.hasCycle ? "存在环路" : "DAG有效"}</Tag>
        </Space>
        <Space wrap>
          <Button icon={<SaveOutlined />} type="primary" onClick={openSaveModal}>
            保存
          </Button>
          <Button icon={<UploadOutlined />} onClick={() => setImportModalOpen(true)}>
            导入
          </Button>
          <Button onClick={handleExport}>导出</Button>
          <Button onClick={fitView}>适配视图</Button>
          <Button icon={<DeleteOutlined />} danger onClick={() => void deleteSelection()}>
            删除选中
          </Button>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>
            恢复模板
          </Button>
          <Button onClick={handleRun}>运行</Button>
        </Space>
      </Space>

      <div style={{ display: "flex", gap: 12, width: "100%" }}>
        <div style={leftPanelStyle}>
          <Typography.Text strong>节点库</Typography.Text>
          <Typography.Text type="secondary">点击即可插入节点</Typography.Text>
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {nodeBlueprints.map((item) => (
              <Button key={item.code} icon={<PlusOutlined />} onClick={() => addNodeByCode(item)} style={{ justifyContent: "flex-start" }}>
                <Tag color={item.color} style={{ marginInlineEnd: 8 }}>
                  {item.code}
                </Tag>
                {item.label}
              </Button>
            ))}
          </Space>
        </div>

        <div style={{ flex: 1 }}>
          <div style={containerStyle}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={handleNodeClick}
              onSelectionChange={handleSelectionChange}
              onPaneClick={() => {
                setActiveID(null);
                setDrawerOpen(false);
              }}
              nodeTypes={nodeTypes}
              fitView
              onInit={(instance) => {
                reactFlowRef.current = instance;
                instance.fitView({ padding: 0.2 });
                instance.zoomTo(0.5);
              }}
            >
              <MiniMap pannable zoomable />
              <Controls />
              <Background />
              <Panel position="top-left">
                <Tag color="processing">节点 {nodes.length}</Tag>
                <Tag color="geekblue">连线 {edges.length}</Tag>
              </Panel>
            </ReactFlow>
            <NodeDrawer
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              data={activeNode?.data}
              onChange={updateActiveNodeData}
              nodeId={activeNode?.id}
              globalParams={globalParams}
              availableParams={availableParamsForActiveNode}
              onBeforeRemoveParam={onBeforeRemoveParam}
              onDeleteNode={handleDeleteNode}
            />
          </div>
        </div>
      </div>

      <GlobalParamsPanel params={globalParams} nodes={nodes} />

      <Modal
        title="导出流程 JSON"
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        footer={[
          <Button
            key="copy"
            onClick={() => {
              navigator.clipboard.writeText(exportContent).then(
                () => message.success("已复制到剪贴板"),
                () => message.warning("复制失败，请手动复制")
              );
            }}
            disabled={!exportContent}
          >
            复制内容
          </Button>,
          <Button key="close" type="primary" onClick={() => setExportModalOpen(false)}>
            关闭
          </Button>
        ]}
        width={760}
      >
        <Input.TextArea value={exportContent} readOnly autoSize={{ minRows: 12 }} />
      </Modal>

      <Modal
        title="导入流程 JSON"
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        onOk={handleImportConfirm}
        okText="导入"
        cancelText="取消"
        width={760}
      >
        <Input.TextArea
          value={importContent}
          onChange={(event) => setImportContent(event.target.value)}
          autoSize={{ minRows: 12 }}
          placeholder='请粘贴包含 "nodes" 与 "edges" 的 JSON 数据'
        />
      </Modal>

      <Modal
        title="保存 Dify 工作流"
        open={saveModalOpen}
        onCancel={() => setSaveModalOpen(false)}
        onOk={() => void saveCurrentWorkflow()}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveLoading}
      >
        <Form form={saveForm} layout="vertical">
          <Form.Item name="workflow_code" label="流程编码" rules={[{ required: true, message: "请输入唯一流程编码" }]}>
            <Input placeholder="dify_workflow_order_sync" disabled={isEditMode} />
          </Form.Item>
          <Form.Item name="name" label="流程名称" rules={[{ required: true, message: "请输入流程名称" }]}>
            <Input placeholder="例如：订单Dify编排流程" />
          </Form.Item>
          <Form.Item name="summary" label="流程简介">
            <Input placeholder="简要描述该流程" />
          </Form.Item>
          <Form.Item name="workflow_description" label="流程描述">
            <Input.TextArea rows={3} placeholder="可补充业务背景或运行说明" />
          </Form.Item>
          <Form.Item name="version" label="版本号">
            <Input placeholder="例如：1.0.0" />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="draft" rules={[{ required: true, message: "请选择状态" }]}>
            <Select options={statusOptions.map((item) => ({ label: item.label, value: item.value }))} />
          </Form.Item>
          <Form.Item name="is_public" label="是否公开" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
          <Form.Item name="owner" label="负责人/团队">
            <Input placeholder="请输入负责人或团队名称" />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" tokenSeparators={[","]} placeholder="回车或逗号可快速录入" />
          </Form.Item>
          <Form.Item name="metadata_json" label="扩展配置 JSON">
            <Input.TextArea rows={3} placeholder='可选，例如 {"timeout":3000}' />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

export default DifyWorkflowCanvas;

