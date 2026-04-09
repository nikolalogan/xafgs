'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Input, Select, Space, Table, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useConsoleRole } from '@/lib/useConsoleRole'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type AdminDivisionDTO = {
  id: number
  code: string
  name: string
  level: number
  indent: number
  parentCode?: string
  parentName?: string
}

type AdminDivisionPageResult = {
  items: AdminDivisionDTO[]
  page: number
  pageSize: number
  total: number
}

type AdminDivisionChainNode = {
  code: string
  name: string
  level: number
}

const levelColorMap: Record<number, string> = {
  1: 'blue',
  2: 'gold',
  3: 'green',
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

export default function AdminDivisionsPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const { role: currentRole, hydrated } = useConsoleRole()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AdminDivisionDTO[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [level, setLevel] = useState<number | undefined>(undefined)
  const [parentCode, setParentCode] = useState('')
  const [lookupCode, setLookupCode] = useState('')
  const [chainLoading, setChainLoading] = useState(false)
  const [parentChain, setParentChain] = useState<AdminDivisionChainNode[]>([])
  const lastQueryRef = useRef('')

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
      router.push('/?redirect=/app/admin-divisions')
      throw new Error('未登录或登录已过期')
    }
    if (response.status === 403)
      throw new Error(payload.message || '无权限访问（仅管理员可用）')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const buildSearch = (targetPage: number, targetPageSize: number) => {
    const search = new URLSearchParams()
    search.set('page', String(targetPage))
    search.set('pageSize', String(targetPageSize))
    if (keyword.trim())
      search.set('keyword', keyword.trim())
    if (typeof level === 'number' && level > 0)
      search.set('level', String(level))
    if (parentCode.trim())
      search.set('parentCode', parentCode.trim())
    return search
  }

  const fetchList = async (targetPage: number, targetPageSize: number) => {
    const search = buildSearch(targetPage, targetPageSize)
    const queryKey = search.toString()
    if (queryKey === lastQueryRef.current)
      return
    lastQueryRef.current = queryKey

    setLoading(true)
    try {
      const data = await request<AdminDivisionPageResult>(`/api/admin-divisions?${queryKey}`, { method: 'GET' })
      setItems(Array.isArray(data?.items) ? data.items : [])
      setTotal(Number(data?.total) || 0)
      setPage(targetPage)
      setPageSize(targetPageSize)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载行政区划列表失败')
    }
    finally {
      setLoading(false)
    }
  }

  const fetchParentChain = async () => {
    const code = lookupCode.trim()
    if (!code) {
      msgApi.warning('请输入编码后再查询父级')
      return
    }
    setChainLoading(true)
    try {
      const data = await request<AdminDivisionChainNode[]>(`/api/admin-divisions/parent-chain?code=${encodeURIComponent(code)}`, { method: 'GET' })
      setParentChain(Array.isArray(data) ? data : [])
      msgApi.success('查询父级链路成功')
    }
    catch (error) {
      setParentChain([])
      msgApi.error(error instanceof Error ? error.message : '查询父级链路失败')
    }
    finally {
      setChainLoading(false)
    }
  }

  useEffect(() => {
    if (!hydrated || currentRole !== 'admin')
      return
    fetchList(1, pageSize)
  }, [hydrated, currentRole])

  const columns: ColumnsType<AdminDivisionDTO> = [
    { title: '行政区划代码', dataIndex: 'code', width: 180 },
    { title: '单位名称', dataIndex: 'name', width: 220 },
    {
      title: '层级',
      dataIndex: 'level',
      width: 120,
      render: (value: number) => <Tag color={levelColorMap[value] || 'default'}>{`L${value}`}</Tag>,
    },
    {
      title: '上一级',
      key: 'parent',
      render: (_, record) => (record.parentCode ? `${record.parentName || '-'}（${record.parentCode}）` : '-'),
    },
  ]

  const chainColumns: ColumnsType<AdminDivisionChainNode> = [
    { title: '编码', dataIndex: 'code', width: 180 },
    { title: '名称', dataIndex: 'name', width: 220 },
    {
      title: '层级',
      dataIndex: 'level',
      width: 100,
      render: (value: number) => <Tag color={levelColorMap[value] || 'default'}>{`L${value}`}</Tag>,
    },
  ]

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
        <div className="mt-2 text-sm text-gray-500">行政区划管理仅管理员可访问。</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {contextHolder}
      <Card
        title="行政区划列表"
        extra={(
          <Space>
            <Button
              onClick={() => {
                setKeyword('')
                setLevel(undefined)
                setParentCode('')
                lastQueryRef.current = ''
                fetchList(1, pageSize)
              }}
            >
              重置
            </Button>
            <Button
              type="primary"
              onClick={() => {
                lastQueryRef.current = ''
                fetchList(1, pageSize)
              }}
            >
              查询
            </Button>
          </Space>
        )}
      >
        <Space wrap className="mb-3">
          <Input
            placeholder="关键词（编码/名称）"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            style={{ width: 260 }}
            allowClear
          />
          <Select<number>
            placeholder="层级"
            style={{ width: 140 }}
            value={level}
            allowClear
            onChange={value => setLevel(value)}
            options={[
              { label: '一级', value: 1 },
              { label: '二级', value: 2 },
              { label: '三级', value: 3 },
            ]}
          />
          <Input
            placeholder="上级编码（parentCode）"
            value={parentCode}
            onChange={event => setParentCode(event.target.value)}
            style={{ width: 220 }}
            allowClear
          />
        </Space>
        <Table<AdminDivisionDTO>
          rowKey="code"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            onChange: (nextPage, nextPageSize) => fetchList(nextPage, nextPageSize),
          }}
        />
      </Card>

      <Card
        title="按编码查询父级链路"
        extra={(
          <Button type="primary" loading={chainLoading} onClick={fetchParentChain}>
            查询父级
          </Button>
        )}
      >
        <Space wrap className="mb-3">
          <Input
            placeholder="请输入行政区划编码"
            value={lookupCode}
            onChange={event => setLookupCode(event.target.value)}
            style={{ width: 320 }}
            allowClear
            onPressEnter={fetchParentChain}
          />
        </Space>
        <Table<AdminDivisionChainNode>
          rowKey="code"
          loading={chainLoading}
          columns={chainColumns}
          dataSource={parentChain}
          pagination={false}
          locale={{ emptyText: '暂无父级链路（顶级或未查询）' }}
        />
      </Card>
    </div>
  )
}

