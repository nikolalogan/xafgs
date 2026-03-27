import { useEffect, useMemo, useState } from "react";
import { App, Button, Card, Input, Modal, Select, Space, Switch, Tree, Typography } from "antd";
import { ApartmentOutlined, DeleteOutlined, PlusOutlined, SaveOutlined, UploadOutlined } from "@ant-design/icons";
import type { DataNode } from "antd/es/tree";
import type { DifyProcessObject, DifyProcessObjectNode } from "../types";
import SectionHeaderIcon from "./SectionHeaderIcon";

type Props = {
  value: DifyProcessObject;
  onChange: (next: DifyProcessObject) => void;
};

type ValueType = DifyProcessObjectNode["value_type"];

type TreeNode = DataNode & {
  key: string;
  name: string;
  value_type: ValueType;
  required: boolean;
  children?: TreeNode[];
};

const createNode = (patch?: Partial<DifyProcessObjectNode>): DifyProcessObjectNode => ({
  id: patch?.id || `po_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name: patch?.name || "",
  value_type: patch?.value_type || "string",
  required: !!patch?.required,
  children: patch?.children || []
});

const toTreeNodes = (nodes: DifyProcessObjectNode[]): TreeNode[] =>
  (nodes ?? []).map((node) => ({
    key: node.id,
    name: node.name,
    value_type: node.value_type,
    required: !!node.required,
    children: toTreeNodes(node.children || []),
    title: node.name || "未命名字段"
  }));

const fromTreeNodes = (nodes: TreeNode[]): DifyProcessObjectNode[] =>
  (nodes ?? []).map((node) => ({
    id: String(node.key),
    name: node.name,
    value_type: node.value_type,
    required: !!node.required,
    children: fromTreeNodes((node.children as TreeNode[]) || [])
  }));

const updateNodeByKey = (nodes: TreeNode[], key: string, patch: Partial<TreeNode>): TreeNode[] =>
  nodes.map((node) => {
    if (String(node.key) === key) {
      return {
        ...node,
        ...patch,
        title: patch.name ?? node.name ?? "未命名字段"
      };
    }
    const children = (node.children as TreeNode[]) || [];
    if (children.length === 0) return node;
    return {
      ...node,
      children: updateNodeByKey(children, key, patch)
    };
  });

const addChildByKey = (nodes: TreeNode[], key: string): TreeNode[] =>
  nodes.map((node) => {
    if (String(node.key) === key) {
      const nextChild: TreeNode = {
        key: `po_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: "",
        value_type: "string",
        required: false,
        children: [],
        title: "未命名字段"
      };
      return {
        ...node,
        children: [...(((node.children as TreeNode[]) || [])), nextChild]
      };
    }
    const children = (node.children as TreeNode[]) || [];
    if (children.length === 0) return node;
    return {
      ...node,
      children: addChildByKey(children, key)
    };
  });

const removeNodeByKey = (nodes: TreeNode[], key: string): TreeNode[] =>
  nodes
    .filter((node) => String(node.key) !== key)
    .map((node) => ({
      ...node,
      children: removeNodeByKey((node.children as TreeNode[]) || [], key)
    }));

const inferValueType = (schema: any): ValueType => {
  const typeValue = Array.isArray(schema?.type) ? schema.type[0] : schema?.type;
  if (typeValue === "number") return "number";
  if (typeValue === "integer") return "integer";
  if (typeValue === "boolean") return "boolean";
  if (typeValue === "object") return "object";
  if (typeValue === "array") return "array";
  if (typeValue === "string") return "string";
  return schema?.properties ? "object" : "json";
};

const schemaPropertyToNode = (name: string, schema: any, required = false): DifyProcessObjectNode => {
  const valueType = inferValueType(schema);
  const node = createNode({
    name,
    value_type: valueType,
    required
  });
  if (valueType === "object") {
    const properties = schema?.properties ?? {};
    const requiredSet = new Set<string>((schema?.required ?? []).map((item: any) => String(item)));
    node.children = Object.entries(properties).map(([key, childSchema]) => schemaPropertyToNode(String(key), childSchema, requiredSet.has(String(key))));
  }
  if (valueType === "array" && schema?.items && (schema.items.properties || schema.items.type === "object")) {
    const itemSchema = schema.items;
    const requiredSet = new Set<string>((itemSchema?.required ?? []).map((item: any) => String(item)));
    node.children = Object.entries(itemSchema?.properties ?? {}).map(([key, childSchema]) =>
      schemaPropertyToNode(String(key), childSchema, requiredSet.has(String(key)))
    );
  }
  return node;
};

