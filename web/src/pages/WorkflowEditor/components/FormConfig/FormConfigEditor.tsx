import { useCallback, useEffect, useState } from "react";
import { Button, Card, Empty, Flex, Input, Space, Switch, Tooltip } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { FormConfig, FormItemConfig, FormItemType, NodeParams, SelectOption } from "../../utils/types";
import { composeCustomFieldCode, resolveFormIdentifier, resolveSchemaFieldIdentifier } from "../../utils/formKeys";

type Props = {
  value?: NodeParams;
  onChange?: (value: NodeParams) => void;
  nodeID: string;
  onBeforeRemoveParam?: (writerNodeID: string, paramField: string) => Promise<boolean>;
};

const genID = () => Math.random().toString(36).slice(2, 10);
const defaultParams: NodeParams = { forms: [] };

const collectParamFieldsFromItem = (form: FormConfig, item: FormItemConfig, formIndex: number) => {
  if (item.type !== "customForm") {
    const field = item.field?.trim();
    return field ? [field] : [];
  }
  const formIdentifier = resolveFormIdentifier(form, formIndex);
  const schemaList = Array.isArray(item.schema) ? item.schema : [];
  return schemaList
    .map((schemaItem, schemaIndex) => {
      if (!schemaItem || schemaItem.type === "divider") return "";
      const fieldIdentifier = resolveSchemaFieldIdentifier(schemaItem, schemaIndex);
      return composeCustomFieldCode(formIdentifier, fieldIdentifier);
    })
    .filter((field): field is string => !!field.trim());
};

