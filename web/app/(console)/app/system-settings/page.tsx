'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, Select, Switch, message } from 'antd'
import { useConsoleRole } from '@/lib/useConsoleRole'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type SystemModelOption = {
  name: string
  label: string
  enabled: boolean
}

type SystemConfigDTO = {
  models: SystemModelOption[]
  defaultModel: string
  codeDefaultModel: string
  searchService: string
  localEmbeddingBaseUrl: string
  localEmbeddingApiKey: string
  localEmbeddingModel: string
  localEmbeddingDimension: number
  updatedAt?: string
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const normalizeConfig = (raw?: SystemConfigDTO): SystemConfigDTO => {
  const rawModels = Array.isArray(raw?.models) ? raw?.models : []
  const models = rawModels
    .map(item => ({
      name: String(item?.name || '').trim(),
      label: String(item?.label || '').trim(),
      enabled: Boolean(item?.enabled),
    }))
    .filter(item => item.name)
  if (models.length === 0) {
    return {
      models: [{ name: 'gpt-4o-mini', label: 'GPT-4o mini', enabled: true }],
      defaultModel: 'gpt-4o-mini',
      codeDefaultModel: 'gpt-4o-mini',
      searchService: 'tavily',
      localEmbeddingBaseUrl: String(raw?.localEmbeddingBaseUrl || '').trim(),
      localEmbeddingApiKey: String(raw?.localEmbeddingApiKey || '').trim(),
      localEmbeddingModel: String(raw?.localEmbeddingModel || '').trim(),
      localEmbeddingDimension: Number(raw?.localEmbeddingDimension || 0) > 0 ? Number(raw?.localEmbeddingDimension || 0) : 0,
      updatedAt: raw?.updatedAt,
    }
  }
  const enabled = models.filter(item => item.enabled)
  const fallbackDefault = enabled[0]?.name || models[0]?.name || 'gpt-4o-mini'
  const defaultModel = String(raw?.defaultModel || '').trim()
  const enabledNames = new Set(enabled.map(item => item.name))
  return {
    models,
    defaultModel: enabledNames.has(defaultModel) ? defaultModel : fallbackDefault,
    codeDefaultModel: enabledNames.has(String(raw?.codeDefaultModel || '').trim()) ? String(raw?.codeDefaultModel || '').trim() : (enabledNames.has(defaultModel) ? defaultModel : fallbackDefault),
    searchService: String(raw?.searchService || '').trim() || 'tavily',
    localEmbeddingBaseUrl: String(raw?.localEmbeddingBaseUrl || '').trim(),
    localEmbeddingApiKey: String(raw?.localEmbeddingApiKey || '').trim(),
    localEmbeddingModel: String(raw?.localEmbeddingModel || '').trim(),
    localEmbeddingDimension: Number(raw?.localEmbeddingDimension || 0) > 0 ? Number(raw?.localEmbeddingDimension || 0) : 0,
    updatedAt: raw?.updatedAt,
  }
}

type SystemConfigForm = {
  defaultModel: string
  codeDefaultModel: string
  searchService: string
  models: SystemModelOption[]
  localEmbeddingBaseUrl: string
  localEmbeddingApiKey: string
  localEmbeddingModel: string
  localEmbeddingDimension: string
}

export default function SystemSettingsPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const { role: currentRole, hydrated } = useConsoleRole()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<SystemConfigForm>()

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (init?.headers)
      Object.assign(headers, init.headers as Record<string, string>)
    if (token)
      headers.Authorization = `Bearer ${token}`

    const response = await fetch(url, {
      ...init,
      headers,
      credentials: 'include',
    })
    const payload = await response.json() as ApiResponse<T>
    if (response.status === 401) {
      router.push('/?redirect=/app/system-settings')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const canAccess = useMemo(() => currentRole === 'admin', [currentRole])
  const models = Form.useWatch('models', form) || []
  const enabledModelOptions = useMemo(() => {
    return models
      .filter(item => item?.enabled && String(item?.name || '').trim())
      .map(item => ({ label: String(item?.label || '').trim() || String(item?.name || '').trim(), value: String(item?.name || '').trim() }))
  }, [models])

  const fetchConfig = async () => {
    setLoading(true)
    try {
      const data = await request<SystemConfigDTO>('/api/system-config', { method: 'GET' })
      const config = normalizeConfig(data)
      form.setFieldsValue({
        models: config.models,
        defaultModel: config.defaultModel,
        codeDefaultModel: config.codeDefaultModel,
        searchService: config.searchService,
        localEmbeddingBaseUrl: config.localEmbeddingBaseUrl,
        localEmbeddingApiKey: config.localEmbeddingApiKey,
        localEmbeddingModel: config.localEmbeddingModel,
        localEmbeddingDimension: String(config.localEmbeddingDimension || 0),
      })
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载系统配置失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canAccess)
      return
    fetchConfig()
  }, [canAccess])

  const save = async () => {
    const values = await form.validateFields()
    const normalized = normalizeConfig({
      models: Array.isArray(values.models) ? values.models : [],
      defaultModel: values.defaultModel,
      codeDefaultModel: values.codeDefaultModel,
      searchService: values.searchService,
      localEmbeddingBaseUrl: String(values.localEmbeddingBaseUrl || '').trim(),
      localEmbeddingApiKey: String(values.localEmbeddingApiKey || '').trim(),
      localEmbeddingModel: String(values.localEmbeddingModel || '').trim(),
      localEmbeddingDimension: Number.parseInt(String(values.localEmbeddingDimension || '').trim(), 10) || 0,
    })
    const names = normalized.models.map(item => item.name)
    if (new Set(names).size !== names.length) {
      msgApi.error('模型名称不能重复')
      return
    }
    if (normalized.models.length === 0) {
      msgApi.error('至少保留一个模型')
      return
    }
    if (enabledModelOptions.length === 0) {
      msgApi.error('至少启用一个模型')
      return
    }

    setSaving(true)
    try {
      await request<SystemConfigDTO>('/api/system-config', {
        method: 'PUT',
        body: JSON.stringify({
          models: normalized.models,
          defaultModel: normalized.defaultModel,
          codeDefaultModel: normalized.codeDefaultModel,
          searchService: normalized.searchService,
          localEmbeddingBaseUrl: normalized.localEmbeddingBaseUrl,
          localEmbeddingApiKey: normalized.localEmbeddingApiKey,
          localEmbeddingModel: normalized.localEmbeddingModel,
          localEmbeddingDimension: normalized.localEmbeddingDimension,
        }),
      })
      msgApi.success('保存成功')
      fetchConfig()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '保存失败')
    }
    finally {
      setSaving(false)
    }
  }

  if (!hydrated) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <div className="text-sm text-gray-500">加载中...</div>
      </div>
    )
  }

  if (!canAccess) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">系统设置仅管理员可访问。</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {contextHolder}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">系统设置</div>
          <Button type="primary" onClick={save} loading={saving} disabled={loading}>保存</Button>
        </div>

        <Form<SystemConfigForm>
          form={form}
          layout="vertical"
          disabled={loading}
          initialValues={{
            models: [{ name: 'gpt-4o-mini', label: 'GPT-4o mini', enabled: true }],
            defaultModel: 'gpt-4o-mini',
            codeDefaultModel: 'gpt-4o-mini',
            searchService: 'tavily',
            localEmbeddingBaseUrl: '',
            localEmbeddingApiKey: '',
            localEmbeddingModel: '',
            localEmbeddingDimension: '0',
          }}
        >
          <Form.List name="models">
            {(fields, { add, remove }) => (
              <div className="space-y-2">
                {fields.map((field) => (
                  <div key={field.key} className="grid grid-cols-12 gap-2 rounded border border-gray-200 p-2">
                    <div className="col-span-3">
                      <Form.Item
                        label="模型名称"
                        name={[field.name, 'name']}
                        rules={[{ required: true, message: '请输入模型名称' }]}
                        className="mb-0"
                      >
                        <Input placeholder="例如 gpt-4o-mini" autoComplete="off" />
                      </Form.Item>
                    </div>
                    <div className="col-span-3">
                      <Form.Item
                        label="展示名称"
                        name={[field.name, 'label']}
                        className="mb-0"
                      >
                        <Input placeholder="例如 GPT-4o mini" autoComplete="off" />
                      </Form.Item>
                    </div>
                    <div className="col-span-2">
                      <Form.Item
                        label="启用"
                        name={[field.name, 'enabled']}
                        valuePropName="checked"
                        className="mb-0"
                      >
                        <Switch />
                      </Form.Item>
                    </div>
                    <div className="col-span-2 flex items-end">
                      <Button danger onClick={() => remove(field.name)} block>删除</Button>
                    </div>
                  </div>
                ))}
                <Button onClick={() => add({ name: '', label: '', enabled: true })} block>
                  新增模型
                </Button>
              </div>
            )}
          </Form.List>

          <Form.Item
            label="默认模型"
            name="defaultModel"
            className="mt-3"
            rules={[{ required: true, message: '请选择默认模型' }]}
          >
            <Select
              placeholder="请选择默认模型"
              options={enabledModelOptions}
              disabled={enabledModelOptions.length === 0}
            />
          </Form.Item>
          <Form.Item
            label="搜索服务"
            name="searchService"
            className="mt-3"
            rules={[{ required: true, message: '请选择搜索服务' }]}
          >
            <Select
              placeholder="请选择搜索服务"
              options={[{ label: 'Tavily', value: 'tavily' }]}
            />
          </Form.Item>
          <Form.Item
            label="代码默认模型"
            name="codeDefaultModel"
            className="mt-3"
            rules={[{ required: true, message: '请选择代码默认模型' }]}
          >
            <Select
              placeholder="请选择代码默认模型"
              options={enabledModelOptions}
              disabled={enabledModelOptions.length === 0}
            />
          </Form.Item>
          <div className="mt-4 rounded-lg border border-gray-200 p-3">
            <div className="mb-2 text-sm font-semibold text-gray-900">本地 AI 向量服务</div>
            <Form.Item
              label="本地向量服务地址"
              name="localEmbeddingBaseUrl"
            >
              <Input placeholder="例如 http://127.0.0.1:11434/v1" autoComplete="off" />
            </Form.Item>
            <Form.Item
              label="本地向量服务 API Key（系统级）"
              name="localEmbeddingApiKey"
            >
              <Input.Password placeholder="请输入系统级 API Key" autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="向量模型"
              name="localEmbeddingModel"
            >
              <Input placeholder="例如 jinaai/jina-embeddings-v5-text-small" autoComplete="off" />
            </Form.Item>
            <Form.Item
              label="向量维度"
              name="localEmbeddingDimension"
              extra="例如 1024；未配置或 <=0 会导致向量检索不可用"
            >
              <Input placeholder="例如 1024" autoComplete="off" />
            </Form.Item>
          </div>
        </Form>
      </div>
    </div>
  )
}
