import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Badge, Button, Card, Drawer, Form, Input, Mentions, Modal, Popover, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { DeleteOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined, RedoOutlined, UndoOutlined, UploadOutlined } from "@ant-design/icons";
import { ApartmentOutlined, DatabaseOutlined, WarningOutlined } from "@ant-design/icons";
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Background,
  useReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import demoFlow from "../demo.json";
import DifyNodeRenderer from "../migrated/components/nodes";
import CustomEdge from "../migrated/components/CustomEdge";
import ZoomInOut from "../migrated/components/ZoomInOut";
import { BlockEnum, type DifyGlobalVariable, type DifyNodeData, type DifyProcessObject, type DifyProcessObjectNode } from "../migrated/types";
import { DifyWorkflowStoreProvider, useDifyWorkflowStore } from "../migrated/store";
import { useNodesInteractions } from "../migrated/hooks/useNodesInteractions";
import { useSelectionInteractions } from "../migrated/hooks/useSelectionInteractions";
import { useEdgesInteractions } from "../migrated/hooks/useEdgesInteractions";
import { usePanelInteractions } from "../migrated/hooks/usePanelInteractions";
import EdgeContextMenu from "../migrated/components/EdgeContextMenu";
import PanelContextMenu from "../migrated/components/PanelContextMenu";
import SelectionContextMenu from "../migrated/components/SelectionContextMenu";
import NodeContextMenu from "../migrated/components/NodeContextMenu";
import { useWorkflowHistory } from "../migrated/hooks/useWorkflowHistory";
import { useShortcutsClipboard } from "../migrated/hooks/useShortcutsClipboard";
import BlockSelector from "../migrated/components/BlockSelector";
import ControlBar from "../migrated/components/ControlBar";
import { parseDSL, toDSL, validateDSL } from "../migrated/dsl";
import GlobalVariablesPanel from "../migrated/components/GlobalVariablesPanel";
import RealtimeChecklist from "../migrated/components/RealtimeChecklist";
import type { RealtimeChecklistIssue } from "../migrated/components/RealtimeChecklist";
import InputFormConfigEditor from "../migrated/components/InputFormConfigEditor";
import ProcessObjectPanel from "../migrated/components/ProcessObjectPanel";

const mapCodeToBlock = (code?: string): BlockEnum => {
  const normalized = (code ?? "").toLowerCase();
  if (normalized === "start") return BlockEnum.Start;
  if (normalized === "end") return BlockEnum.End;
  if (normalized === "decision") return BlockEnum.IfElse;
  if (normalized === "processor") return BlockEnum.LLM;
  if (normalized === "http") return BlockEnum.HttpRequest;
  return BlockEnum.Input;
};

const buildDefaultLLMConfig = () => ({
  model: "gpt-4o-mini",
  temperature: 0.7,
  top_p: 1,
  max_tokens: 1024,
  prompt_template: ""
});

const buildDefaultIfElseConfig = () => ({
  branches: [
    { id: "branch_1", label: "分支1", match_mode: "equals" as const, match_value: "", next_node_id: "" },
    { id: "else", label: "Else", is_else: true, next_node_id: "" }
  ]
});

const buildDefaultHTTPConfig = () => ({
  method: "GET" as const,
  url: "",
  timeout_ms: 10000,
  retry_count: 0,
  headers: [] as Array<{ id: string; key: string; value: string }>,
  query: [] as Array<{ id: string; key: string; value: string }>,
  body_mode: "none" as const,
  body_text: "",
  body_kv: [] as Array<{ id: string; key: string; value: string }>,
  response_config: {
    format: "json" as const,
    charset: {
      mode: "auto" as const,
      manual_value: "utf-8" as const,
      fallback_chain: ["utf-8", "gbk", "gb18030"],
      on_invalid: "fail" as const
    },
    json: {
      parse_mode: "strict" as const,
      schema_text: "",
      validate_schema: false,
      on_parse_error: "fail" as const
    },
    output: {
      extract_rules: [] as Array<{ id: string; key: string; path: string; write_to_process_path?: string; required: boolean; default?: string }>,
      keep_raw_text: false,
      keep_raw_json: true
    }
  }
});

const buildDefaultCodeConfig = () => ({
  language: "javascript" as const,
  script: "// 输入参数在 `inputs` 中\nreturn inputs;",
  timeout_ms: 3000,
  input_mapping: [] as Array<{ id: string; key: string; source: string; required?: boolean; default?: string }>,
  output_mapping: [] as Array<{ id: string; key: string; target: string }>
});

const ifElseMatchModeOptions = [
  { label: "包含", value: "contains" },
  { label: "不包含", value: "not_contains" },
  { label: "以...开头", value: "starts_with" },
  { label: "以...结束", value: "ends_with" },
  { label: "为空", value: "is_empty" },
  { label: "不为空", value: "is_not_empty" },
  { label: "等于", value: "equals" },
  { label: "不等于", value: "not_equals" },
  { label: "大于", value: "gt" },
  { label: "大于等于", value: "gte" },
  { label: "小于", value: "lt" },
  { label: "小于等于", value: "lte" }
];

const buildBranchHandleID = (nodeId: string, branchId: string) => `${nodeId}-branch-${branchId}`;

const parseBranchIDFromHandle = (nodeId: string, sourceHandle?: string | null) => {
  const prefix = `${nodeId}-branch-`;
  if (!sourceHandle || !sourceHandle.startsWith(prefix)) return "";
  return sourceHandle.slice(prefix.length);
};

const syncIfElseEdges = (
  edges: Edge[],
  nodeId: string,
  branches: Array<{ id: string; next_node_id?: string }>
) => {
  const branchMap = new Map(branches.map((branch) => [branch.id, branch.next_node_id || ""]));
  const handled = new Set<string>();

  const nextEdges: Edge[] = [];
  edges.forEach((edge) => {
    if (edge.source !== nodeId) {
      nextEdges.push(edge);
      return;
    }
    const branchId = parseBranchIDFromHandle(nodeId, edge.sourceHandle);
    if (!branchId || !branchMap.has(branchId)) {
      nextEdges.push(edge);
      return;
    }
    const nextTarget = branchMap.get(branchId) || "";
    if (!nextTarget) return;
    handled.add(branchId);
    nextEdges.push(
      edge.target === nextTarget
        ? edge
        : {
            ...edge,
            target: nextTarget
          }
    );
  });

  branches.forEach((branch) => {
    const target = branch.next_node_id || "";
    if (!target || handled.has(branch.id)) return;
    nextEdges.push({
      id: `${nodeId}-${branch.id}-${target}`,
      type: "difyEdge",
      source: nodeId,
      sourceHandle: buildBranchHandleID(nodeId, branch.id),
      target,
      targetHandle: `${target}-target`,
      data: {
        _sourceRunningStatus: "idle",
        _targetRunningStatus: "idle"
      }
    });
  });
  return nextEdges;
};

const ensureElseLast = (branches: Array<any>) => {
  const cleaned = (branches ?? []).filter(Boolean);
  const elseBranch = cleaned.find((branch) => !!branch.is_else) ?? {
    id: "else",
    label: "Else",
    is_else: true,
    next_node_id: ""
  };
  const conditionalBranches = cleaned.filter((branch) => !branch.is_else);
  return [...conditionalBranches, { ...elseBranch, is_else: true, label: elseBranch.label || "Else" }];
};

const sanitizeIfElseMatchValue = (text: string) => text.replace(/\/(\{\{[^}]+\}\})/g, "$1");
const sanitizeMentionsValue = (text: string) => text.replace(/\/(\{\{[^}]+\}\})/g, "$1").replace(/\/(process\.[\w.[\]-]+)/g, "$1");

const buildDefaultInputConfig = (empty = false) => ({
  fields: empty ? [] : [{ id: "query", label: "用户问题", value_type: "string" as const, required: true, default: "" }],
  forms: []
});

type InputForms = NonNullable<NonNullable<DifyNodeData["input_config"]>["forms"]>;

const buildDefaultInputForms = (): InputForms => [
  {
    id: `form_${Date.now()}`,
    name: "表单1",
    items: []
  }
];

const normalizeInputForms = (rawForms: any[]): InputForms => {
  return (rawForms ?? []).map((form, formIndex) => ({
    id: String(form?.id ?? "").trim() || `form_${formIndex + 1}`,
    name: String(form?.name ?? "").trim() || `表单${formIndex + 1}`,
    items: (form?.items ?? []).map((item: any, itemIndex: number) => ({
      id: String(item?.id ?? "").trim() || `item_${itemIndex + 1}`,
      type: ["text", "paragraph", "select", "number", "checkbox", "file", "file-list", "json"].includes(String(item?.type ?? ""))
        ? (item.type as "text" | "paragraph" | "select" | "number" | "checkbox" | "file" | "file-list" | "json")
        : "text",
      label: String(item?.label ?? "").trim() || `字段${itemIndex + 1}`,
      field: String(item?.field ?? "").trim() || `field_${itemIndex + 1}`,
      required: !!item?.required,
      default: item?.default == null ? "" : String(item.default),
      validation_refs: Array.isArray(item?.validation_refs)
        ? item.validation_refs.map((value: any) => String(value).trim()).filter(Boolean)
        : item?.validation_ref
          ? [String(item.validation_ref).trim()]
          : extractRefsFromScript(String(item?.validation_script ?? "")),
      validation_script: item?.validation_script ? String(item.validation_script) : "",
      visibility_refs: Array.isArray(item?.visibility_refs)
        ? item.visibility_refs.map((value: any) => String(value).trim()).filter(Boolean)
        : item?.visibility_ref
          ? [String(item.visibility_ref).trim()]
          : extractRefsFromScript(String(item?.visibility_script ?? "")),
      visibility_script: item?.visibility_script ? String(item.visibility_script) : "",
      options: item?.type === "select" ? (item?.options ?? []).map((option: any, optionIndex: number) => ({
        id: String(option?.id ?? "").trim() || `opt_${optionIndex + 1}`,
        name: String(option?.name ?? "").trim() || `选项${optionIndex + 1}`,
        value: String(option?.value ?? "")
      })) : undefined
    }))
  }));
};

const extractRefsFromScript = (script: string) => {
  const matches = script.match(/\{\{([^}]+)\}\}/g) ?? [];
  const normalizeToken = (token: string) => {
    const trimmed = token.trim();
    if (trimmed.includes(".")) return trimmed;
    const index = trimmed.indexOf("+");
    if (index < 0) return trimmed;
    return `${trimmed.slice(0, index)}.${trimmed.slice(index + 1)}`;
  };
  return Array.from(new Set(matches.map((token) => normalizeToken(token.slice(2, -2))).filter(Boolean)));
};

const collectRuleRefsFromForms = (forms: InputForms) => {
  const refs: string[] = [];
  forms.forEach((form) => {
    (form.items ?? []).forEach((item) => {
      refs.push(...(item.validation_refs ?? []));
      refs.push(...(item.visibility_refs ?? []));
      refs.push(...extractRefsFromScript(String(item.validation_script ?? "")));
      refs.push(...extractRefsFromScript(String(item.visibility_script ?? "")));
    });
  });
  return Array.from(new Set(refs.map((ref) => String(ref).trim()).filter(Boolean)));
};

const collectIfElseRefsFromBranches = (branches: Array<any>) => {
  const refs: string[] = [];
  (branches ?? []).forEach((branch) => {
    refs.push(...extractRefsFromScript(String(branch?.match_value ?? "")));
  });
  return Array.from(new Set(refs.map((ref) => String(ref).trim()).filter(Boolean)));
};

const isEditableTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (element.isContentEditable) return true;
  if (element.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) return true;
  return false;
};

const flattenInputFormsToFields = (forms: InputForms) => {
  const mapToFieldType = (type: InputForms[number]["items"][number]["type"]) => {
    if (type === "number") return "number" as const;
    if (type === "checkbox") return "boolean" as const;
    if (type === "file") return "file" as const;
    if (type === "file-list") return "array" as const;
    if (type === "json") return "json" as const;
    return "string" as const;
  };
  return forms.flatMap((form) =>
    form.items.map((item) => ({
      id: item.field,
      label: item.label,
      value_type: mapToFieldType(item.type),
      required: !!item.required,
      default: item.default ?? ""
    }))
  );
};

const normalizeInputFields = (rawFields: any[]) => {
  return (rawFields ?? [])
    .map((field, index) => {
      const id = String(field?.id ?? "").trim() || `field_${index + 1}`;
      const label = String(field?.label ?? "").trim() || `字段${index + 1}`;
      const rawType = String(field?.value_type ?? "string").trim();
      const value_type = ["string", "number", "integer", "boolean", "list", "array", "object", "json", "file"].includes(rawType)
        ? (rawType as "string" | "number" | "integer" | "boolean" | "list" | "array" | "object" | "json" | "file")
        : "string";
      const required = !!field?.required;
      const defaultValue = field?.default == null ? "" : String(field.default);
      return {
        id,
        label,
        value_type,
        required,
        default: defaultValue
      };
    })
    .filter((field) => Boolean(field.id));
};

