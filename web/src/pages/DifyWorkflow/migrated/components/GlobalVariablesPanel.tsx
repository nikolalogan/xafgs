import { useEffect, useState } from "react";
import { Button, Card, Input, Select, Space, Table } from "antd";
import { DatabaseOutlined, DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import type { DifyGlobalVariable } from "../types";
import SectionHeaderIcon from "./SectionHeaderIcon";

type Props = {
  variables: DifyGlobalVariable[];
  onChange: (variables: DifyGlobalVariable[]) => void;
};

function GlobalVariablesPanel({ variables, onChange }: Props) {
  const [draft, setDraft] = useState<DifyGlobalVariable[]>(variables);

  useEffect(() => {
    setDraft(variables);
  }, [variables]);

  const updateDraft = (id: string, patch: Partial<DifyGlobalVariable>) => {
    setDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const handleSave = (id: string) => {
    const target = draft.find((item) => item.id === id);
    if (!target) return;
    const next = variables.some((item) => item.id === id)
      ? variables.map((item) => (item.id === id ? { ...item, ...target } : item))
      : [...variables, target];
    onChange(next);
  };

  const handleDelete = (id: string) => {
    setDraft((current) => current.filter((item) => item.id !== id));
    onChange(variables.filter((item) => item.id !== id));
  };

  const handleAdd = () => {
    setDraft((current) => [
      ...current,
      {
        id: `var_${Date.now()}`,
        name: "",
        value_type: "string",
        value: ""
      }
    ]);
  };

  return (
    <Card
      size="small"
      title={<SectionHeaderIcon icon={<DatabaseOutlined />} label="全局变量" tone="blue" />}
      extra={
        <Button size="small" icon={<PlusOutlined />} onClick={handleAdd}>
          新增变量
        </Button>
      }
    >
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={draft}
        columns={[
          {
            title: "名称",
            dataIndex: "name",
            width: 140,
            render: (_, record) => <Input value={record.name} onChange={(event) => updateDraft(record.id, { name: event.target.value })} />
          },
          {
            title: "类型",
            dataIndex: "value_type",
            width: 120,
            render: (_, record) => (
              <Select
                value={record.value_type}
                style={{ width: "100%" }}
                options={[
                  { label: "string", value: "string" },
                  { label: "number", value: "number" },
                  { label: "boolean", value: "boolean" },
                  { label: "object", value: "object" },
                  { label: "array", value: "array" }
                ]}
                onChange={(value) => updateDraft(record.id, { value_type: value })}
              />
            )
          },
          {
            title: "值",
            dataIndex: "value",
            render: (_, record) => <Input value={record.value ?? ""} onChange={(event) => updateDraft(record.id, { value: event.target.value })} />
          },
          {
            title: "操作",
            width: 140,
            render: (_, record) => (
              <Space>
                <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => handleSave(record.id)}>
                  保存
                </Button>
                <Button danger size="small" icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)}>
                  删除
                </Button>
              </Space>
            )
          }
        ]}
      />
    </Card>
  );
}

export default GlobalVariablesPanel;
