'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Select, Space, Table, Tag, message } from 'antd'
import { useConsoleRole } from '@/lib/useConsoleRole'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type ParamLocation = 'path' | 'query' | 'body'

type FieldValidation = {
  required?: boolean
  enum?: string[]
  min?: number
  max?: number
  pattern?: string
}

type APIField = {
  name: string
  in: ParamLocation
  type: string
  description?: string
  validation?: FieldValidation
}

type APIResponseSchema = {
  httpStatus: number
  code: string
  contentType?: string
  description?: string
  dataShape?: string
  example?: unknown
}

type Trace = {
  timestamp: string
  requestId?: string
  method: string
  routePath: string
  statusCode: number
  durationMs: number
}

type APIRouteDoc = {
  method: string
  path: string
  summary?: string
  auth?: string
  params?: APIField[]
  responses?: APIResponseSchema[]
  lastTraces?: Trace[]
}

type RoutesPayload = {
  count: number
  routes: APIRouteDoc[]
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const authColor = (auth?: string) => {
  if (!auth)
    return 'default'
  if (auth === 'public')
    return 'blue'
  if (auth === 'admin')
    return 'red'
  if (auth === 'auth')
    return 'gold'
  return 'default'
}

export default function ApiMetaPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const { role: currentRole, hydrated } = useConsoleRole()
  const [loading, setLoading] = useState(false)
  const [routes, setRoutes] = useState<APIRouteDoc[]>([])
  const [keyword, setKeyword] = useState('')
  const [method, setMethod] = useState<string>('ALL')
  const [group, setGroup] = useState<string>('ALL')
  const [auth, setAuth] = useState<string>('ALL')

  const resolveGroupKey = (path: string) => {
    const trimmed = String(path || '').trim()
    if (!trimmed)
      return ''
    const normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
    const parts = normalized.split('/').filter(Boolean)
    const withoutApi = parts[0] === 'api' ? parts.slice(1) : parts
    if (withoutApi.length === 0)
      return ''
    if (withoutApi[0] === 'workflow' && withoutApi[1])
      return `${withoutApi[0]}/${withoutApi[1]}`
    return withoutApi[0]
  }

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
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
	      router.push('/?redirect=/app/api-meta')
	      throw new Error('未登录或登录已过期')
	    }
    if (response.status === 403)
      throw new Error(payload.message || '无权限访问（仅管理员可用）')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')

    return payload.data as T
  }

  const fetchRoutes = async () => {
    setLoading(true)
    try {
      const data = await request<RoutesPayload>('/api/meta/routes?includeTraces=1&traceLimit=3', { method: 'GET' })
      const list = Array.isArray(data?.routes) ? data.routes : []
      setRoutes(list)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRoutes()
  }, [])

  const groupOptions = useMemo(() => {
    const values = new Set<string>()
    for (const route of routes) {
      const key = resolveGroupKey(route.path)
      if (key)
        values.add(key)
    }
    return Array.from(values).sort().map(value => ({ label: value, value }))
  }, [routes])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return routes.filter((route) => {
      if (method !== 'ALL' && route.method !== method)
        return false
      if (auth !== 'ALL' && (route.auth || '') !== auth)
        return false
      if (group !== 'ALL') {
        const g = resolveGroupKey(route.path)
        if (g !== group)
          return false
      }
      if (!kw)
        return true
      const combined = `${route.method} ${route.path} ${route.summary || ''} ${route.auth || ''}`.toLowerCase()
      return combined.includes(kw)
    })
  }, [routes, keyword, method, group, auth])

  if (!hydrated) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <div className="text-sm text-gray-500">加载中...</div>
      </div>
    )
  }

  if (currentRole !== 'admin') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">API 查询仅管理员可访问。</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {contextHolder}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">API 查询</div>
          <Button onClick={fetchRoutes} loading={loading}>刷新</Button>
        </div>

        <Space wrap className="mb-3">
          <Select
            value={method}
            onChange={setMethod}
            style={{ width: 140 }}
            options={[
              { label: '全部方法', value: 'ALL' },
              { label: 'GET', value: 'GET' },
              { label: 'POST', value: 'POST' },
              { label: 'PUT', value: 'PUT' },
              { label: 'DELETE', value: 'DELETE' },
            ]}
          />
          <Select
            value={group}
            onChange={setGroup}
            style={{ width: 220 }}
            options={[
              { label: '全部分组', value: 'ALL' },
              ...groupOptions,
            ]}
          />
          <Select
            value={auth}
            onChange={setAuth}
            style={{ width: 160 }}
            options={[
              { label: '全部权限', value: 'ALL' },
              { label: 'public', value: 'public' },
              { label: 'auth', value: 'auth' },
              { label: 'admin', value: 'admin' },
            ]}
          />
          <Input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="搜索：路径/说明/权限"
            style={{ width: 320 }}
            allowClear
          />
        </Space>

        <Table<APIRouteDoc>
          rowKey={(record) => `${record.method} ${record.path}`}
          loading={loading}
          dataSource={filtered}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            { title: '方法', dataIndex: 'method', width: 90 },
            {
              title: '分组',
              key: 'group',
              width: 170,
              render: (_, record) => {
                const key = resolveGroupKey(record.path)
                return key ? <Tag color="default">{key}</Tag> : <span className="text-gray-400">-</span>
              },
            },
            { title: '路径', dataIndex: 'path', width: 320 },
            {
              title: '权限',
              dataIndex: 'auth',
              width: 120,
              render: (auth?: string) => <Tag color={authColor(auth)}>{auth || '-'}</Tag>,
            },
            { title: '说明', dataIndex: 'summary' },
            {
              title: '参数/校验',
              key: 'params',
              width: 320,
              render: (_, record) => {
                const params = Array.isArray(record.params) ? record.params : []
                if (params.length === 0)
                  return <span className="text-gray-400">-</span>
                const display = params.slice(0, 6).map((param) => {
                  const required = param.validation?.required ? '!' : ''
                  const enumHint = Array.isArray(param.validation?.enum) && param.validation?.enum?.length
                    ? ` ∈ {${param.validation?.enum?.join(', ')}}`
                    : ''
                  const minHint = param.validation?.min !== undefined ? ` min=${param.validation?.min}` : ''
                  const maxHint = param.validation?.max !== undefined ? ` max=${param.validation?.max}` : ''
                  return `${param.in}.${param.name}${required}:${param.type}${enumHint}${minHint}${maxHint}`
                })
                const more = params.length > 6 ? ` +${params.length - 6}` : ''
                return <span className="text-xs text-gray-700">{display.join('；')}{more}</span>
              },
            },
            {
              title: '最近请求',
              key: 'traces',
              width: 220,
              render: (_, record) => {
                const traces = Array.isArray(record.lastTraces) ? record.lastTraces : []
                if (!traces.length)
                  return <span className="text-gray-400">-</span>
                const first = traces[0]
                return (
                  <div className="text-xs text-gray-600">
                    <div>{first.statusCode} · {first.durationMs}ms</div>
                    <div className="text-gray-400">{first.timestamp}</div>
                  </div>
                )
              },
            },
          ]}
          expandable={{
            expandedRowRender: (record) => {
              const params = Array.isArray(record.params) ? record.params : []
              const responses = Array.isArray(record.responses) ? record.responses : []
              return (
                <div className="space-y-2 text-sm">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-gray-700">参数</div>
                    {params.length === 0
                      ? <div className="text-gray-400">-</div>
                      : (
                        <div className="grid gap-1">
                          {params.map(param => (
                            <div key={`${param.in}.${param.name}`} className="text-xs text-gray-700">
                              <span className="text-gray-500">{param.in}</span>
                              <span className="mx-1">·</span>
                              <span className="font-mono">{param.name}</span>
                              {param.validation?.required ? <Tag color="red" style={{ marginInlineStart: 8 }}>required</Tag> : null}
                              {Array.isArray(param.validation?.enum) && param.validation?.enum?.length
                                ? <span className="ml-2 text-gray-500">enum: {param.validation?.enum?.join(', ')}</span>
                                : null}
                              {param.validation?.min !== undefined ? <span className="ml-2 text-gray-500">min: {param.validation?.min}</span> : null}
                              {param.validation?.max !== undefined ? <span className="ml-2 text-gray-500">max: {param.validation?.max}</span> : null}
                              {param.validation?.pattern ? <span className="ml-2 text-gray-500">pattern: {param.validation?.pattern}</span> : null}
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-gray-700">响应</div>
                    {responses.length === 0
                      ? <div className="text-gray-400">-</div>
                      : (
                        <div className="grid gap-1">
                          {responses.map((resp) => (
                            <div key={`${resp.httpStatus}-${resp.code}`} className="text-xs text-gray-700">
                              <span className="font-mono">{resp.httpStatus}</span>
                              <span className="mx-1">·</span>
                              <span className="font-mono">{resp.code}</span>
                              {resp.contentType ? <span className="ml-2 text-gray-500">{resp.contentType}</span> : null}
                              {resp.description ? <span className="ml-2 text-gray-500">{resp.description}</span> : null}
                              {resp.dataShape ? <span className="ml-2 text-gray-400">{resp.dataShape}</span> : null}
                              {resp.httpStatus === 200 && resp.example && typeof resp.example === 'object' && resp.example !== null && 'data' in (resp.example as Record<string, unknown>)
                                ? (
                                  <div className="mt-1">
                                    <div className="mb-1 text-[11px] font-semibold text-gray-600">data（200 结果对象）</div>
                                    <pre className="overflow-auto rounded bg-blue-50 p-2 text-[11px] leading-4 text-gray-700">
                                      {JSON.stringify((resp.example as Record<string, unknown>).data, null, 2)}
                                    </pre>
                                  </div>
                                )
                                : null}
                              {resp.example
                                ? (
                                  <pre className="mt-1 overflow-auto rounded bg-gray-50 p-2 text-[11px] leading-4 text-gray-700">
                                    {JSON.stringify(resp.example, null, 2)}
                                  </pre>
                                )
                                : null}
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                </div>
              )
            },
          }}
        />
      </div>
    </div>
  )
}