const normalizeHTTPKeyValueRows = (rawRows: any[]) =>
  (rawRows ?? [])
    .map((row, index) => ({
      id: String(row?.id ?? "").trim() || `kv_${index + 1}`,
      key: String(row?.key ?? "").trim(),
      value: String(row?.value ?? "").trim()
    }));

const hasNonEmptyKVRow = (rows: Array<{ key?: string; value?: string }> | undefined) =>
  (rows ?? []).some((row) => String(row?.key ?? "").trim() || String(row?.value ?? "").trim());

const normalizeHTTPExtractRules = (rawRules: any[]) =>
  (rawRules ?? []).map((rule, index) => ({
    id: String(rule?.id ?? "").trim() || `extract_${index + 1}`,
    key: String(rule?.key ?? "").trim(),
    path: String(rule?.path ?? "").trim(),
    write_to_process_path: sanitizeMentionsValue(String(rule?.write_to_process_path ?? "").trim()),
    required: !!rule?.required,
    default: rule?.default == null ? "" : String(rule.default)
  }));

const normalizeCodeMappingToken = (raw: string) => {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  const unwrapped = trimmed.startsWith("{{") && trimmed.endsWith("}}") ? trimmed.slice(2, -2).trim() : trimmed;
  return unwrapped.startsWith("/") ? unwrapped.slice(1) : unwrapped;
};

const normalizeCodeInputMappings = (rawRows: any[]) =>
  (rawRows ?? []).map((row, index) => ({
    id: String(row?.id ?? "").trim() || `code_in_${index + 1}`,
    key: String(row?.key ?? "").trim(),
    source: normalizeCodeMappingToken(String(row?.source ?? "")),
    required: !!row?.required,
    default: row?.default == null ? "" : String(row.default)
  }));

const normalizeCodeOutputMappings = (rawRows: any[]) =>
  (rawRows ?? []).map((row, index) => ({
    id: String(row?.id ?? "").trim() || `code_out_${index + 1}`,
    key: String(row?.key ?? "").trim(),
    target: normalizeCodeMappingToken(String(row?.target ?? ""))
  }));

const collectProcessObjectRefTokens = (fields: DifyProcessObjectNode[], parentPath = "process"): string[] => {
  const result: string[] = [];
  (fields ?? []).forEach((field) => {
    const name = String(field.name ?? "").trim();
    if (!name) return;
    const currentPath = `${parentPath}.${name}`;
    result.push(currentPath);
    if (field.children && field.children.length > 0) {
      result.push(...collectProcessObjectRefTokens(field.children, currentPath));
    }
  });
  return result;
};

const buildJSONExampleFromSchema = (schema: any): any => {
  if (!schema || typeof schema !== "object") return {};
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  const schemaType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schemaType === "object" || schema.properties) {
    const result: Record<string, any> = {};
    Object.entries(schema.properties ?? {}).forEach(([key, child]) => {
      result[key] = buildJSONExampleFromSchema(child);
    });
    return result;
  }
  if (schemaType === "array") return [buildJSONExampleFromSchema(schema.items ?? {})];
  if (schemaType === "integer" || schemaType === "number") return 0;
  if (schemaType === "boolean") return false;
  if (schemaType === "null") return null;
  return "";
};

const collectJSONSchemaPaths = (schema: any, parentPath = ""): string[] => {
  if (!schema || typeof schema !== "object") return [];
  const schemaType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schemaType === "object" || schema.properties) {
    const result: string[] = [];
    Object.entries(schema.properties ?? {}).forEach(([key, child]) => {
      const currentPath = parentPath ? `${parentPath}.${key}` : String(key);
      result.push(currentPath);
      result.push(...collectJSONSchemaPaths(child, currentPath));
    });
    return result;
  }
  if (schemaType === "array") {
    const arrayPath = parentPath ? `${parentPath}[]` : "[]";
    const childPaths = collectJSONSchemaPaths(schema.items ?? {}, arrayPath);
    return [arrayPath, ...childPaths];
  }
  return parentPath ? [parentPath] : [];
};

type ParamRefOption = {
  key: string;
  label: string;
  sourceType: "global" | "node";
  sourceNodeId?: string;
};

const makeGlobalRefKey = (name: string) => `global:${name}`;
const makeNodeRefKey = (nodeId: string, field: string) => `node:${nodeId}:${field}`;

const getAncestorsOfNode = (targetNodeId: string, edges: Edge[]) => {
  const reverse = new Map<string, string[]>();
  edges.forEach((edge) => {
    const list = reverse.get(edge.target) ?? [];
    list.push(edge.source);
    reverse.set(edge.target, list);
  });
  const visited = new Set<string>();
  const queue = [...(reverse.get(targetNodeId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(reverse.get(current) ?? []));
  }
  return visited;
};

const collectNodeProducedParams = (node: Node<DifyNodeData, "difyNode">): ParamRefOption[] => {
  const nodeType = String(node.data?.type ?? "");
  if (nodeType !== BlockEnum.Start && nodeType !== BlockEnum.Input) return [];
  const fields = node.data?.input_config?.fields ?? [];
  return fields
    .filter((field) => String(field.id ?? "").trim().length > 0)
    .map((field) => ({
      key: makeNodeRefKey(node.id, String(field.id).trim()),
      label: `${field.label || field.id} (${field.id})`,
      sourceType: "node",
      sourceNodeId: node.id
    }));
};

const normalizeRefKey = (raw: string, globalNameSet: Set<string>) => {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("global:") || value.startsWith("node:")) return value;
  if (globalNameSet.has(value)) return makeGlobalRefKey(value);
  return value;
};

const refKeyToToken = (refKey: string) => {
  if (refKey.startsWith("global:")) return `global.${refKey.slice("global:".length)}`;
  if (refKey.startsWith("node:")) {
    const parts = refKey.split(":");
    const nodeId = parts[1] ?? "";
    const field = parts.slice(2).join(":");
    return `${nodeId}.${field}`;
  }
  return refKey;
};

const tokenToReadableLabel = (token: string, nodes: Node<DifyNodeData, "difyNode">[]) => {
  const raw = String(token || "");
  const splitByDot = raw.indexOf(".");
  const splitByPlus = raw.indexOf("+");
  const splitIndex = splitByDot >= 0 ? splitByDot : splitByPlus;
  if (splitIndex < 0) return raw;
  const nodeId = raw.slice(0, splitIndex);
  const field = raw.slice(splitIndex + 1);
  if (!nodeId) return token;
  if (nodeId === "global") return `全局.${field}`;
  const nodeTitle = nodes.find((node) => node.id === nodeId)?.data?.title || nodeId;
  return `${nodeTitle}.${field}`;
};

const toReadableRefLabel = (refKey: string, nodes: Node<DifyNodeData, "difyNode">[]) => {
  if (!refKey) return "";
  if (refKey.startsWith("local:")) return `当前节点.${refKey.slice("local:".length)}`;
  if (refKey.startsWith("global:")) return `全局.${refKey.slice("global:".length)}`;
  if (refKey.startsWith("node:")) {
    const parts = refKey.split(":");
    const nodeId = parts[1] ?? "";
    const field = parts.slice(2).join(":");
    const nodeTitle = nodes.find((node) => node.id === nodeId)?.data?.title || nodeId || "未知节点";
    return `${nodeTitle}.${field || "unknown"}`;
  }
  return refKey;
};

const buildInitialNodes = (): Node<DifyNodeData, "difyNode">[] =>
  ((demoFlow as any).nodes ?? []).map((node: any) => {
    const nodeType = mapCodeToBlock(node.data?.code);
    return {
      id: node.id,
      type: "difyNode",
      position: node.position,
      data: {
      type: nodeType,
      title: node.data?.name || node.id,
      desc: `编码：${node.data?.code || "-"}`,
      variables: [],
      error_handle: { enabled: false },
      llm_config: buildDefaultLLMConfig(),
      if_else_config: buildDefaultIfElseConfig(),
      http_config: buildDefaultHTTPConfig(),
      code_config: buildDefaultCodeConfig(),
      input_config: {
        ...buildDefaultInputConfig(nodeType === BlockEnum.Start),
        forms: nodeType === BlockEnum.Input ? buildDefaultInputForms() : []
      }
      }
    };
  });

const buildInitialEdges = (): Edge[] =>
  ((demoFlow as any).edges ?? []).map((edge: any) => ({
    ...edge,
    type: "difyEdge",
    data: { _sourceRunningStatus: "idle", _targetRunningStatus: "idle" }
  }));

const nodeTypes = { difyNode: DifyNodeRenderer };
const edgeTypes = { difyEdge: CustomEdge };