const parseSchemaToFields = (schema: any): DifyProcessObjectNode[] => {
  if (!schema || typeof schema !== "object") return [];
  const rootType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (rootType === "object" || schema.properties) {
    const properties = schema.properties ?? {};
    const requiredSet = new Set<string>((schema.required ?? []).map((item: any) => String(item)));
    return Object.entries(properties).map(([key, childSchema]) => schemaPropertyToNode(String(key), childSchema, requiredSet.has(String(key))));
  }
  if (rootType === "array" && schema.items?.properties) {
    return [schemaPropertyToNode("items", schema.items, false)];
  }
  return [schemaPropertyToNode("value", schema, false)];
};

function ProcessObjectPanel({ value, onChange }: Props) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<DifyProcessObject>(value);
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [schemaTextDraft, setSchemaTextDraft] = useState("");

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const treeData = useMemo(() => toTreeNodes(draft.fields || []), [draft.fields]);

  const updateTree = (nextTree: TreeNode[]) => {
    setDraft((current) => ({
      ...current,
      fields: fromTreeNodes(nextTree)
    }));
  };

  return (
    <Card
      size="small"
      title={<SectionHeaderIcon icon={<ApartmentOutlined />} label="流程对象" tone="blue" />}
      extra={
        <Space>
          <Button
            size="small"
            icon={<UploadOutlined />}
            onClick={() => {
              setSchemaTextDraft(draft.schema_text || "");
              setSchemaModalOpen(true);
            }}
          >
            导入 JSON Schema
          </Button>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              setDraft((current) => ({
                ...current,
                fields: [...(current.fields || []), createNode()]
              }));
            }}
          >
            新增根字段
          </Button>
          <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => onChange(draft)}>
            保存
          </Button>
        </Space>
      }
    >
      <Tree
        blockNode
        defaultExpandAll
        treeData={treeData}
        titleRender={(rawNode) => {
          const node = rawNode as TreeNode;
          return (
            <Space size={8} onClick={(event) => event.stopPropagation()}>
              <Input
                style={{ width: 160 }}
                placeholder="字段名"
                value={node.name}
                onChange={(event) => updateTree(updateNodeByKey(treeData, String(node.key), { name: event.target.value }))}
              />
              <Select
                style={{ width: 124 }}
                value={node.value_type}
                options={[
                  { label: "string", value: "string" },
                  { label: "number", value: "number" },
                  { label: "integer", value: "integer" },
                  { label: "boolean", value: "boolean" },
                  { label: "object", value: "object" },
                  { label: "array", value: "array" },
                  { label: "json", value: "json" }
                ]}
                onChange={(nextValue) => {
                  updateTree(updateNodeByKey(treeData, String(node.key), { value_type: nextValue as ValueType }));
                }}
              />
              <Space size={4}>
                <Typography.Text type="secondary">必填</Typography.Text>
                <Switch
                  size="small"
                  checked={!!node.required}
                  onChange={(checked) => updateTree(updateNodeByKey(treeData, String(node.key), { required: checked }))}
                />
              </Space>
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => updateTree(addChildByKey(treeData, String(node.key)))} />
              <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => updateTree(removeNodeByKey(treeData, String(node.key)))} />
            </Space>
          );
        }}
      />

      <Modal
        title="导入流程对象 JSON Schema"
        open={schemaModalOpen}
        onCancel={() => setSchemaModalOpen(false)}
        onOk={() => {
          try {
            const parsed = JSON.parse(schemaTextDraft || "{}");
            const fields = parseSchemaToFields(parsed);
            setDraft({
              schema_text: schemaTextDraft,
              fields
            });
            setSchemaModalOpen(false);
            message.success("JSON Schema 已导入为树结构");
          } catch (error) {
            message.error(error instanceof Error ? error.message : "JSON Schema 解析失败");
          }
        }}
        okText="导入"
        cancelText="取消"
        width={760}
      >
        <Input.TextArea
          value={schemaTextDraft}
          onChange={(event) => setSchemaTextDraft(event.target.value)}
          autoSize={{ minRows: 12 }}
          placeholder='粘贴 JSON Schema，例如：{"type":"object","properties":{"user":{"type":"object","properties":{"id":{"type":"string"}}}}}'
        />
      </Modal>
    </Card>
  );
}

export default ProcessObjectPanel;
