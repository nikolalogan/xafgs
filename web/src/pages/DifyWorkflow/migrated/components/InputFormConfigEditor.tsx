import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Collapse, Empty, Flex, Form, Input, Mentions, Modal, Select, Space, Switch, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { DifyNodeData } from "../types";

type InputFormConfig = NonNullable<NonNullable<DifyNodeData["input_config"]>["forms"]>;
type InputForm = NonNullable<InputFormConfig>[number];
type InputItem = InputForm["items"][number];
type SelectOption = NonNullable<InputItem["options"]>[number];

type RefOption = {
  label: string;
  value: string; // token: nodeId.paramId
};

type Props = {
  value?: InputFormConfig;
  currentNodeID: string;
  upstreamRefOptions?: RefOption[];
  onChange?: (value: InputFormConfig) => void;
};

const genID = () => Math.random().toString(36).slice(2, 10);

const itemTypeOptions = [
  { label: "文本", value: "text" },
  { label: "段落", value: "paragraph" },
  { label: "下拉选项", value: "select" },
  { label: "数字", value: "number" },
  { label: "复选框", value: "checkbox" },
  { label: "单文件", value: "file" },
  { label: "文件列表", value: "file-list" },
  { label: "JSON", value: "json" }
] as const;

const extractRefsFromScript = (script: string) => {
  const matches = script.match(/\{\{([^}]+)\}\}/g) ?? [];
  return Array.from(new Set(matches.map((token) => token.slice(2, -2).trim()).filter(Boolean)));
};

const getScriptError = (script: string) => {
  const trimmed = script.trim();
  if (!trimmed) return "";
  if (!/\breturn\b/.test(trimmed)) return "脚本需包含 return，并返回 true 或 false";
  return "";
};

const sanitizeScript = (script: string) => script.replace(/\/(\{\{[^}]+\}\})/g, "$1");

const insertAtCursor = (base: string, snippet: string, cursor?: number) => {
  const position = typeof cursor === "number" && cursor >= 0 ? cursor : base.length;
  return `${base.slice(0, position)}${snippet}${base.slice(position)}`;
};

const validationTemplates = [
  {
    key: "not-empty",
    label: "非空校验",
    script: "const value = '';\nreturn String(value).trim().length > 0;"
  },
  {
    key: "number-range",
    label: "数值范围校验",
    script: "const value = 0;\nconst min = 0;\nconst max = 100;\nreturn Number(value) >= min && Number(value) <= max;"
  }
] as const;

const visibilityTemplates = [
  {
    key: "always-show",
    label: "始终可见",
    script: "return true;"
  },
  {
    key: "conditional-show",
    label: "条件可见模板",
    script: "const flag = true;\nreturn !!flag;"
  }
] as const;