function DifyWorkflowMigratedCanvasInner() {
  const { message, modal } = App.useApp();
  const [nodeForm] = Form.useForm();
  const reactFlow = useReactFlow();
  const { controlMode, setClipboard } = useDifyWorkflowStore();

  const [blockSelectorOpen, setBlockSelectorOpen] = useState(false);
  const [nodeDrawerOpen, setNodeDrawerOpen] = useState(false);
  const [activeNodeID, setActiveNodeID] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [jsonSchemaImportOpen, setJSONSchemaImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [exportText, setExportText] = useState("");
  const [jsonSchemaText, setJSONSchemaText] = useState("");
  const codeScriptRef = useRef<any>(null);
  const [flashNodeId, setFlashNodeId] = useState<string | null>(null);
  const [flashMiniMap, setFlashMiniMap] = useState(false);
  const [processObjectPopoverOpen, setProcessObjectPopoverOpen] = useState(false);
  const [globalsPopoverOpen, setGlobalsPopoverOpen] = useState(false);
  const [issuesPopoverOpen, setIssuesPopoverOpen] = useState(false);
  const flashOnTimerRef = useRef<number | null>(null);
  const flashOffTimerRef = useRef<number | null>(null);
  const [globalVariables, setGlobalVariables] = useState<DifyGlobalVariable[]>([
    { id: "global_query", name: "query", value_type: "string", value: "" }
  ]);
  const [processObject, setProcessObject] = useState<DifyProcessObject>({
    schema_text: "",
    fields: []
  });

  const [nodes, setNodes, onNodesChange] = useNodesState(buildInitialNodes());
  const [edges, setEdges] = useEdgesState(buildInitialEdges());

  const { handleNodeDragStart, handleNodeDragStop, handleNodeContextMenu } = useNodesInteractions();
  const { handleSelectionStart, handleSelectionChange, handleSelectionDrag, handleSelectionCancel, handleSelectionContextMenu } = useSelectionInteractions({
    nodes,
    edges,
    setNodes,
    setEdges
  });
  const { handlePaneContextMenu, handlePaneContextmenuCancel, handleEdgeContextmenuCancel, handleSelectionContextmenuCancel, handleNodeContextmenuCancel } =
    usePanelInteractions();
  const { handleEdgeEnter, handleEdgeLeave, handleEdgesChange, handleEdgeContextMenu, handleEdgeDeleteById, handleEdgeDelete } =
    useEdgesInteractions({ edges, setEdges });
  const { canUndo, canRedo, undo, redo, beginBatch, commitBatch } = useWorkflowHistory({ nodes, edges, setNodes, setEdges });
  const { copySelection, pasteSelection, hasClipboard } = useShortcutsClipboard({
    nodes,
    edges,
    setNodes,
    setEdges,
    onUndo: undo,
    onRedo: redo
  });

  const activeNode = nodes.find((node) => node.id === activeNodeID) ?? null;
  const responseSchemaTextWatch = Form.useWatch(["responseConfig", "json", "schema_text"], nodeForm);
  const codeInputMappingsWatch = Form.useWatch("codeInputMappings", nodeForm);
  const codeOutputMappingsWatch = Form.useWatch("codeOutputMappings", nodeForm);
  const codeLanguageWatch = Form.useWatch("codeLanguage", nodeForm);

  const globalRefOptions = useMemo<ParamRefOption[]>(
    () =>
      globalVariables
        .map((item) => item.name.trim())
        .filter(Boolean)
        .map((name) => ({
          key: makeGlobalRefKey(name),
          label: name,
          sourceType: "global"
        })),
    [globalVariables]
  );

  const nodeProducedRefMap = useMemo(() => {
    const map = new Map<string, ParamRefOption[]>();
    nodes.forEach((node) => map.set(node.id, collectNodeProducedParams(node)));
    return map;
  }, [nodes]);

  const variableReferenceOptions = useMemo(() => {
    if (!activeNodeID) return [];
    const ancestors = getAncestorsOfNode(activeNodeID, edges);
    const groupedNodeOptions = Array.from(ancestors)
      .map((ancestorId) => {
        const sourceNode = nodes.find((node) => node.id === ancestorId);
        const refs = nodeProducedRefMap.get(ancestorId) ?? [];
        if (!sourceNode || refs.length === 0) return null;
        return {
          label: `节点参数 · ${sourceNode.data?.title || ancestorId}`,
          options: refs.map((ref) => ({ label: toReadableRefLabel(ref.key, nodes), value: ref.key }))
        };
      })
      .filter(Boolean) as Array<{ label: string; options: Array<{ label: string; value: string }> }>;

    const globalGroup = {
      label: "全局变量",
      options: globalRefOptions.map((ref) => ({ label: toReadableRefLabel(ref.key, nodes), value: ref.key }))
    };

    return [globalGroup, ...groupedNodeOptions].filter((group) => group.options.length > 0);
  }, [activeNodeID, edges, globalRefOptions, nodeProducedRefMap, nodes]);

  const nextNodeOptions = useMemo(
    () =>
      nodes
        .filter((node) => String(node.data?.type) !== BlockEnum.Start && node.id !== activeNodeID)
        .map((node) => ({
          label: node.data?.title || node.id,
          value: node.id
        })),
    [activeNodeID, nodes]
  );

  const upstreamReferenceFlatOptions = useMemo(
    () => {
      const baseOptions = variableReferenceOptions.flatMap((group) =>
        group.options.map((option) => ({
          label: String(option.label),
          value: refKeyToToken(String(option.value))
        }))
      );
      const processOptions = collectProcessObjectRefTokens(processObject.fields).map((token) => ({
        label: token.replace(/^process\./, "流程对象."),
        value: token
      }));
      return [...baseOptions, ...processOptions];
    },
    [processObject.fields, variableReferenceOptions]
  );

  const processObjectPathOptions = useMemo(
    () =>
      collectProcessObjectRefTokens(processObject.fields).map((token) => ({
        label: token.replace(/^process\./, "流程对象."),
        value: token
      })),
    [processObject.fields]
  );

  const codeSourceGroupedOptions = useMemo(
    () => {
      const upstreamGroups = variableReferenceOptions.map((group) => ({
        label: group.label,
        options: group.options.map((option) => ({
          label: String(option.label),
          value: refKeyToToken(String(option.value))
        }))
      }));
      const processGroup = {
        label: "流程对象",
        options: processObjectPathOptions
      };
      return [...upstreamGroups, processGroup].filter((group) => group.options.length > 0);
    },
    [processObjectPathOptions, variableReferenceOptions]
  );

  const responseSchemaPathOptions = useMemo(() => {
    const schemaText = String(responseSchemaTextWatch ?? "").trim();
    if (!schemaText) return [];
    try {
      const parsed = JSON.parse(schemaText);
      return collectJSONSchemaPaths(parsed).map((path) => ({
        label: path,
        value: path
      }));
    } catch {
      return [];
    }
  }, [responseSchemaTextWatch]);

  const ifElseMatchValueMentionOptions = useMemo(
    () =>
      upstreamReferenceFlatOptions.map((item) => ({
        label: item.label,
        value: `{{${item.value}}}`
      })),
    [upstreamReferenceFlatOptions]
  );

  const codeInputParamNames = useMemo(
    () =>
      Array.from(
        new Set(
          (Array.isArray(codeInputMappingsWatch) ? codeInputMappingsWatch : [])
            .map((item: any) => String(item?.key ?? "").trim())
            .filter(Boolean)
        )
      ),
    [codeInputMappingsWatch]
  );

  const codeOutputParamNames = useMemo(
    () =>
      Array.from(
        new Set(
          (Array.isArray(codeOutputMappingsWatch) ? codeOutputMappingsWatch : [])
            .map((item: any) => String(item?.key ?? "").trim())
            .filter(Boolean)
        )
      ),
    [codeOutputMappingsWatch]
  );

  const codeExampleText = useMemo(() => {
    const inList = codeInputParamNames.length > 0 ? codeInputParamNames.join(", ") : "query";
    const outList = codeOutputParamNames.length > 0 ? codeOutputParamNames : ["result"];
    if (String(codeLanguageWatch ?? "javascript") === "python") {
      return [
        "# 方法入口（参数）",
        "def run(inputs):",
        `    # 可用参数: ${inList}`,
        "    # 业务逻辑 ...",
        "    return {",
        "        \"outputs\": {",
        ...outList.map((key, index) => `            \"${key}\": inputs.get(\"${codeInputParamNames[index] || codeInputParamNames[0] || "query"}\")`),
        "        }",
        "    }"
      ].join("\n");
    }
    return [
      "// 方法入口（参数）",
      "function run(inputs) {",
      `  // 可用参数: ${inList}`,
      "  // 业务逻辑 ...",
      "  return {",
      "    outputs: {",
      ...outList.map((key, index) => `      ${key}: inputs.${codeInputParamNames[index] || codeInputParamNames[0] || "query"}`),
      "    }",
      "  };",
      "}"
    ].join("\n");
  }, [codeInputParamNames, codeLanguageWatch, codeOutputParamNames]);

  const insertCodeParam = useCallback(
    (paramKey: string) => {
      const snippet = `inputs.${paramKey}`;
      const textarea = codeScriptRef.current?.resizableTextArea?.textArea as HTMLTextAreaElement | undefined;
      const currentScript = String(nodeForm.getFieldValue("codeScript") ?? "");
      if (!textarea) {
        nodeForm.setFieldValue("codeScript", `${currentScript}${snippet}`);
        return;
      }
      const start = textarea.selectionStart ?? currentScript.length;
      const end = textarea.selectionEnd ?? currentScript.length;
      const nextScript = `${currentScript.slice(0, start)}${snippet}${currentScript.slice(end)}`;
      nodeForm.setFieldValue("codeScript", nextScript);
      window.requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + snippet.length;
        textarea.setSelectionRange(cursor, cursor);
      });
    },
    [nodeForm]
  );

  const deleteSelection = useCallback(() => {
    const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    const selectedEdgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id));
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

    setNodes((current) => current.filter((node) => !selectedNodeIds.has(node.id)));
    setEdges((current) =>
      current.filter((edge) => !selectedEdgeIds.has(edge.id) && !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target))
    );
    handleSelectionContextmenuCancel();
  }, [edges, handleSelectionContextmenuCancel, nodes, setEdges, setNodes]);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const isMeta = event.ctrlKey || event.metaKey;
      if (!isMeta) return;
      const key = event.key.toLowerCase();
      if (["d", "s"].includes(key)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  useEffect(() => {
    const onDelete = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      handleEdgeDelete();
      deleteSelection();
    };
    window.addEventListener("keydown", onDelete);
    return () => window.removeEventListener("keydown", onDelete);
  }, [deleteSelection, handleEdgeDelete]);

  useEffect(() => {
    return () => {
      if (flashOnTimerRef.current) window.clearTimeout(flashOnTimerRef.current);
      if (flashOffTimerRef.current) window.clearTimeout(flashOffTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const nextNodes = current.map((node) => {
        if (String(node.data?.type) !== BlockEnum.IfElse) return node;
        const branches = node.data.if_else_config?.branches ?? [];
        const nextBranches = branches.map((branch) => {
          const handle = buildBranchHandleID(node.id, branch.id);
          const matchedEdge = edges.find((edge) => edge.source === node.id && edge.sourceHandle === handle);
          const mappedTarget = matchedEdge?.target || "";
          if ((branch.next_node_id || "") === mappedTarget) return branch;
          changed = true;
          return {
            ...branch,
            next_node_id: mappedTarget
          };
        });
        if (!changed) return node;
        return {
          ...node,
          data: {
            ...node.data,
            if_else_config: {
              branches: nextBranches
            }
          }
        };
      });
      return changed ? nextNodes : current;
    });
  }, [edges, setNodes]);

  const onConnect = useCallback(
    (connection: Edge | Connection) => {
      const sourceId = String(connection.source ?? "");
      const targetId = String(connection.target ?? "");
      const sourceHandle = connection.sourceHandle ?? undefined;
      setEdges((current) => {
        const filtered = current.filter(
          (edge) => !(edge.source === sourceId && edge.sourceHandle === sourceHandle)
        );
        return addEdge({ ...connection, type: "difyEdge" }, filtered);
      });

      if (!sourceId || !targetId) return;
      const sourceNode = nodes.find((node) => node.id === sourceId);
      if (String(sourceNode?.data?.type) !== BlockEnum.IfElse) return;
      const branchId = parseBranchIDFromHandle(sourceId, sourceHandle);
      if (!branchId) return;
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== sourceId) return node;
          const ifElseConfig = node.data.if_else_config ?? buildDefaultIfElseConfig();
          return {
            ...node,
            data: {
              ...node.data,
              if_else_config: {
                branches: ifElseConfig.branches.map((branch) =>
                  branch.id === branchId ? { ...branch, next_node_id: targetId } : branch
                )
              }
            }
          };
        })
      );
    },
    [nodes, setEdges, setNodes]
  );

  const addNode = useCallback(
    (type: BlockEnum = BlockEnum.LLM) => {
      const id = `dify-node-${Date.now()}`;
      const newNode: Node<DifyNodeData, "difyNode"> = {
        id,
        type: "difyNode",
        position: { x: 240, y: 120 + nodes.length * 40 },
        data: {
          type,
          title: `${String(type).toUpperCase()} ${nodes.length + 1}`,
          desc: "Dify workflow logic node",
          variables: [],
          error_handle: { enabled: false },
          llm_config: buildDefaultLLMConfig(),
          if_else_config: buildDefaultIfElseConfig(),
          http_config: buildDefaultHTTPConfig(),
          code_config: buildDefaultCodeConfig(),
          input_config: {
            ...buildDefaultInputConfig(type === BlockEnum.Start),
            forms: type === BlockEnum.Input ? buildDefaultInputForms() : []
          }
        }
      };
      setNodes((current) => [...current, newNode]);
    },
    [nodes.length, setNodes]
  );

  const reset = useCallback(() => {
    setNodes(buildInitialNodes());
    setEdges(buildInitialEdges());
  }, [setEdges, setNodes]);

  const fitView = useCallback(() => {
    reactFlow.fitView({ padding: 0.2, duration: 180 });
  }, [reactFlow]);

  const autoLayout = useCallback(() => {
    const inDegree = new Map<string, number>();
    const nextMap = new Map<string, string[]>();
    nodes.forEach((node) => {
      inDegree.set(node.id, 0);
      nextMap.set(node.id, []);
    });
    edges.forEach((edge) => {
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
      const list = nextMap.get(edge.source) ?? [];
      list.push(edge.target);
      nextMap.set(edge.source, list);
    });

    const queue: string[] = [];
    inDegree.forEach((degree, id) => {
      if (degree === 0) queue.push(id);
    });

    const levels = new Map<string, number>();
    queue.forEach((id) => levels.set(id, 0));
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLevel = levels.get(current) ?? 0;
      (nextMap.get(current) ?? []).forEach((nextID) => {
        inDegree.set(nextID, (inDegree.get(nextID) ?? 0) - 1);
        levels.set(nextID, Math.max(levels.get(nextID) ?? 0, currentLevel + 1));
        if ((inDegree.get(nextID) ?? 0) === 0) queue.push(nextID);
      });
    }

    const grouped = new Map<number, string[]>();
    nodes.forEach((node) => {
      const level = levels.get(node.id) ?? 0;
      const list = grouped.get(level) ?? [];
      list.push(node.id);
      grouped.set(level, list);
    });

    const xGap = 320;
    const yGap = 160;
    const xStart = 80;
    const yStart = 80;
    const positionMap = new Map<string, { x: number; y: number }>();

    Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([level, ids]) => {
        ids.forEach((id, index) => {
          positionMap.set(id, {
            x: xStart + level * xGap,
            y: yStart + index * yGap
          });
        });
      });

    setNodes((current) =>
      current.map((node) => ({
        ...node,
        position: positionMap.get(node.id) ?? node.position
      }))
    );
    setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 180 }), 0);
  }, [edges, nodes, reactFlow, setNodes]);

  const deleteNodeById = useCallback(
    (nodeId: string) => {
      setNodes((current) => current.filter((node) => node.id !== nodeId));
      setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      handleNodeContextmenuCancel();
    },
    [handleNodeContextmenuCancel, setEdges, setNodes]
  );

  const copyNodeById = useCallback(
    (nodeId: string) => {
      const targetNode = nodes.find((node) => node.id === nodeId);
      if (!targetNode) return;
      setClipboard([JSON.parse(JSON.stringify(targetNode))], []);
      message.success("节点已复制，可右键粘贴或使用 Ctrl/Cmd + V");
      handleNodeContextmenuCancel();
    },
    [handleNodeContextmenuCancel, message, nodes, setClipboard]
  );

  useEffect(() => {
    if (!activeNode) return;
    const llmConfig = activeNode.data.llm_config ?? buildDefaultLLMConfig();
    const ifElseConfig = activeNode.data.if_else_config ?? buildDefaultIfElseConfig();
    const httpConfig = activeNode.data.http_config ?? buildDefaultHTTPConfig();
    const responseConfig = httpConfig.response_config ?? buildDefaultHTTPConfig().response_config;
    const codeConfig = activeNode.data.code_config ?? buildDefaultCodeConfig();
    const inputConfig = activeNode.data.input_config ?? buildDefaultInputConfig(activeNode.data.type === BlockEnum.Start);
    const inputForms = normalizeInputForms(inputConfig.forms ?? []);
    const globalNameSet = new Set(globalVariables.map((item) => item.name.trim()).filter(Boolean));
    const inputRefsSummary = collectRuleRefsFromForms(inputForms).map((token) => tokenToReadableLabel(token, nodes)).join("\n");
    const ifElseRefsSummary = collectIfElseRefsFromBranches(ifElseConfig.branches).map((token) => tokenToReadableLabel(token, nodes)).join("\n");
    nodeForm.setFieldsValue({
      title: activeNode.data.title ?? "",
      desc: activeNode.data.desc ?? "",
      type: String(activeNode.data.type ?? BlockEnum.LLM),
      variablesText: (activeNode.data.variables ?? []).map((item) => normalizeRefKey(item.variable, globalNameSet)),
      errorEnabled: !!activeNode.data.error_handle?.enabled,
      llmModel: llmConfig.model,
      llmTemperature: llmConfig.temperature,
      llmTopP: llmConfig.top_p,
      llmMaxTokens: llmConfig.max_tokens,
      llmPromptTemplate: llmConfig.prompt_template ?? "",
      httpMethod: httpConfig.method,
      httpURL: httpConfig.url,
      httpTimeout: httpConfig.timeout_ms,
      httpRetryCount: httpConfig.retry_count,
      httpHeaders: httpConfig.headers,
      httpQuery: httpConfig.query,
      httpBodyMode: httpConfig.body_mode,
      httpBodyText: httpConfig.body_text ?? "",
      httpBodyKV: httpConfig.body_kv ?? [],
      responseConfig,
      codeLanguage: codeConfig.language,
      codeScript: codeConfig.script,
      codeTimeout: codeConfig.timeout_ms,
      codeInputMappings: (codeConfig.input_mapping ?? []).map((row) => ({
        ...row,
        source: normalizeCodeMappingToken(String(row.source ?? ""))
      })),
      codeOutputMappings: (codeConfig.output_mapping ?? []).map((row) => ({
        ...row,
        target: normalizeCodeMappingToken(String(row.target ?? ""))
      })),
      ifElseBranches: ensureElseLast(ifElseConfig.branches),
      ifElseRefsSummary,
      inputFields: inputConfig.fields,
      inputForms,
      inputRefsSummary
    });
  }, [activeNode, globalVariables, nodeForm, nodes]);

  const realtimeIssues = useMemo<RealtimeChecklistIssue[]>(() => {
    const issueMap = new Map<string, RealtimeChecklistIssue>();
    const pushIssue = (key: string, messageText: string, nodeId?: string) => {
      if (!issueMap.has(key)) issueMap.set(key, { key, message: messageText, nodeId });
    };
    const nodeIds = new Set(nodes.map((node) => node.id));
    const startCount = nodes.filter((node) => String(node.data?.type) === BlockEnum.Start).length;
    const endCount = nodes.filter((node) => String(node.data?.type) === BlockEnum.End).length;

    if (startCount === 0) pushIssue("global:missing-start", "缺少 Start 节点");
    if (endCount === 0) pushIssue("global:missing-end", "缺少 End 节点");

    edges.forEach((edge) => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        const refNodeId = nodeIds.has(edge.source) ? edge.source : nodeIds.has(edge.target) ? edge.target : undefined;
        pushIssue(`edge:invalid:${edge.id}`, `存在非法连线：${edge.id}`, refNodeId);
      }
    });

    const connectedNodeIds = new Set<string>();
    edges.forEach((edge) => {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    });
    nodes.forEach((node) => {
      if (nodes.length > 1 && !connectedNodeIds.has(node.id)) {
        pushIssue(`node:isolated:${node.id}`, `节点未连接：${node.data?.title || node.id}`, node.id);
      }
    });

    const globalNames = globalVariables.map((item) => item.name.trim());
    const notEmptyGlobalNames = globalNames.filter(Boolean);
    const uniqueGlobalNames = new Set(notEmptyGlobalNames);
    if (notEmptyGlobalNames.length !== globalVariables.length) pushIssue("global:empty-name", "存在空名称的全局变量");
    if (uniqueGlobalNames.size !== notEmptyGlobalNames.length) pushIssue("global:duplicate-name", "存在重复名称的全局变量");

    const allRefs = new Map<string, ParamRefOption>();
    globalRefOptions.forEach((ref) => allRefs.set(ref.key, ref));
    nodeProducedRefMap.forEach((refs) => refs.forEach((ref) => allRefs.set(ref.key, ref)));
    const processRefTokens = collectProcessObjectRefTokens(processObject.fields);
    const allRefTokens = new Set<string>([
      ...globalRefOptions.map((ref) => refKeyToToken(ref.key)),
      ...Array.from(nodeProducedRefMap.values()).flatMap((refs) => refs.map((ref) => refKeyToToken(ref.key))),
      ...processRefTokens
    ]);

    nodes.forEach((node) => {
      const title = node.data?.title || node.id;
      if (String(node.data?.type) === BlockEnum.LLM && !node.data?.llm_config?.model) {
        pushIssue(`node:llm-no-model:${node.id}`, `LLM 节点未配置模型：${title}`, node.id);
      }
      if (String(node.data?.type) === BlockEnum.IfElse && (node.data?.if_else_config?.branches?.length ?? 0) < 2) {
        pushIssue(`node:if-branch:${node.id}`, `If/Else 分支不足 2 条：${title}`, node.id);
      }
      if (String(node.data?.type) === BlockEnum.IfElse) {
        const branches = node.data?.if_else_config?.branches ?? [];
        const hasElse = branches.some((branch) => !!branch.is_else);
        if (!hasElse) pushIssue(`node:if-no-else:${node.id}`, `If/Else 节点缺少 Else 分支：${title}`, node.id);
        branches.forEach((branch, index) => {
          if (branch.is_else) return;
          const mode = String(branch.match_mode ?? "equals");
          if (!["is_empty", "is_not_empty"].includes(mode) && !String(branch.match_value ?? "").trim()) {
            pushIssue(`node:if-empty-value:${node.id}:${index}`, `If/Else 分支缺少匹配值：${title}.${branch.label || branch.id}`, node.id);
          }
        });
      }
      if (String(node.data?.type) === BlockEnum.Input && (node.data?.input_config?.fields?.length ?? 0) === 0) {
        pushIssue(`node:input-fields:${node.id}`, `Input 节点未配置输入字段：${title}`, node.id);
      }
      if (String(node.data?.type) === BlockEnum.Code) {
        const codeConfig = node.data?.code_config ?? buildDefaultCodeConfig();
        if (!String(codeConfig.script ?? "").trim()) {
          pushIssue(`node:code-empty-script:${node.id}`, `Code 节点脚本为空：${title}`, node.id);
        }
        const inRows = codeConfig.input_mapping ?? [];
        const outRows = codeConfig.output_mapping ?? [];
        const inKeys = inRows.map((row) => String(row.key ?? "").trim()).filter(Boolean);
        if (new Set(inKeys).size !== inKeys.length) {
          pushIssue(`node:code-in-dup-key:${node.id}`, `Code 节点输入映射 key 重复：${title}`, node.id);
        }
        const outKeys = outRows.map((row) => String(row.key ?? "").trim()).filter(Boolean);
        if (new Set(outKeys).size !== outKeys.length) {
          pushIssue(`node:code-out-dup-key:${node.id}`, `Code 节点输出映射 key 重复：${title}`, node.id);
        }
      }
      if (String(node.data?.type) === BlockEnum.HttpRequest) {
        const httpConfig = node.data?.http_config ?? buildDefaultHTTPConfig();
        const responseConfig = httpConfig.response_config ?? buildDefaultHTTPConfig().response_config;
        if (!String(httpConfig.url ?? "").trim()) {
          pushIssue(`node:http-no-url:${node.id}`, `HTTP 节点未配置 URL：${title}`, node.id);
        }
        if (["json", "raw"].includes(httpConfig.body_mode) && !String(httpConfig.body_text ?? "").trim()) {
          pushIssue(`node:http-empty-body:${node.id}`, `HTTP 节点 Body 为空：${title}`, node.id);
        }
        if (["form-data", "x-www-form-urlencoded"].includes(httpConfig.body_mode) && !hasNonEmptyKVRow(httpConfig.body_kv)) {
          pushIssue(`node:http-empty-body-kv:${node.id}`, `HTTP 节点 Body 参数为空：${title}`, node.id);
        }
        if (responseConfig.charset.mode === "manual" && !String(responseConfig.charset.manual_value ?? "").trim()) {
          pushIssue(`node:http-charset-empty:${node.id}`, `HTTP 节点手动编码未配置：${title}`, node.id);
        }
        if (responseConfig.json.validate_schema) {
          const schemaText = String(responseConfig.json.schema_text ?? "").trim();
          if (!schemaText) {
            pushIssue(`node:http-schema-empty:${node.id}`, `HTTP 节点启用 Schema 校验但未提供 Schema：${title}`, node.id);
          } else {
            try {
              JSON.parse(schemaText);
            } catch {
              pushIssue(`node:http-schema-invalid:${node.id}`, `HTTP 节点 Schema 不是合法 JSON：${title}`, node.id);
            }
          }
        }
        const rules = responseConfig.output.extract_rules ?? [];
        const schemaPathSet = new Set<string>();
        try {
          const schemaText = String(responseConfig.json.schema_text ?? "").trim();
          if (schemaText) {
            collectJSONSchemaPaths(JSON.parse(schemaText)).forEach((path) => schemaPathSet.add(path));
          }
        } catch {
          // schema 非法时已有问题提示，这里忽略
        }
        const processPathSet = new Set<string>(processRefTokens);
        const keys = rules.map((rule) => String(rule.key ?? "").trim()).filter(Boolean);
        const keySet = new Set(keys);
        if (keys.length !== keySet.size) {
          pushIssue(`node:http-extract-dup:${node.id}`, `HTTP 节点提取变量存在重复 key：${title}`, node.id);
        }
        rules.forEach((rule, index) => {
          if (!String(rule.key ?? "").trim()) {
            pushIssue(`node:http-extract-empty-key:${node.id}:${index}`, `HTTP 节点提取规则缺少变量名：${title}`, node.id);
          }
          if (!String(rule.path ?? "").trim()) {
            pushIssue(`node:http-extract-empty-path:${node.id}:${index}`, `HTTP 节点提取规则缺少路径：${title}`, node.id);
          } else if (schemaPathSet.size > 0 && !schemaPathSet.has(String(rule.path).trim())) {
            pushIssue(`node:http-extract-invalid-path:${node.id}:${index}`, `HTTP 节点提取路径不在响应 Schema 中：${title}`, node.id);
          }
          if (!String(rule.write_to_process_path ?? "").trim()) {
            pushIssue(`node:http-extract-empty-write:${node.id}:${index}`, `HTTP 节点提取规则缺少写入目标：${title}`, node.id);
          } else if (!processPathSet.has(String(rule.write_to_process_path).trim())) {
            pushIssue(`node:http-extract-invalid-write:${node.id}:${index}`, `HTTP 节点写入目标不在流程对象结构中：${title}`, node.id);
          }
        });
      }
      const ancestors = getAncestorsOfNode(node.id, edges);
      const allowedRefs = new Set<string>(globalRefOptions.map((ref) => ref.key));
      ancestors.forEach((ancestorId) => {
        (nodeProducedRefMap.get(ancestorId) ?? []).forEach((ref) => allowedRefs.add(ref.key));
      });
      const localFieldSet = new Set((node.data.input_config?.forms ?? []).flatMap((form) => (form.items ?? []).map((item) => String(item.field ?? "").trim()).filter(Boolean)));
      const localRefs = new Set(Array.from(localFieldSet).map((field) => `${node.id}.${field}`));
      const allowedRuleRefs = new Set<string>([
        ...Array.from(allowedRefs).map((refKey) => refKeyToToken(refKey)),
        ...Array.from(localRefs),
        ...processRefTokens
      ]);
      const allowedCodeSourceRefs = new Set<string>([...Array.from(allowedRefs).map((refKey) => refKeyToToken(refKey)), ...processRefTokens]);

      (node.data?.variables ?? []).forEach((item) => {
        if (!item.variable) return;
        const normalizedRef = normalizeRefKey(item.variable, uniqueGlobalNames);
        const readableRef = toReadableRefLabel(normalizedRef, nodes);
        if (allowedRefs.has(normalizedRef)) return;
        if (allRefs.has(normalizedRef)) {
          pushIssue(`node:future-ref:${node.id}:${normalizedRef}`, `节点 ${title} 引用了非上游参数：${readableRef}`, node.id);
          return;
        }
        pushIssue(`node:missing-ref:${node.id}:${normalizedRef}`, `节点 ${title} 引用了缺失参数：${readableRef}`, node.id);
      });

      (node.data.input_config?.forms ?? []).forEach((form, formIndex) => {
        (form.items ?? []).forEach((item, itemIndex) => {
          const itemLabel = item.label || item.field || `项${itemIndex + 1}`;
          const checkRuleRefs = (kind: "校验规则" | "可见规则", refs: string[] | undefined, script: string | undefined) => {
            const refsFromScript = extractRefsFromScript(String(script ?? ""));
            const mergedRefs = Array.from(new Set([...(refs ?? []), ...refsFromScript]));
            mergedRefs.forEach((token) => {
              const readableRef = tokenToReadableLabel(token, nodes);
              if (allowedRuleRefs.has(token)) return;
              if (allRefTokens.has(token)) {
                pushIssue(`node:future-rule-ref:${node.id}:${formIndex}:${item.id}:${kind}:${token}`, `节点 ${title} 的${kind}引用了非上游参数：${itemLabel} -> ${readableRef}`, node.id);
                return;
              }
              pushIssue(`node:missing-rule-ref:${node.id}:${formIndex}:${item.id}:${kind}:${token}`, `节点 ${title} 的${kind}引用缺失：${itemLabel} -> ${readableRef}`, node.id);
            });
            if (String(script ?? "").trim().length > 0 && !/\breturn\b/.test(String(script ?? ""))) {
              pushIssue(`node:rule-no-return:${node.id}:${formIndex}:${item.id}:${kind}`, `节点 ${title} 的${kind}脚本缺少 return：${itemLabel}`, node.id);
            }
          };
          checkRuleRefs("校验规则", item.validation_refs, item.validation_script);
          checkRuleRefs("可见规则", item.visibility_refs, item.visibility_script);
        });
      });

      if (String(node.data?.type) === BlockEnum.Code) {
        const codeConfig = node.data?.code_config ?? buildDefaultCodeConfig();
        (codeConfig.input_mapping ?? []).forEach((row, index) => {
          const key = String(row.key ?? "").trim();
          const source = normalizeCodeMappingToken(String(row.source ?? ""));
          if (!key) {
            pushIssue(`node:code-in-empty-key:${node.id}:${index}`, `Code 节点输入映射缺少参数名：${title}`, node.id);
          }
          if (!source) {
            pushIssue(`node:code-in-empty-source:${node.id}:${index}`, `Code 节点输入映射缺少来源：${title}`, node.id);
            return;
          }
          if (allowedCodeSourceRefs.has(source)) return;
          if (allRefTokens.has(source)) {
            pushIssue(`node:code-in-future-source:${node.id}:${index}`, `Code 节点输入映射引用了非上游参数：${title} -> ${tokenToReadableLabel(source, nodes)}`, node.id);
            return;
          }
          pushIssue(`node:code-in-missing-source:${node.id}:${index}`, `Code 节点输入映射引用缺失：${title} -> ${tokenToReadableLabel(source, nodes)}`, node.id);
        });
        const processPathSet = new Set<string>(processRefTokens);
        (codeConfig.output_mapping ?? []).forEach((row, index) => {
          const key = String(row.key ?? "").trim();
          const target = normalizeCodeMappingToken(String(row.target ?? ""));
          if (!key) {
            pushIssue(`node:code-out-empty-key:${node.id}:${index}`, `Code 节点输出映射缺少返回键：${title}`, node.id);
          }
          if (!target) {
            pushIssue(`node:code-out-empty-target:${node.id}:${index}`, `Code 节点输出映射缺少写入目标：${title}`, node.id);
            return;
          }
          if (!processPathSet.has(target)) {
            pushIssue(`node:code-out-invalid-target:${node.id}:${index}`, `Code 节点输出映射目标不在流程对象结构中：${title}`, node.id);
          }
        });
      }
    });

    return Array.from(issueMap.values());
  }, [edges, globalRefOptions, globalVariables, nodeProducedRefMap, nodes, processObject.fields]);

  const jumpToIssueNode = useCallback(
    (issue: RealtimeChecklistIssue) => {
      if (!issue.nodeId) return;
      const targetNode = nodes.find((node) => node.id === issue.nodeId);
      if (!targetNode) {
        message.warning("目标节点不存在或已删除");
        return;
      }
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          selected: node.id === targetNode.id,
          data: {
            ...node.data,
            _isBundled: node.id === targetNode.id
          }
        }))
      );
      setActiveNodeID(targetNode.id);
      setNodeDrawerOpen(true);
      if (flashOnTimerRef.current) window.clearTimeout(flashOnTimerRef.current);
      if (flashOffTimerRef.current) window.clearTimeout(flashOffTimerRef.current);
      setFlashNodeId(targetNode.id);
      setFlashMiniMap(true);
      flashOnTimerRef.current = window.setTimeout(() => setFlashMiniMap(false), 380);
      flashOffTimerRef.current = window.setTimeout(() => setFlashNodeId(null), 760);
      reactFlow.setCenter(targetNode.position.x + 120, targetNode.position.y + 60, {
        zoom: Math.max(reactFlow.getZoom(), 0.9),
        duration: 260
      });
      window.setTimeout(() => {
        setNodes((current) =>
          current.map((node) =>
            node.id === targetNode.id
              ? {
                  ...node,
                  data: { ...node.data, _isBundled: false }
                }
              : node
          )
        );
      }, 1800);
    },
    [message, nodes, reactFlow, setNodes]
  );

  const exportDSL = useCallback(() => {
    const dsl = toDSL(nodes, edges);
    setExportText(JSON.stringify(dsl, null, 2));
    setExportOpen(true);
  }, [edges, nodes]);

  const importDSL = useCallback(() => {
    try {
      const parsed = parseDSL(importText);
      const errors = validateDSL(parsed.nodes, parsed.edges);
      if (errors.length > 0) {
        modal.error({
          title: "DSL 校验失败",
          content: (
            <div>
              {errors.map((item, index) => (
                <div key={index}>- {item}</div>
              ))}
            </div>
          )
        });
        return;
      }
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
      setImportOpen(false);
      setImportText("");
      message.success("DSL 导入成功");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "DSL 导入失败");
    }
  }, [importText, message, modal, setEdges, setNodes]);

  const validateCurrentDSL = useCallback(() => {
    const errors = validateDSL(nodes, edges);
    if (errors.length === 0) {
      message.success("DSL 校验通过");
      return;
    }
    modal.error({
      title: "DSL 校验失败",
      content: (
        <div>
          {errors.map((item, index) => (
            <div key={index}>- {item}</div>
          ))}
        </div>
      )
    });
  }, [edges, message, modal, nodes]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        size="small"
        title="Dify 画布逻辑（源码迁移）"
        extra={
          <Space wrap size={[8, 8]} style={{ maxWidth: "100%" }}>
            <Button icon={<UndoOutlined />} onClick={undo} disabled={!canUndo}>
              Undo
            </Button>
            <Button icon={<RedoOutlined />} onClick={redo} disabled={!canRedo}>
              Redo
            </Button>
            <Button onClick={copySelection}>Copy</Button>
            <Button onClick={pasteSelection} disabled={!hasClipboard}>
              Paste
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => addNode(BlockEnum.Start)}>
              Add Start
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => addNode(BlockEnum.Input)}>
              Add Input
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => addNode(BlockEnum.LLM)}>
              Add LLM
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => addNode(BlockEnum.IfElse)}>
              Add IfElse
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => addNode(BlockEnum.HttpRequest)}>
              Add HTTP
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => addNode(BlockEnum.Code)}>
              Add Code
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => addNode(BlockEnum.End)}>
              Add End
            </Button>
            <Button icon={<ReloadOutlined />} onClick={reset}>
              Reset
            </Button>
            <Button icon={<DownloadOutlined />} onClick={exportDSL}>
              Export DSL
            </Button>
            <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
              Import DSL
            </Button>
            <Button onClick={validateCurrentDSL}>Validate DSL</Button>
          </Space>
        }
      />

      <div style={{ width: "100%", height: "72vh", borderRadius: 10, overflow: "hidden", border: "1px solid #eaecf0", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 15,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: 8,
            borderRadius: 10,
            border: "1px solid #eaecf0",
            background: "rgba(255,255,255,0.95)",
            boxShadow: "0 2px 8px rgba(16,24,40,0.08)"
          }}
        >
          <Popover
            trigger="click"
            placement="bottomRight"
            open={processObjectPopoverOpen}
            onOpenChange={(open) => {
              setProcessObjectPopoverOpen(open);
              if (open) {
                setGlobalsPopoverOpen(false);
                setIssuesPopoverOpen(false);
              }
            }}
            content={
              <div style={{ width: 680, maxWidth: "76vw" }}>
                <ProcessObjectPanel value={processObject} onChange={setProcessObject} />
              </div>
            }
          >
            <Badge count={processObject.fields.length} size="small" color="#175cd3" offset={[-2, 2]}>
              <Button type="text" shape="circle" icon={<ApartmentOutlined />} title="流程对象" />
            </Badge>
          </Popover>
          <Popover
            trigger="click"
            placement="bottomRight"
            open={globalsPopoverOpen}
            onOpenChange={(open) => {
              setGlobalsPopoverOpen(open);
              if (open) {
                setProcessObjectPopoverOpen(false);
                setIssuesPopoverOpen(false);
              }
            }}
            content={
              <div style={{ width: 520, maxWidth: "72vw" }}>
                <GlobalVariablesPanel variables={globalVariables} onChange={setGlobalVariables} />
              </div>
            }
          >
            <Badge count={globalVariables.length} size="small" color="#175cd3" offset={[-2, 2]}>
              <Button type="text" shape="circle" icon={<DatabaseOutlined />} title="全局变量" />
            </Badge>
          </Popover>
          <Popover
            trigger="click"
            placement="bottomRight"
            open={issuesPopoverOpen}
            onOpenChange={(open) => {
              setIssuesPopoverOpen(open);
              if (open) {
                setProcessObjectPopoverOpen(false);
                setGlobalsPopoverOpen(false);
              }
            }}
            content={
              <div style={{ width: 420, maxWidth: "72vw" }}>
                <RealtimeChecklist issues={realtimeIssues} onIssueClick={jumpToIssueNode} />
              </div>
            }
          >
            <Badge count={realtimeIssues.length} size="small" color={realtimeIssues.length === 0 ? "#12b76a" : "#f04438"} offset={[-2, 2]}>
              <Button type="text" shape="circle" icon={<WarningOutlined />} title="问题清单" />
            </Badge>
          </Popover>
        </div>
        <ReactFlow
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={(event, node) => {
            beginBatch();
            handleNodeDragStart(event, node);
          }}
          onNodeDragStop={(event, node) => {
            handleNodeDragStop(event, node);
            commitBatch();
          }}
          onNodeContextMenu={handleNodeContextMenu}
          onNodeClick={(_, node) => {
            setActiveNodeID(node.id);
            setNodeDrawerOpen(true);
          }}
          onEdgeMouseEnter={handleEdgeEnter}
          onEdgeMouseLeave={handleEdgeLeave}
          onEdgeContextMenu={handleEdgeContextMenu}
          onPaneContextMenu={handlePaneContextMenu}
          onSelectionStart={handleSelectionStart}
          onSelectionChange={handleSelectionChange}
          onSelectionDrag={(event, selectionNodes) => {
            beginBatch();
            handleSelectionDrag(event as unknown as MouseEvent, selectionNodes as any);
          }}
          onSelectionContextMenu={handleSelectionContextMenu as any}
          onMoveEnd={commitBatch}
          onPaneClick={() => {
            handlePaneContextmenuCancel();
            handleSelectionCancel();
            setNodeDrawerOpen(false);
          }}
          minZoom={0.25}
          defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          selectionOnDrag={controlMode === "pointer"}
          panOnScroll={controlMode === "pointer"}
          panOnDrag={controlMode === "hand" || [1]}
        >
          <MiniMap
            pannable
            zoomable
            style={{ width: 110, height: 76 }}
            maskColor="#e9ebf0"
            nodeColor={(node) => {
              if (flashNodeId && flashMiniMap && node.id === flashNodeId) return "#fdb022";
              const type = String((node.data as any)?.type ?? "");
              if (type === BlockEnum.Start) return "#17b26a";
              if (type === BlockEnum.End) return "#f04438";
              if (type === BlockEnum.IfElse) return "#f79009";
              if (type === BlockEnum.LLM) return "#7a5af8";
              if (type === BlockEnum.Input) return "#06aed4";
              return "#98a2b3";
            }}
          />
          <Background gap={[14, 14]} size={2} />
          <ControlBar onOpenBlockSelector={() => setBlockSelectorOpen(true)} onAutoLayout={autoLayout} onFitView={fitView} onReset={reset} />
          <div style={{ position: "absolute", left: 16, bottom: 16, zIndex: 10 }}>
            <ZoomInOut />
          </div>
        </ReactFlow>

        <BlockSelector
          open={blockSelectorOpen}
          onClose={() => setBlockSelectorOpen(false)}
          onSelect={(type) => {
            addNode(type);
          }}
        />
        <EdgeContextMenu onDelete={handleEdgeDeleteById} onClose={handleEdgeContextmenuCancel} />
        <NodeContextMenu onCopyNode={copyNodeById} onDeleteNode={deleteNodeById} onClose={handleNodeContextmenuCancel} />
        <PanelContextMenu onAddNode={addNode} onPaste={pasteSelection} hasClipboard={hasClipboard} onClose={handlePaneContextmenuCancel} />
        <SelectionContextMenu onDeleteSelection={deleteSelection} onClose={handleSelectionContextmenuCancel} />
      </div>

      <Modal title="导入 DSL" open={importOpen} onCancel={() => setImportOpen(false)} onOk={importDSL} okText="导入" cancelText="取消" width={760}>
        <Input.TextArea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          autoSize={{ minRows: 12 }}
          placeholder="粘贴 DSL JSON（支持 graph.nodes/graph.edges 或 nodes/edges）"
        />
      </Modal>

      <Modal
        title="导入 JSON Schema"
        open={jsonSchemaImportOpen}
        onCancel={() => setJSONSchemaImportOpen(false)}
        onOk={() => {
          try {
            const schema = JSON.parse(jsonSchemaText || "{}");
            const bodyJSON = buildJSONExampleFromSchema(schema);
            nodeForm.setFieldValue("httpBodyText", JSON.stringify(bodyJSON, null, 2));
            setJSONSchemaImportOpen(false);
            message.success("已根据 JSON Schema 生成示例 JSON");
          } catch (error) {
            message.error(error instanceof Error ? error.message : "JSON Schema 解析失败");
          }
        }}
        okText="导入"
        cancelText="取消"
        width={760}
      >
        <Input.TextArea
          value={jsonSchemaText}
          onChange={(event) => setJSONSchemaText(event.target.value)}
          autoSize={{ minRows: 12 }}
          placeholder='粘贴 JSON Schema，例如：{"type":"object","properties":{"query":{"type":"string"}}}'
        />
      </Modal>

      <Modal
        title="导出 DSL"
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        footer={[
          <Button
            key="copy"
            onClick={() =>
              navigator.clipboard.writeText(exportText).then(
                () => message.success("已复制"),
                () => message.warning("复制失败，请手动复制")
              )
            }
            disabled={!exportText}
          >
            复制
          </Button>,
          <Button key="close" type="primary" onClick={() => setExportOpen(false)}>
            关闭
          </Button>
        ]}
        width={760}
      >
        <Input.TextArea value={exportText} readOnly autoSize={{ minRows: 12 }} />
      </Modal>

      <Drawer title="节点属性" open={nodeDrawerOpen} onClose={() => setNodeDrawerOpen(false)} width={760} destroyOnHidden>
        {activeNode ? (
          <Form
            layout="vertical"
            form={nodeForm}
            onValuesChange={(_, values) => {
              setNodes((current) =>
                current.map((item) => {
                  if (item.id !== activeNode.id) return item;

                  const rawVariables = Array.isArray(values.variablesText)
                    ? values.variablesText
                    : String(values.variablesText || "")
                        .split(",")
                        .map((text: string) => text.trim())
                        .filter(Boolean);
                  const globalNameSet = new Set(globalVariables.map((item) => item.name.trim()).filter(Boolean));
                  const variables = rawVariables
                    .map((variable: string) => normalizeRefKey(String(variable).trim(), globalNameSet))
                    .filter(Boolean)
                    .map((variable: string) => ({ variable }));

                  const parsedBranchesRaw = Array.isArray(values.ifElseBranches)
                    ? values.ifElseBranches.map((branch: any, index: number) => ({
                        id: String(branch?.id ?? "").trim() || `branch_${index + 1}`,
                        label: String(branch?.label ?? "").trim() || `分支${index + 1}`,
                        is_else: !!branch?.is_else,
                        match_mode: branch?.is_else ? undefined : (branch?.match_mode || "equals"),
                        match_value: branch?.is_else ? "" : sanitizeIfElseMatchValue(String(branch?.match_value ?? "")),
                        next_node_id: String(branch?.next_node_id ?? "")
                      }))
                    : buildDefaultIfElseConfig().branches;
                  const parsedBranches = ensureElseLast(parsedBranchesRaw);
                  const ifElseRuleRefs = collectIfElseRefsFromBranches(parsedBranches);

                  const parsedInputFields = normalizeInputFields(values.inputFields);
                  const parsedInputForms = normalizeInputForms(item.data.input_config?.forms ?? values.inputForms);
                  const inputRuleRefs = collectRuleRefsFromForms(parsedInputForms);
                  const parsedCharsetMode = values.responseConfig?.charset?.mode === "manual" ? "manual" : "auto";
                  const parsedCharsetManualValue = ["utf-8", "gbk", "gb18030", "latin1"].includes(String(values.responseConfig?.charset?.manual_value ?? ""))
                    ? (values.responseConfig?.charset?.manual_value as "utf-8" | "gbk" | "gb18030" | "latin1")
                    : ("utf-8" as const);
                  const parsedResponseConfig: NonNullable<NonNullable<DifyNodeData["http_config"]>["response_config"]> = {
                    format: "json",
                    charset: {
                      mode: parsedCharsetMode,
                      manual_value: parsedCharsetManualValue,
                      fallback_chain: Array.isArray(values.responseConfig?.charset?.fallback_chain)
                        ? values.responseConfig.charset.fallback_chain.map((item: any) => String(item).trim()).filter(Boolean)
                        : ["utf-8", "gbk", "gb18030"],
                      on_invalid: values.responseConfig?.charset?.on_invalid === "replace" ? "replace" : "fail"
                    },
                    json: {
                      parse_mode: values.responseConfig?.json?.parse_mode === "tolerant" ? "tolerant" : "strict",
                      schema_text: String(values.responseConfig?.json?.schema_text ?? ""),
                      validate_schema: !!values.responseConfig?.json?.validate_schema,
                      on_parse_error: values.responseConfig?.json?.on_parse_error === "empty_object" ? "empty_object" : "fail"
                    },
                    output: {
                      extract_rules: normalizeHTTPExtractRules(values.responseConfig?.output?.extract_rules),
                      keep_raw_text: !!values.responseConfig?.output?.keep_raw_text,
                      keep_raw_json: !!values.responseConfig?.output?.keep_raw_json
                    }
                  };
                  const parsedHTTPConfig = {
                    ...(item.data.http_config ?? buildDefaultHTTPConfig()),
                    method: ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(values.httpMethod ?? ""))
                      ? (values.httpMethod as "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
                      : "GET",
                    url: String(values.httpURL ?? "").trim(),
                    timeout_ms: Number(values.httpTimeout ?? 10000),
                    retry_count: Number(values.httpRetryCount ?? 0),
                    headers: normalizeHTTPKeyValueRows(values.httpHeaders),
                    query: normalizeHTTPKeyValueRows(values.httpQuery),
                    body_mode: ["none", "json", "form-data", "x-www-form-urlencoded", "raw"].includes(String(values.httpBodyMode ?? ""))
                      ? (values.httpBodyMode as "none" | "json" | "form-data" | "x-www-form-urlencoded" | "raw")
                      : "none",
                    body_text: String(values.httpBodyText ?? ""),
                    body_kv: normalizeHTTPKeyValueRows(values.httpBodyKV),
                    response_config: parsedResponseConfig
                  };
                  const parsedCodeConfig: NonNullable<DifyNodeData["code_config"]> = {
                    ...(item.data.code_config ?? buildDefaultCodeConfig()),
                    language: values.codeLanguage === "python" ? "python" : "javascript",
                    script: String(values.codeScript ?? ""),
                    timeout_ms: Number(values.codeTimeout ?? 3000),
                    input_mapping: normalizeCodeInputMappings(values.codeInputMappings),
                    output_mapping: normalizeCodeOutputMappings(values.codeOutputMappings)
                  };

                  const nextType = values.type ?? item.data.type;
                  const nextInputConfig =
                    nextType === BlockEnum.Input || nextType === BlockEnum.Start
                      ? {
                          fields: parsedInputForms.length > 0 ? flattenInputFormsToFields(parsedInputForms) : [],
                          forms: parsedInputForms
                        }
                      : {
                          fields: parsedInputFields.length > 0 ? parsedInputFields : buildDefaultInputConfig(nextType === BlockEnum.Start).fields,
                          forms: []
                        };

                  return {
                    ...item,
                    data: {
                      ...item.data,
                      title: values.title ?? "",
                      desc: values.desc ?? "",
                      type: nextType,
                      variables:
                        nextType === BlockEnum.Start
                          ? []
                          : nextType === BlockEnum.Input
                            ? inputRuleRefs.map((ref) => ({ variable: ref }))
                            : nextType === BlockEnum.IfElse
                              ? ifElseRuleRefs.map((ref) => ({ variable: ref }))
                              : nextType === BlockEnum.Code
                                ? []
                              : nextType === BlockEnum.HttpRequest
                                ? []
                              : variables,
                      error_handle: {
                        ...(item.data.error_handle ?? { enabled: false }),
                        enabled: !!values.errorEnabled
                      },
                      llm_config: {
                        ...(item.data.llm_config ?? buildDefaultLLMConfig()),
                        model: values.llmModel ?? "gpt-4o-mini",
                        temperature: Number(values.llmTemperature ?? 0.7),
                        top_p: Number(values.llmTopP ?? 1),
                        max_tokens: Number(values.llmMaxTokens ?? 1024),
                        prompt_template: values.llmPromptTemplate ?? ""
                      },
                      if_else_config: {
                        branches: parsedBranches.length > 0 ? parsedBranches : buildDefaultIfElseConfig().branches
                      },
                      http_config: parsedHTTPConfig,
                      code_config: parsedCodeConfig,
                      input_config: nextInputConfig
                    }
                  };
                })
              );

              if (String(values.type ?? activeNode.data.type) === BlockEnum.IfElse) {
                const nextIfElseBranches = ensureElseLast(Array.isArray(values.ifElseBranches) ? values.ifElseBranches : []);
                const refsSummary = collectIfElseRefsFromBranches(nextIfElseBranches).map((token) => tokenToReadableLabel(token, nodes)).join("\n");
                nodeForm.setFieldValue("ifElseBranches", nextIfElseBranches);
                nodeForm.setFieldValue("ifElseRefsSummary", refsSummary);
                setEdges((current) => syncIfElseEdges(current, activeNode.id, nextIfElseBranches));
              }
            }}
          >
            <Form.Item label="节点标题" name="title" rules={[{ required: true, message: "请输入节点标题" }]}>
              <Input />
            </Form.Item>
            <Form.Item label="节点类型" name="type" rules={[{ required: true, message: "请选择节点类型" }]}>
              <Select
                options={[
                  { label: "Start", value: BlockEnum.Start },
                  { label: "Input", value: BlockEnum.Input },
                  { label: "LLM", value: BlockEnum.LLM },
                  { label: "If/Else", value: BlockEnum.IfElse },
                  { label: "End", value: BlockEnum.End },
                  { label: "HTTP Request", value: BlockEnum.HttpRequest },
                  { label: "Code", value: BlockEnum.Code }
                ]}
              />
            </Form.Item>
            <Form.Item label="节点描述" name="desc">
              <Input.TextArea rows={4} />
            </Form.Item>
            <Form.Item shouldUpdate noStyle>
              {({ getFieldValue }) => {
                const currentType = getFieldValue("type");
                if (
                  currentType === BlockEnum.Start ||
                  currentType === BlockEnum.Input ||
                  currentType === BlockEnum.IfElse ||
                  currentType === BlockEnum.Code ||
                  currentType === BlockEnum.HttpRequest
                ) return null;
                return (
                  <Form.Item label="变量引用" name="variablesText" extra="可选择全局变量或上游节点参数。">
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="请选择要引用的参数"
                      options={variableReferenceOptions}
                    />
                  </Form.Item>
                );
              }}
            </Form.Item>

            <Form.Item shouldUpdate noStyle>
              {({ getFieldValue }) => {
                const currentType = getFieldValue("type");
                if (currentType !== BlockEnum.LLM) return null;
                return (
                  <>
                    <Form.Item label="LLM 模型" name="llmModel">
                      <Select
                        options={[
                          { label: "gpt-4o-mini", value: "gpt-4o-mini" },
                          { label: "gpt-4.1-mini", value: "gpt-4.1-mini" },
                          { label: "qwen-max", value: "qwen-max" },
                          { label: "deepseek-chat", value: "deepseek-chat" }
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="Temperature (0-2)" name="llmTemperature">
                      <Input type="number" min={0} max={2} step={0.1} />
                    </Form.Item>
                    <Form.Item label="Top P (0-1)" name="llmTopP">
                      <Input type="number" min={0} max={1} step={0.1} />
                    </Form.Item>
                    <Form.Item label="Max Tokens" name="llmMaxTokens">
                      <Input type="number" min={1} step={1} />
                    </Form.Item>
                    <Form.Item label="Prompt Template" name="llmPromptTemplate">
                      <Input.TextArea rows={4} placeholder="你是一个专业助手，请根据变量回答：{{query}}" />
                    </Form.Item>
                  </>
                );
              }}
            </Form.Item>

            <Form.Item shouldUpdate noStyle>
              {({ getFieldValue }) => {
                const currentType = getFieldValue("type");
                if (currentType !== BlockEnum.IfElse) return null;
                return (
                  <>
                    <Form.Item label="分支配置" extra="支持条件分支和 Else 分支；可直接为每个分支绑定下一步节点。">
                      <Form.List name="ifElseBranches">
                        {(fields, { remove }) => {
                          return (
                            <Card
                              size="small"
                              bordered={false}
                              styles={{ body: { padding: 0 } }}
                              extra={
                                <Button
                                  type="text"
                                  icon={<PlusOutlined />}
                                  onClick={() => {
                                    const current = ensureElseLast(nodeForm.getFieldValue("ifElseBranches") ?? []);
                                    const next = [
                                      ...current.slice(0, -1),
                                      {
                                        id: `branch_${Date.now()}`,
                                        label: `分支${Math.max(1, current.length)}`,
                                        is_else: false,
                                        match_mode: "equals",
                                        match_value: "",
                                        next_node_id: ""
                                      },
                                      current[current.length - 1]
                                    ];
                                    nodeForm.setFieldValue("ifElseBranches", next);
                                  }}
                                >
                                  添加分支
                                </Button>
                              }
                            >
                              <Table
                                size="small"
                                pagination={false}
                                rowKey={(record) => String(record.key)}
                                dataSource={fields}
                                columns={[
                                {
                                  title: "分支名",
                                  width: 140,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "label"]} style={{ marginBottom: 0 }}>
                                      <Input placeholder="分支名" />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "匹配方式",
                                  width: 140,
                                  render: (_, field) => (
                                    <Form.Item shouldUpdate noStyle>
                                      {() => {
                                        const isElse = !!nodeForm.getFieldValue(["ifElseBranches", field.name, "is_else"]);
                                        if (isElse) return <Tag color="default">Else</Tag>;
                                        return (
                                          <Form.Item name={[field.name, "match_mode"]} style={{ marginBottom: 0 }}>
                                            <Select options={ifElseMatchModeOptions} />
                                          </Form.Item>
                                        );
                                      }}
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "匹配值",
                                  width: 150,
                                  render: (_, field) => (
                                    <Form.Item shouldUpdate noStyle>
                                      {() => {
                                        const isElse = !!nodeForm.getFieldValue(["ifElseBranches", field.name, "is_else"]);
                                        const mode = String(nodeForm.getFieldValue(["ifElseBranches", field.name, "match_mode"]) || "");
                                        if (isElse || ["is_empty", "is_not_empty"].includes(mode)) return <Typography.Text type="secondary">-</Typography.Text>;
                                        return (
                                          <Form.Item name={[field.name, "match_value"]} style={{ marginBottom: 0 }}>
                                            <Mentions
                                              rows={1}
                                              prefix={["/"]}
                                              options={ifElseMatchValueMentionOptions}
                                              placeholder="输入 / "
                                              onChange={(value) => {
                                                nodeForm.setFieldValue(["ifElseBranches", field.name, "match_value"], sanitizeIfElseMatchValue(value));
                                              }}
                                            />
                                          </Form.Item>
                                        );
                                      }}
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "下一步节点",
                                  width: 180,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "next_node_id"]} style={{ marginBottom: 0 }}>
                                      <Select allowClear placeholder="选择节点" options={nextNodeOptions} />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "操作",
                                  width: 70,
                                  render: (_, field) => {
                                    const isElse = !!nodeForm.getFieldValue(["ifElseBranches", field.name, "is_else"]);
                                    return (
                                      <Button type="text" danger disabled={isElse} icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                                    );
                                  }
                                }
                                ]}
                              />
                            </Card>
                          );
                        }}
                      </Form.List>
                    </Form.Item>
                    <Form.Item label="变量引用汇总" name="ifElseRefsSummary" extra="自动汇总当前 If/Else 分支匹配值中引用的参数（只读）。">
                      <Input.TextArea rows={4} readOnly placeholder="暂无引用参数" />
                    </Form.Item>
                  </>
                );
              }}
            </Form.Item>

            <Form.Item shouldUpdate noStyle>
              {({ getFieldValue }) => {
                const currentType = getFieldValue("type");
                if (currentType !== BlockEnum.HttpRequest) return null;
                return (
                  <>
                    <Form.Item label="请求方法" name="httpMethod" rules={[{ required: true, message: "请选择请求方法" }]}>
                      <Select
                        options={[
                          { label: "GET", value: "GET" },
                          { label: "POST", value: "POST" },
                          { label: "PUT", value: "PUT" },
                          { label: "PATCH", value: "PATCH" },
                          { label: "DELETE", value: "DELETE" }
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="URL" name="httpURL" rules={[{ required: true, message: "请输入 URL" }]}>
                      <Mentions
                        rows={1}
                        prefix={["/"]}
                        options={ifElseMatchValueMentionOptions}
                        placeholder="https://api.example.com/v1/resource（输入 / 选择参数）"
                        onChange={(value) => {
                          nodeForm.setFieldValue("httpURL", sanitizeMentionsValue(value));
                        }}
                      />
                    </Form.Item>
                    <Space style={{ display: "flex" }} size={12}>
                      <Form.Item label="超时(ms)" name="httpTimeout" style={{ flex: 1 }}>
                        <Input type="number" min={100} step={100} />
                      </Form.Item>
                      <Form.Item label="重试次数" name="httpRetryCount" style={{ flex: 1 }}>
                        <Input type="number" min={0} step={1} />
                      </Form.Item>
                    </Space>

                    <Form.Item label="Headers">
                      <Form.List name="httpHeaders">
                        {(fields, { add, remove }) => (
                          <Card
                            size="small"
                            bordered={false}
                            styles={{ body: { padding: 0 } }}
                            extra={
                              <Button type="text" icon={<PlusOutlined />} onClick={() => add({ id: `hdr_${Date.now()}`, key: "", value: "" })} />
                            }
                          >
                            <Table
                              size="small"
                              pagination={false}
                              rowKey={(record) => String(record.key)}
                              dataSource={fields}
                              columns={[
                                {
                                  title: "Key",
                                  width: 180,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "key"]} style={{ marginBottom: 0 }}>
                                      <Input placeholder="Authorization" />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "Value",
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "value"]} style={{ marginBottom: 0 }}>
                                      <Input placeholder="Bearer xxx" />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "操作",
                                  width: 66,
                                  render: (_, field) => (
                                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                                  )
                                }
                              ]}
                              locale={{ emptyText: "暂无 Header，点击右上角 + 添加" }}
                            />
                          </Card>
                        )}
                      </Form.List>
                    </Form.Item>

                    <Form.Item label="Query 参数">
                      <Form.List name="httpQuery">
                        {(fields, { add, remove }) => (
                          <Card
                            size="small"
                            bordered={false}
                            styles={{ body: { padding: 0 } }}
                            extra={<Button type="text" icon={<PlusOutlined />} onClick={() => add({ id: `qry_${Date.now()}`, key: "", value: "" })} />}
                          >
                            <Table
                              size="small"
                              pagination={false}
                              rowKey={(record) => String(record.key)}
                              dataSource={fields}
                              columns={[
                                {
                                  title: "Key",
                                  width: 180,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "key"]} style={{ marginBottom: 0 }}>
                                      <Input placeholder="page" />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "Value",
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "value"]} style={{ marginBottom: 0 }}>
                                      <Input placeholder="1" />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "操作",
                                  width: 66,
                                  render: (_, field) => (
                                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                                  )
                                }
                              ]}
                              locale={{ emptyText: "暂无 Query 参数，点击右上角 + 添加" }}
                            />
                          </Card>
                        )}
                      </Form.List>
                    </Form.Item>

                    <Form.Item label="Body 类型" name="httpBodyMode">
                      <Select
                        options={[
                          { label: "none", value: "none" },
                          { label: "json", value: "json" },
                          { label: "form-data", value: "form-data" },
                          { label: "x-www-form-urlencoded", value: "x-www-form-urlencoded" },
                          { label: "raw", value: "raw" }
                        ]}
                      />
                    </Form.Item>
                    <Form.Item shouldUpdate noStyle>
                      {({ getFieldValue: getInnerValue }) => {
                        const bodyMode = String(getInnerValue("httpBodyMode") || "none");
                        if (bodyMode === "none") return null;
                        if (bodyMode === "json") {
                          return (
                            <>
                              <Form.Item>
                                <Button onClick={() => setJSONSchemaImportOpen(true)}>导入 JSON Schema</Button>
                              </Form.Item>
                              <Form.Item label="Body(JSON)" name="httpBodyText">
                                <Input.TextArea rows={8} placeholder='例如：{"query":"{{start.query}}"}' />
                              </Form.Item>
                            </>
                          );
                        }
                        if (bodyMode === "form-data" || bodyMode === "x-www-form-urlencoded") {
                          return (
                            <Form.Item label="Body 参数">
                              <Form.List name="httpBodyKV">
                                {(fields, { add, remove }) => (
                                  <Card
                                    size="small"
                                    bordered={false}
                                    styles={{ body: { padding: 0 } }}
                                    extra={<Button type="text" icon={<PlusOutlined />} onClick={() => add({ id: `body_${Date.now()}`, key: "", value: "" })} />}
                                  >
                                    <Table
                                      size="small"
                                      pagination={false}
                                      rowKey={(record) => String(record.key)}
                                      dataSource={fields}
                                      columns={[
                                        {
                                          title: "Key",
                                          width: 180,
                                          render: (_, field) => (
                                            <Form.Item name={[field.name, "key"]} style={{ marginBottom: 0 }}>
                                              <Input placeholder="key" />
                                            </Form.Item>
                                          )
                                        },
                                        {
                                          title: "Value",
                                          render: (_, field) => (
                                            <Form.Item name={[field.name, "value"]} style={{ marginBottom: 0 }}>
                                              <Input placeholder="value" />
                                            </Form.Item>
                                          )
                                        },
                                        {
                                          title: "操作",
                                          width: 66,
                                          render: (_, field) => (
                                            <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                                          )
                                        }
                                      ]}
                                      locale={{ emptyText: "暂无 Body 参数，点击右上角 + 添加" }}
                                    />
                                  </Card>
                                )}
                              </Form.List>
                            </Form.Item>
                          );
                        }
                        return (
                          <Form.Item label="Body(Raw)" name="httpBodyText">
                            <Input.TextArea rows={6} placeholder='例如：{"query":"{{start.query}}"}' />
                          </Form.Item>
                        );
                      }}
                    </Form.Item>

                    <Card size="small" title="响应结果处理（仅配置）" style={{ marginTop: 8 }}>
                      <Form.Item label="响应格式" name={["responseConfig", "format"]}>
                        <Select options={[{ label: "JSON", value: "json" }]} />
                      </Form.Item>

                      <Typography.Text strong>编码处理</Typography.Text>
                      <Space style={{ display: "flex", marginTop: 8 }} size={12}>
                        <Form.Item label="模式" name={["responseConfig", "charset", "mode"]} style={{ flex: 1 }}>
                          <Select
                            options={[
                              { label: "自动识别", value: "auto" },
                              { label: "手动指定", value: "manual" }
                            ]}
                          />
                        </Form.Item>
                        <Form.Item label="非法编码策略" name={["responseConfig", "charset", "on_invalid"]} style={{ flex: 1 }}>
                          <Select
                            options={[
                              { label: "失败", value: "fail" },
                              { label: "替换非法字符", value: "replace" }
                            ]}
                          />
                        </Form.Item>
                      </Space>
                      <Form.Item shouldUpdate noStyle>
                        {({ getFieldValue: getInnerValue }) => {
                          if (String(getInnerValue(["responseConfig", "charset", "mode"]) || "auto") !== "manual") return null;
                          return (
                            <Form.Item label="手动编码" name={["responseConfig", "charset", "manual_value"]}>
                              <Select
                                options={[
                                  { label: "utf-8", value: "utf-8" },
                                  { label: "gbk", value: "gbk" },
                                  { label: "gb18030", value: "gb18030" },
                                  { label: "latin1", value: "latin1" }
                                ]}
                              />
                            </Form.Item>
                          );
                        }}
                      </Form.Item>

                      <Typography.Text strong>JSON 处理</Typography.Text>
                      <Space style={{ display: "flex", marginTop: 8 }} size={12}>
                        <Form.Item label="解析模式" name={["responseConfig", "json", "parse_mode"]} style={{ flex: 1 }}>
                          <Select
                            options={[
                              { label: "strict", value: "strict" },
                              { label: "tolerant", value: "tolerant" }
                            ]}
                          />
                        </Form.Item>
                        <Form.Item label="解析失败策略" name={["responseConfig", "json", "on_parse_error"]} style={{ flex: 1 }}>
                          <Select
                            options={[
                              { label: "失败", value: "fail" },
                              { label: "空对象", value: "empty_object" }
                            ]}
                          />
                        </Form.Item>
                      </Space>
                      <Form.Item label="启用 Schema 校验" name={["responseConfig", "json", "validate_schema"]} valuePropName="checked">
                        <Switch />
                      </Form.Item>
                      <Form.Item label="JSON Schema" name={["responseConfig", "json", "schema_text"]}>
                        <Input.TextArea rows={6} placeholder='{"type":"object","properties":{"data":{"type":"object"}}}' />
                      </Form.Item>
                      <Button
                        style={{ marginBottom: 12 }}
                        onClick={() => {
                          const schemaText = String(nodeForm.getFieldValue(["responseConfig", "json", "schema_text"]) ?? "").trim();
                          if (!schemaText) {
                            message.warning("请先输入 JSON Schema");
                            return;
                          }
                          try {
                            JSON.parse(schemaText);
                            message.success("JSON Schema 语法校验通过");
                          } catch (error) {
                            message.error(error instanceof Error ? error.message : "JSON Schema 语法错误");
                          }
                        }}
                      >
                        校验 JSON Schema
                      </Button>

                      <Typography.Text strong>结果提取</Typography.Text>
                      <Form.Item style={{ marginTop: 8 }}>
                        <Form.List name={["responseConfig", "output", "extract_rules"]}>
                          {(fields, { add, remove }) => (
                            <Card
                              size="small"
                              bordered={false}
                              styles={{ body: { padding: 0 } }}
                              extra={
                                <Button
                                  type="text"
                                  icon={<PlusOutlined />}
                                  onClick={() =>
                                    add({ id: `extract_${Date.now()}`, key: "", path: "", write_to_process_path: "", required: false, default: "" })
                                  }
                                />
                              }
                            >
                              <Table
                                size="small"
                                pagination={false}
                                rowKey={(record) => String(record.key)}
                                dataSource={fields}
                                columns={[
                                  {
                                    title: "变量名",
                                    width: 140,
                                    render: (_, field) => (
                                      <Form.Item name={[field.name, "key"]} style={{ marginBottom: 0 }}>
                                        <Input placeholder="如：answer" />
                                      </Form.Item>
                                    )
                                  },
                                  {
                                    title: "路径",
                                    width: 200,
                                    render: (_, field) => (
                                      <Form.Item name={[field.name, "path"]} style={{ marginBottom: 0 }}>
                                        <Select
                                          showSearch
                                          allowClear
                                          placeholder={
                                            responseSchemaPathOptions.length > 0
                                              ? "请选择响应 Schema 路径"
                                              : "请先配置响应 JSON Schema"
                                          }
                                          options={responseSchemaPathOptions}
                                        />
                                      </Form.Item>
                                    )
                                  },
                                  {
                                    title: "写入数据",
                                    width: 220,
                                    render: (_, field) => (
                                      <Form.Item name={[field.name, "write_to_process_path"]} style={{ marginBottom: 0 }}>
                                        <Mentions
                                          rows={1}
                                          prefix={["/"]}
                                          options={processObjectPathOptions}
                                          placeholder={
                                            processObjectPathOptions.length > 0
                                              ? "输入 / 选择流程对象路径"
                                              : "请先配置流程对象结构"
                                          }
                                          onChange={(value) => {
                                            nodeForm.setFieldValue(
                                              ["responseConfig", "output", "extract_rules", field.name, "write_to_process_path"],
                                              sanitizeMentionsValue(value)
                                            );
                                          }}
                                        />
                                      </Form.Item>
                                    )
                                  },
                                  {
                                    title: "必填",
                                    width: 80,
                                    render: (_, field) => (
                                      <Form.Item name={[field.name, "required"]} valuePropName="checked" style={{ marginBottom: 0 }}>
                                        <Switch />
                                      </Form.Item>
                                    )
                                  },
                                  {
                                    title: "默认值",
                                    width: 120,
                                    render: (_, field) => (
                                      <Form.Item name={[field.name, "default"]} style={{ marginBottom: 0 }}>
                                        <Input placeholder="可选" />
                                      </Form.Item>
                                    )
                                  },
                                  {
                                    title: "操作",
                                    width: 66,
                                    render: (_, field) => (
                                      <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                                    )
                                  }
                                ]}
                                locale={{ emptyText: "暂无提取规则，点击右上角 + 添加" }}
                              />
                            </Card>
                          )}
                        </Form.List>
                      </Form.Item>

                      <Space size={16}>
                        <Form.Item label="保留 Raw Text" name={["responseConfig", "output", "keep_raw_text"]} valuePropName="checked">
                          <Switch />
                        </Form.Item>
                        <Form.Item label="保留 Raw JSON" name={["responseConfig", "output", "keep_raw_json"]} valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </Space>
                    </Card>
                  </>
                );
              }}
            </Form.Item>

            <Form.Item shouldUpdate noStyle>
              {({ getFieldValue }) => {
                const currentType = getFieldValue("type");
                if (currentType !== BlockEnum.Code) return null;
                return (
                  <>
                    <Form.Item label="运行语言" name="codeLanguage">
                      <Select
                        options={[
                          { label: "JavaScript", value: "javascript" },
                          { label: "Python", value: "python" }
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="执行超时(ms)" name="codeTimeout">
                      <Input type="number" min={100} step={100} />
                    </Form.Item>
                    <Form.Item label="代码脚本" name="codeScript" rules={[{ required: true, message: "请输入代码脚本" }]}>
                      {codeInputParamNames.length > 0 ? (
                        <Space wrap size={[8, 8]} style={{ marginBottom: 8 }}>
                          {codeInputParamNames.map((paramKey) => (
                            <Button key={paramKey} size="small" onClick={() => insertCodeParam(paramKey)}>
                              +参数 {paramKey}
                            </Button>
                          ))}
                        </Space>
                      ) : null}
                      <Input.TextArea
                        ref={codeScriptRef}
                        rows={10}
                        placeholder={"JavaScript 示例：\n// 输入参数在 inputs 中\nreturn inputs;"}
                      />
                    </Form.Item>
                    <Form.Item label="示例">
                      <Input.TextArea value={codeExampleText} readOnly rows={10} />
                    </Form.Item>
                    <Form.Item label="输入映射" extra="把上游/全局/流程对象参数映射到代码中的 inputs。">
                      <Form.List name="codeInputMappings">
                        {(fields, { add, remove }) => (
                          <Card
                            size="small"
                            bordered={false}
                            styles={{ body: { padding: 0 } }}
                            extra={
                              <Button
                                type="text"
                                icon={<PlusOutlined />}
                                onClick={() => add({ id: `code_in_${Date.now()}`, key: "", source: "", required: false, default: "" })}
                              />
                            }
                          >
                            <Table
                              size="small"
                              pagination={false}
                              rowKey={(record) => String(record.key)}
                              dataSource={fields}
                              columns={[
                                {
                                  title: "参数名",
                                  width: 140,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "key"]} style={{ marginBottom: 0 }}>
                                      <Input placeholder="如：query" />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "来源",
                                  width: 240,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "source"]} style={{ marginBottom: 0 }}>
                                      <Select
                                        showSearch
                                        allowClear
                                        placeholder="选择参数来源"
                                        options={codeSourceGroupedOptions}
                                        optionFilterProp="label"
                                      />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "必填",
                                  width: 80,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "required"]} valuePropName="checked" style={{ marginBottom: 0 }}>
                                      <Switch />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "默认值",
                                  width: 120,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "default"]} style={{ marginBottom: 0 }}>
                                      <Input placeholder="可选" />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "操作",
                                  width: 66,
                                  render: (_, field) => (
                                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                                  )
                                }
                              ]}
                              locale={{ emptyText: "暂无输入映射，点击右上角 + 添加" }}
                            />
                          </Card>
                        )}
                      </Form.List>
                    </Form.Item>
                    <Form.Item label="输出映射" extra="把代码返回 outputs 的字段写入流程对象。">
                      <Form.List name="codeOutputMappings">
                        {(fields, { add, remove }) => (
                          <Card
                            size="small"
                            bordered={false}
                            styles={{ body: { padding: 0 } }}
                            extra={<Button type="text" icon={<PlusOutlined />} onClick={() => add({ id: `code_out_${Date.now()}`, key: "", target: "" })} />}
                          >
                            <Table
                              size="small"
                              pagination={false}
                              rowKey={(record) => String(record.key)}
                              dataSource={fields}
                              columns={[
                                {
                                  title: "返回键",
                                  width: 160,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "key"]} style={{ marginBottom: 0 }}>
                                      <Input placeholder="如：answer" />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "写入目标",
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "target"]} style={{ marginBottom: 0 }}>
                                      <Select
                                        showSearch
                                        allowClear
                                        placeholder={processObjectPathOptions.length > 0 ? "选择流程对象路径" : "请先配置流程对象结构"}
                                        options={processObjectPathOptions}
                                        optionFilterProp="label"
                                      />
                                    </Form.Item>
                                  )
                                },
                                {
                                  title: "操作",
                                  width: 66,
                                  render: (_, field) => (
                                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                                  )
                                }
                              ]}
                              locale={{ emptyText: "暂无输出映射，点击右上角 + 添加" }}
                            />
                          </Card>
                        )}
                      </Form.List>
                    </Form.Item>
                  </>
                );
              }}
            </Form.Item>

            <Form.Item shouldUpdate noStyle>
              {({ getFieldValue }) => {
                const currentType = getFieldValue("type");
                if (currentType !== BlockEnum.Start) return null;
                const currentStartForms = normalizeInputForms(activeNode.data.input_config?.forms ?? []);
                return (
                  <Form.Item label="开始节点表单配置" extra="已替换为自由 Workflow 的自定义表单配置组件。">
                    <InputFormConfigEditor
                      value={currentStartForms}
                      currentNodeID={activeNode.id}
                      upstreamRefOptions={upstreamReferenceFlatOptions}
                      onChange={(nextForms) => {
                        const normalizedForms = normalizeInputForms(nextForms);
                        const refsSummary = collectRuleRefsFromForms(normalizedForms).map((token) => tokenToReadableLabel(token, nodes)).join("\n");
                        nodeForm.setFieldValue("inputRefsSummary", refsSummary);
                        setNodes((current) =>
                          current.map((node) =>
                            node.id === activeNode.id
                              ? {
                                  ...node,
                                  data: {
                                    ...node.data,
                                    variables: [],
                                    input_config: {
                                      ...(node.data.input_config ?? { fields: [] }),
                                      forms: normalizedForms,
                                      fields: flattenInputFormsToFields(normalizedForms)
                                    }
                                  }
                                }
                              : node
                          )
                        );
                      }}
                    />
                    <Form.Item label="变量引用汇总" name="inputRefsSummary" extra="自动汇总当前 Start 节点规则中引用的参数（只读）。" style={{ marginTop: 12 }}>
                      <Input.TextArea rows={4} readOnly placeholder="暂无引用参数" />
                    </Form.Item>
                  </Form.Item>
                );
              }}
            </Form.Item>

            <Form.Item shouldUpdate noStyle>
              {({ getFieldValue }) => {
                const currentType = getFieldValue("type");
                if (currentType !== BlockEnum.Input) return null;
                const currentInputForms = normalizeInputForms(activeNode.data.input_config?.forms ?? []);
                return (
                  <Form.Item label="输入表单配置" extra="已替换为自由 Workflow 的自定义表单配置组件。">
                    <InputFormConfigEditor
                      value={currentInputForms}
                      currentNodeID={activeNode.id}
                      upstreamRefOptions={upstreamReferenceFlatOptions}
                      onChange={(nextForms) => {
                        const normalizedForms = normalizeInputForms(nextForms);
                        const refsSummary = collectRuleRefsFromForms(normalizedForms).map((token) => tokenToReadableLabel(token, nodes)).join("\n");
                        nodeForm.setFieldValue("inputRefsSummary", refsSummary);
                        setNodes((current) =>
                          current.map((node) =>
                            node.id === activeNode.id
                              ? {
                                  ...node,
                                  data: {
                                    ...node.data,
                                    variables: collectRuleRefsFromForms(normalizedForms).map((ref) => ({ variable: ref })),
                                    input_config: {
                                      ...(node.data.input_config ?? { fields: [] }),
                                      forms: normalizedForms,
                                      fields: flattenInputFormsToFields(normalizedForms)
                                    }
                                  }
                                }
                              : node
                          )
                        );
                      }}
                    />
                    <Form.Item label="变量引用汇总" name="inputRefsSummary" extra="自动汇总当前 Input 节点规则中引用的参数（只读）。" style={{ marginTop: 12 }}>
                      <Input.TextArea rows={4} readOnly placeholder="暂无引用参数" />
                    </Form.Item>
                  </Form.Item>
                );
              }}
            </Form.Item>

            <Form.Item label="启用错误处理" name="errorEnabled" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        ) : null}
      </Drawer>
    </Space>
  );
}

function DifyWorkflowMigratedCanvas() {
  return (
    <ReactFlowProvider>
      <DifyWorkflowStoreProvider>
        <DifyWorkflowMigratedCanvasInner />
      </DifyWorkflowStoreProvider>
    </ReactFlowProvider>
  );
}

export default DifyWorkflowMigratedCanvas;