function FormConfigEditor(props: Props) {
  const { value, onChange, nodeID, onBeforeRemoveParam } = props;
  const [params, setParams] = useState<NodeParams>(value ?? defaultParams);

  useEffect(() => {
    setParams(value ?? defaultParams);
  }, [value]);

  const trigger = useCallback(
    (next: NodeParams) => {
      setParams(next);
      onChange?.(next);
    },
    [onChange]
  );

  const addForm = useCallback(() => {
    const index = (params.forms?.length ?? 0) + 1;
    const next: NodeParams = {
      forms: [...(params.forms ?? []), { id: genID(), name: `表单${index}`, items: [] }]
    };
    trigger(next);
  }, [params.forms, trigger]);

  const removeForm = useCallback(
    async (formID: string) => {
      const forms = params.forms ?? [];
      const formIndex = forms.findIndex((form) => form.id === formID);
      const targetForm = formIndex >= 0 ? forms[formIndex] : undefined;
      if (!targetForm) return;
      const fields = Array.from(
        new Set(
          targetForm.items.flatMap((item) => collectParamFieldsFromItem(targetForm, item, formIndex))
            .filter((field): field is string => !!field)
        )
      );
      for (const field of fields) {
        if (!onBeforeRemoveParam) continue;
        const canRemove = await onBeforeRemoveParam(nodeID, field);
        if (!canRemove) return;
      }
      trigger({ forms: (params.forms ?? []).filter((form) => form.id !== formID) });
    },
    [nodeID, onBeforeRemoveParam, params.forms, trigger]
  );

  const updateForm = useCallback(
    (formID: string, patch: Partial<FormConfig>) => {
      trigger({
        forms: (params.forms ?? []).map((form) => (form.id === formID ? { ...form, ...patch } : form))
      });
    },
    [params.forms, trigger]
  );

  const addItem = useCallback(
    (formID: string, type: FormItemType) => {
      const baseItem: FormItemConfig = {
        id: genID(),
        type,
        label: type === "file" ? "文件" : type === "select" ? "选择" : "输入框",
        field: `${type}_${genID()}`,
        required: false
      };
      const item = type === "select" ? { ...baseItem, options: [] } : baseItem;
      const forms = (params.forms ?? []).map((form) => (form.id === formID ? { ...form, items: [...form.items, item] } : form));
      trigger({ forms });
    },
    [params.forms, trigger]
  );

  const removeItem = useCallback(
    async (formID: string, itemID: string) => {
      const forms = params.forms ?? [];
      const formIndex = forms.findIndex((form) => form.id === formID);
      const targetForm = formIndex >= 0 ? forms[formIndex] : undefined;
      const targetItem = targetForm?.items.find((item) => item.id === itemID);
      const fields = targetForm && targetItem ? collectParamFieldsFromItem(targetForm, targetItem, formIndex) : [];
      if (onBeforeRemoveParam) {
        for (const field of fields) {
          const canRemove = await onBeforeRemoveParam(nodeID, field);
          if (!canRemove) return;
        }
      }
      const nextForms = (params.forms ?? []).map((form) =>
        form.id === formID ? { ...form, items: form.items.filter((item) => item.id !== itemID) } : form
      );
      trigger({ forms: nextForms });
    },
    [nodeID, onBeforeRemoveParam, params.forms, trigger]
  );

  const updateItem = useCallback(
    (formID: string, itemID: string, patch: Partial<FormItemConfig>) => {
      const forms = (params.forms ?? []).map((form) =>
        form.id === formID
          ? { ...form, items: form.items.map((item) => (item.id === itemID ? { ...item, ...patch } : item)) }
          : form
      );
      trigger({ forms });
    },
    [params.forms, trigger]
  );

  const addOption = useCallback(
    (formID: string, itemID: string) => {
      const option: SelectOption = { id: genID(), name: "选项", value: "" };
      const forms = (params.forms ?? []).map((form) =>
        form.id === formID
          ? {
              ...form,
              items: form.items.map((item) => (item.id === itemID ? { ...item, options: [...(item.options ?? []), option] } : item))
            }
          : form
      );
      trigger({ forms });
    },
    [params.forms, trigger]
  );

  const updateOption = useCallback(
    (formID: string, itemID: string, optionID: string, patch: Partial<SelectOption>) => {
      const forms = (params.forms ?? []).map((form) =>
        form.id === formID
          ? {
              ...form,
              items: form.items.map((item) =>
                item.id === itemID
                  ? {
                      ...item,
                      options: (item.options ?? []).map((option) => (option.id === optionID ? { ...option, ...patch } : option))
                    }
                  : item
              )
            }
          : form
      );
      trigger({ forms });
    },
    [params.forms, trigger]
  );

  const removeOption = useCallback(
    (formID: string, itemID: string, optionID: string) => {
      const forms = (params.forms ?? []).map((form) =>
        form.id === formID
          ? {
              ...form,
              items: form.items.map((item) =>
                item.id === itemID ? { ...item, options: (item.options ?? []).filter((option) => option.id !== optionID) } : item
              )
            }
          : form
      );
      trigger({ forms });
    },
    [params.forms, trigger]
  );

  const forms = params.forms ?? [];

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
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void removeForm(form.id)} />
                </Tooltip>
              }
            >
              <Space style={{ marginBottom: 8 }}>
                <span>新增输入项：</span>
                <Button size="small" onClick={() => addItem(form.id, "input")}>
                  输入框
                </Button>
                <Button size="small" onClick={() => addItem(form.id, "file")}>
                  文件
                </Button>
                <Button size="small" onClick={() => addItem(form.id, "select")}>
                  选择框
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
                      title={`类型：${item.type}`}
                      extra={
                        <Tooltip title="删除输入项">
                          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void removeItem(form.id, item.id)} />
                        </Tooltip>
                      }
                    >
                      <Space direction="vertical" style={{ width: "100%" }} size={8}>
                        <Input value={item.label} onChange={(event) => updateItem(form.id, item.id, { label: event.target.value })} placeholder="显示名称" />
                        <Input value={item.field} onChange={(event) => updateItem(form.id, item.id, { field: event.target.value })} placeholder="字段标识" />
                        <Flex align="center" gap={8}>
                          <span>必填</span>
                          <Switch checked={!!item.required} onChange={(checked) => updateItem(form.id, item.id, { required: checked })} />
                        </Flex>
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
                      </Space>
                    </Card>
                  ))}
                </Space>
              )}
            </Card>
          ))}
        </Space>
      )}
    </div>
  );
}

export default FormConfigEditor;