function InputFormConfigEditor({ value, currentNodeID, upstreamRefOptions = [], onChange }: Props) {
  const [forms, setForms] = useState<InputFormConfig>(value ?? []);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [targetFormID, setTargetFormID] = useState<string>("");
  const [caretMap, setCaretMap] = useState<Record<string, number>>({});
  const [addItemForm] = Form.useForm<{ type: InputItem["type"]; label: string; field: string }>();

  useEffect(() => {
    setForms(value ?? []);
  }, [value]);

  const trigger = useCallback(
    (next: InputFormConfig) => {
      setForms(next);
      onChange?.(next);
    },
    [onChange]
  );

  const makeScriptKey = useCallback((formID: string, itemID: string, kind: "validation" | "visibility") => `${formID}:${itemID}:${kind}`, []);

  const localRefOptions = useMemo(() => {
    return forms.flatMap((form) =>
      (form.items ?? [])
        .filter((item) => String(item.field ?? "").trim().length > 0)
        .map((item) => ({
          label: `当前节点.${item.field}`,
          value: `${currentNodeID}.${item.field}`
        }))
    );
  }, [currentNodeID, forms]);

  const mentionOptions = useMemo(() => {
    const merged = [...localRefOptions, ...upstreamRefOptions];
    const seen = new Set<string>();
    return merged
      .filter((item) => {
        if (seen.has(item.value)) return false;
        seen.add(item.value);
        return true;
      })
      .map((item) => ({ label: item.label, value: `{{${item.value}}}` }));
  }, [localRefOptions, upstreamRefOptions]);

  const addForm = useCallback(() => {
    const index = forms.length + 1;
    trigger([...(forms ?? []), { id: genID(), name: `表单${index}`, items: [] }]);
  }, [forms, trigger]);

  const removeForm = useCallback(
    (formID: string) => {
      trigger((forms ?? []).filter((form) => form.id !== formID));
    },
    [forms, trigger]
  );

  const updateForm = useCallback(
    (formID: string, patch: Partial<InputForm>) => {
      trigger((forms ?? []).map((form) => (form.id === formID ? { ...form, ...patch } : form)));
    },
    [forms, trigger]
  );

  const openAddItemModal = useCallback(
    (formID: string) => {
      setTargetFormID(formID);
      addItemForm.setFieldsValue({ type: "text", label: "", field: "" });
      setAddModalOpen(true);
    },
    [addItemForm]
  );

  const addItemByModal = useCallback(async () => {
    const values = await addItemForm.validateFields();
    const type = values.type;
    const baseItem: InputItem = {
      id: genID(),
      type,
      label: values.label?.trim() || "未命名字段",
      field: values.field?.trim() || `${type}_${genID()}`,
      required: false,
      default: "",
      validation_refs: [],
      validation_script: "",
      visibility_refs: [],
      visibility_script: ""
    };
    const item = type === "select" ? { ...baseItem, options: [] } : baseItem;
    const nextForms = (forms ?? []).map((form) => (form.id === targetFormID ? { ...form, items: [...form.items, item] } : form));
    trigger(nextForms);
    setAddModalOpen(false);
    addItemForm.resetFields();
  }, [addItemForm, forms, targetFormID, trigger]);

  const removeItem = useCallback(
    (formID: string, itemID: string) => {
      const nextForms = (forms ?? []).map((form) => (form.id === formID ? { ...form, items: form.items.filter((item) => item.id !== itemID) } : form));
      trigger(nextForms);
    },
    [forms, trigger]
  );

  const updateItem = useCallback(
    (formID: string, itemID: string, patch: Partial<InputItem>) => {
      const nextForms = (forms ?? []).map((form) =>
        form.id === formID ? { ...form, items: form.items.map((item) => (item.id === itemID ? { ...item, ...patch } : item)) } : form
      );
      trigger(nextForms);
    },
    [forms, trigger]
  );

  const updateScriptWithRefs = useCallback(
    (formID: string, itemID: string, key: "validation" | "visibility", script: string) => {
      const normalizedScript = sanitizeScript(script);
      const refs = extractRefsFromScript(normalizedScript);
      if (key === "validation") {
        updateItem(formID, itemID, { validation_script: normalizedScript, validation_refs: refs });
      } else {
        updateItem(formID, itemID, { visibility_script: normalizedScript, visibility_refs: refs });
      }
    },
    [updateItem]
  );

  const updateCaret = useCallback(
    (formID: string, itemID: string, kind: "validation" | "visibility", event: any) => {
      const target = event?.target as HTMLTextAreaElement | undefined;
      if (!target || typeof target.selectionStart !== "number") return;
      const key = makeScriptKey(formID, itemID, kind);
      setCaretMap((current) => ({ ...current, [key]: target.selectionStart }));
    },
    [makeScriptKey]
  );

  const applyTemplate = useCallback(
    (formID: string, itemID: string, kind: "validation" | "visibility", snippet: string) => {
      const targetItem = forms.find((form) => form.id === formID)?.items.find((item) => item.id === itemID);
      if (!targetItem) return;
      const currentScript = kind === "validation" ? targetItem.validation_script ?? "" : targetItem.visibility_script ?? "";
      const key = makeScriptKey(formID, itemID, kind);
      const nextScript = insertAtCursor(currentScript, snippet, caretMap[key]);
      updateScriptWithRefs(formID, itemID, kind, nextScript);
    },
    [caretMap, forms, makeScriptKey, updateScriptWithRefs]
  );

  const addOption = useCallback(
    (formID: string, itemID: string) => {
      const option: SelectOption = { id: genID(), name: "选项", value: "" };
      const nextForms = (forms ?? []).map((form) =>
        form.id === formID
          ? {
              ...form,
              items: form.items.map((item) => (item.id === itemID ? { ...item, options: [...(item.options ?? []), option] } : item))
            }
          : form
      );
      trigger(nextForms);
    },
    [forms, trigger]
  );

  const updateOption = useCallback(
    (formID: string, itemID: string, optionID: string, patch: Partial<SelectOption>) => {
      const nextForms = (forms ?? []).map((form) =>
        form.id === formID
          ? {
              ...form,
              items: form.items.map((item) =>
                item.id === itemID ? { ...item, options: (item.options ?? []).map((option) => (option.id === optionID ? { ...option, ...patch } : option)) } : item
              )
            }
          : form
      );
      trigger(nextForms);
    },
    [forms, trigger]
  );

  const removeOption = useCallback(
    (formID: string, itemID: string, optionID: string) => {
      const nextForms = (forms ?? []).map((form) =>
        form.id === formID
          ? {
              ...form,
              items: form.items.map((item) => (item.id === itemID ? { ...item, options: (item.options ?? []).filter((option) => option.id !== optionID) } : item))
            }
          : form
      );
      trigger(nextForms);
    },
    [forms, trigger]
  );

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={addForm}>
          新增表单
        </Button>
      </Space>

      {forms.length === 0 ? (
        <Empty description="暂无表单，点击上方新增" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={8}>
          {forms.map((form) => (
            <Card
              key={form.id}
              size="small"
              title={
                <Flex align="center" gap={8}>
                  <span>表单名称：</span>
                  <Input value={form.name} onChange={(event) => updateForm(form.id, { name: event.target.value })} style={{ width: 220 }} />
                </Flex>
              }
              extra={
                <Tooltip title="删除表单">
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeForm(form.id)} />
                </Tooltip>
              }
            >
              <Space style={{ marginBottom: 8 }}>
                <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => openAddItemModal(form.id)}>
                  新增输入项
                </Button>
              </Space>

              {form.items.length === 0 ? (
                <Empty description="暂无输入项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Space direction="vertical" style={{ width: "100%" }} size={8}>
                  {form.items.map((item) => (
                    <Card
                      key={item.id}
                      size="small"
                      type="inner"
                      title={`类型：${itemTypeOptions.find((option) => option.value === item.type)?.label || item.type}`}
                      extra={
                        <Tooltip title="删除输入项">
                          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeItem(form.id, item.id)} />
                        </Tooltip>
                      }
                    >
                      <Space direction="vertical" style={{ width: "100%" }} size={8}>
                        <Space wrap>
                          <Input value={item.label} onChange={(event) => updateItem(form.id, item.id, { label: event.target.value })} placeholder="变量名称" style={{ width: 180 }} />
                          <Input value={item.field} onChange={(event) => updateItem(form.id, item.id, { field: event.target.value })} placeholder="变量编码" style={{ width: 180 }} />
                          <Select
                            style={{ width: 160 }}
                            value={item.type}
                            options={itemTypeOptions as any}
                            onChange={(type: InputItem["type"]) => updateItem(form.id, item.id, { type, options: type === "select" ? item.options ?? [] : undefined })}
                          />
                        </Space>
                        <Space wrap>
                          <Input value={item.default ?? ""} onChange={(event) => updateItem(form.id, item.id, { default: event.target.value })} placeholder="默认值" style={{ width: 220 }} />
                          <Flex align="center" gap={8}>
                            <span>必填</span>
                            <Switch checked={!!item.required} onChange={(checked) => updateItem(form.id, item.id, { required: checked })} />
                          </Flex>
                        </Space>

                        {item.type === "select" ? (
                          <Space direction="vertical" size={6} style={{ width: "100%" }}>
                            <Button size="small" icon={<PlusOutlined />} onClick={() => addOption(form.id, item.id)}>
                              新增选项
                            </Button>
                            {(item.options ?? []).map((option) => (
                              <Flex key={option.id} align="center" gap={6}>
                                <Input
                                  style={{ width: 160 }}
                                  placeholder="选项名称"
                                  value={option.name}
                                  onChange={(event) => updateOption(form.id, item.id, option.id, { name: event.target.value })}
                                />
                                <Input
                                  style={{ width: 200 }}
                                  placeholder="选项值"
                                  value={option.value}
                                  onChange={(event) => updateOption(form.id, item.id, option.id, { value: event.target.value })}
                                />
                                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeOption(form.id, item.id, option.id)} />
                              </Flex>
                            ))}
                          </Space>
                        ) : null}

                        <Collapse
                          size="small"
                          items={[
                            {
                              key: "advanced",
                              label: "高级",
                              children: (
                                <Space direction="vertical" style={{ width: "100%" }} size={10}>
                                  <Card size="small" title="参数校验规则">
                                    <Space direction="vertical" style={{ width: "100%" }} size={8}>
                                      <Space wrap size={6}>
                                        {validationTemplates.map((template) => (
                                          <Button key={template.key} size="small" type="dashed" onClick={() => applyTemplate(form.id, item.id, "validation", template.script)}>
                                            {template.label}
                                          </Button>
                                        ))}
                                      </Space>
                                      <Mentions
                                        rows={3}
                                        value={item.validation_script ?? ""}
                                        onChange={(value) => updateScriptWithRefs(form.id, item.id, "validation", value)}
                                        onKeyUp={(event) => updateCaret(form.id, item.id, "validation", event)}
                                        onClick={(event) => updateCaret(form.id, item.id, "validation", event)}
                                        prefix={["/"]}
                                        options={mentionOptions}
                                        placeholder="输入判断逻辑；输入 / 可选择参数，插入 {{节点.参数}}"
                                      />
                                      {getScriptError(item.validation_script ?? "") ? (
                                        <Typography.Text type="danger">{getScriptError(item.validation_script ?? "")}</Typography.Text>
                                      ) : null}
                                      <Space wrap size={4}>
                                        {(item.validation_refs ?? []).map((ref) => (
                                          <Tag key={ref} color="blue">
                                            {`{{${ref}}}`}
                                          </Tag>
                                        ))}
                                      </Space>
                                    </Space>
                                  </Card>
                                  <Card size="small" title="可见规则">
                                    <Space direction="vertical" style={{ width: "100%" }} size={8}>
                                      <Space wrap size={6}>
                                        {visibilityTemplates.map((template) => (
                                          <Button key={template.key} size="small" type="dashed" onClick={() => applyTemplate(form.id, item.id, "visibility", template.script)}>
                                            {template.label}
                                          </Button>
                                        ))}
                                      </Space>
                                      <Mentions
                                        rows={3}
                                        value={item.visibility_script ?? ""}
                                        onChange={(value) => updateScriptWithRefs(form.id, item.id, "visibility", value)}
                                        onKeyUp={(event) => updateCaret(form.id, item.id, "visibility", event)}
                                        onClick={(event) => updateCaret(form.id, item.id, "visibility", event)}
                                        prefix={["/"]}
                                        options={mentionOptions}
                                        placeholder="输入显示逻辑；输入 / 可选择参数，插入 {{节点.参数}}"
                                      />
                                      {getScriptError(item.visibility_script ?? "") ? (
                                        <Typography.Text type="danger">{getScriptError(item.visibility_script ?? "")}</Typography.Text>
                                      ) : null}
                                      <Space wrap size={4}>
                                        {(item.visibility_refs ?? []).map((ref) => (
                                          <Tag key={ref} color="purple">
                                            {`{{${ref}}}`}
                                          </Tag>
                                        ))}
                                      </Space>
                                    </Space>
                                  </Card>
                                </Space>
                              )
                            }
                          ]}
                        />
                      </Space>
                    </Card>
                  ))}
                </Space>
              )}
            </Card>
          ))}
        </Space>
      )}

      <Modal title="新增输入项" open={addModalOpen} onCancel={() => setAddModalOpen(false)} onOk={() => void addItemByModal()} okText="添加" cancelText="取消">
        <Form form={addItemForm} layout="vertical" initialValues={{ type: "text" }}>
          <Form.Item label="参数类型" name="type" rules={[{ required: true, message: "请选择参数类型" }]}>
            <Select options={itemTypeOptions as any} />
          </Form.Item>
          <Form.Item label="变量名称" name="label" rules={[{ required: true, message: "请输入变量名称" }]}>
            <Input placeholder="例如：用户问题" />
          </Form.Item>
          <Form.Item label="变量编码" name="field" rules={[{ required: true, message: "请输入变量编码" }]}>
            <Input placeholder="例如：query" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default InputFormConfigEditor;
