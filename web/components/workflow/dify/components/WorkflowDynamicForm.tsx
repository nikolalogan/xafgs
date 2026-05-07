'use client'

import { useEffect } from 'react'
import { Checkbox, Empty, Form, Input, InputNumber, Select } from 'antd'
import {
  buildExternalRuleInputs,
  buildLocalRuleInputs,
  buildPreparedFields,
  evaluateDynamicFieldStates,
  evaluateDynamicFieldValidations,
  type DynamicField,
  type DynamicFieldState,
  validateDynamicInput,
} from '../core/dynamic-form-rules'

export type DynamicFormComputation = {
  fieldStates: DynamicFieldState[]
  validateErrors: Map<string, string | null>
}

export function computeDynamicFormState(
  nodeId: string,
  fields: DynamicField[],
  values: Record<string, unknown>,
  variables: Record<string, unknown>,
): DynamicFormComputation {
  if (!nodeId) {
      return {
        fieldStates: fields.map(item => ({
          item,
          visible: true,
          visibleError: null,
          validateError: null,
        })),
        validateErrors: new Map<string, string | null>(),
      }
  }

  const preparedFields = buildPreparedFields(fields, nodeId)
  const externalRuleInputs = buildExternalRuleInputs(preparedFields, variables)
  const localRuleInputs = buildLocalRuleInputs(nodeId, values)
  const ruleInputs = {
    ...externalRuleInputs,
    ...localRuleInputs,
  }
  const fieldStates = evaluateDynamicFieldStates(preparedFields, ruleInputs)
  const validateErrors = evaluateDynamicFieldValidations(preparedFields, ruleInputs)
  return { fieldStates, validateErrors }
}

export function validateDynamicFormValues(
  fields: DynamicField[],
  values: Record<string, unknown>,
  fieldStates?: DynamicFieldState[],
  validateErrors?: Record<string, string | null> | Map<string, string | null>,
) {
  return validateDynamicInput(fields, values, fieldStates, validateErrors)
}

type WorkflowDynamicFormProps = {
  fields?: DynamicField[]
  fieldStates?: DynamicFieldState[]
  values: Record<string, unknown>
  onChange?: (nextValues: Record<string, unknown>) => void
  disabled?: boolean
}

export default function WorkflowDynamicForm({
  fields,
  fieldStates,
  values,
  onChange,
  disabled = false,
}: WorkflowDynamicFormProps) {
  const normalizedStates = fieldStates ?? (fields ?? []).map(item => ({
    item,
    visible: true,
    visibleError: null,
    validateError: null,
  }))
  const visibleStates = normalizedStates.filter(state => state.visible)
  const [form] = Form.useForm()

  useEffect(() => {
    form.setFieldsValue(values)
  }, [form, values])

  if (!visibleStates.length)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前无可配置字段" />

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      disabled={disabled}
      onValuesChange={(_changed, allValues) => onChange?.(allValues)}
      className="m-0"
    >
      {visibleStates.map((state) => {
        const field = state.item
        const label = `${field.label || field.name}${field.required ? ' *' : ''}`
        const help = state.visibleError || state.validateError || undefined
        const validateStatus = help ? 'error' : undefined
        if (field.type === 'checkbox') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} valuePropName="checked" help={help} validateStatus={validateStatus}>
              <Checkbox>勾选</Checkbox>
            </Form.Item>
          )
        }
        if (field.type === 'paragraph') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
              <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
            </Form.Item>
          )
        }
        if (field.type === 'number') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          )
        }
        if (field.type === 'select') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
              <Select
                allowClear
                placeholder="请选择"
                options={field.options.map(option => ({
                  label: option.label || option.value,
                  value: option.value,
                }))}
              />
            </Form.Item>
          )
        }
        return (
          <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
            <Input />
          </Form.Item>
        )
      })}
    </Form>
  )
}
