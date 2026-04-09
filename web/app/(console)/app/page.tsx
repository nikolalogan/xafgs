'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from 'antd'

type ConsoleRole = 'admin' | 'user' | 'guest'
type ExecutionStatus = 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled'

type WorkflowExecutionSummary = {
  id: string
  workflowId: number
  workflowName: string
  menuKey: string
  starterUserId: number
  status: ExecutionStatus
  waitingNodeId?: string
  waitingNodeTitle?: string
  error?: string
  createdAt: string
  updatedAt: string
}

type WorkflowTaskPage = {
  items: WorkflowExecutionSummary[]
  page: number
  pageSize: number
  total: number
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

const menuLabelMap: Record<string, string> = {
  reserve: '储备',
  review: '评审',
  postloan: '保后',
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

export default function AppIndexPage() {
  const router = useRouter()
  const [hydrated, setHydrated] = useState(false)
  const [role, setRole] = useState<ConsoleRole>('guest')
  const [loading, setLoading] = useState(false)
  const [todoItems, setTodoItems] = useState<WorkflowExecutionSummary[]>([])
  const [todoTotal, setTodoTotal] = useState(0)

  useEffect(() => {
    const raw = (window.localStorage.getItem('sxfg_user_role') || window.localStorage.getItem('user_role') || 'guest').toLowerCase()
    if (raw === 'admin' || raw === 'user') {
      setRole(raw)
    }
    else {
      setRole('guest')
    }
    setHydrated(true)
  }, [])

  const request = async <T,>(url: string) => {
    const token = getToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token)
      headers.Authorization = `Bearer ${token}`
    const response = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include',
    })
    const payload = await response.json() as ApiResponse<T>
    if (response.status === 401) {
      router.push('/?redirect=/app')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const fetchTodoTasks = async () => {
    setLoading(true)
    try {
      const data = await request<WorkflowTaskPage>('/api/workflow/tasks?status=waiting_input&page=1&pageSize=6')
      const items = Array.isArray(data?.items) ? data.items : []
      setTodoItems(items)
      setTodoTotal(Number(data?.total || 0))
    }
    catch (error) {
      console.error(error instanceof Error ? error.message : '加载待办任务失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!hydrated || role === 'guest')
      return
    fetchTodoTasks()
  }, [hydrated, role])

  const workflowCount = useMemo(() => {
    return new Set(todoItems.map(item => Number(item.workflowId || 0)).filter(id => id > 0)).size
  }, [todoItems])

  const latestUpdatedAt = useMemo(() => {
    if (todoItems.length === 0)
      return '-'
    return todoItems[0]?.updatedAt || '-'
  }, [todoItems])

  const statusView = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-gray-100 p-4">
        <div className="text-xs text-gray-500">待办总数</div>
        <div className="mt-2 text-2xl font-semibold text-gray-900">{todoTotal}</div>
      </div>
      <div className="rounded-xl border border-gray-100 p-4">
        <div className="text-xs text-gray-500">待办流程数</div>
        <div className="mt-2 text-2xl font-semibold text-gray-900">{workflowCount}</div>
      </div>
      <div className="rounded-xl border border-gray-100 p-4">
        <div className="text-xs text-gray-500">最近更新时间</div>
        <div className="mt-2 text-sm font-medium text-gray-900">{latestUpdatedAt}</div>
      </div>
    </div>
  )

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
      <section className="xl:col-span-3 space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-base font-semibold text-gray-900">待办概览</div>
            <Button size="small" onClick={() => router.push('/app/workflow-tasks?status=waiting_input')}>查看全部待办</Button>
          </div>
          {!hydrated || loading
            ? <div className="text-sm text-gray-500">加载中...</div>
            : statusView}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-base font-semibold text-gray-900">我的待办任务</div>
            <Button size="small" onClick={fetchTodoTasks} loading={loading}>刷新</Button>
          </div>
          {!hydrated || loading
            ? <div className="text-sm text-gray-500">加载中...</div>
            : todoItems.length === 0
                ? <div className="text-sm text-gray-500">暂无待办任务</div>
                : (
                    <div className="space-y-3">
                      {todoItems.map(item => (
                        <div key={item.id} className="grid grid-cols-12 gap-3 rounded-xl border border-gray-100 p-4">
                          <div className="col-span-12 md:col-span-3">
                            <div className="text-xs text-gray-500">流程</div>
                            <div className="mt-1 text-sm font-medium text-gray-900">{item.workflowName || '-'}</div>
                          </div>
                          <div className="col-span-12 md:col-span-3">
                            <div className="text-xs text-gray-500">待补充节点</div>
                            <div className="mt-1 text-sm text-gray-900">{item.waitingNodeTitle || item.waitingNodeId || '-'}</div>
                          </div>
                          <div className="col-span-6 md:col-span-2">
                            <div className="text-xs text-gray-500">职能</div>
                            <div className="mt-1 text-sm text-gray-900">{menuLabelMap[item.menuKey] || '-'}</div>
                          </div>
                          <div className="col-span-6 md:col-span-2">
                            <div className="text-xs text-gray-500">状态</div>
                            <div className="mt-1 text-sm text-blue-600">等待输入</div>
                          </div>
                          <div className="col-span-12 md:col-span-2 flex items-end md:justify-end">
                            <Button size="small" type="primary" onClick={() => router.push('/app/workflow-tasks')}>
                              去提交
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
        </div>
      </section>

      <aside className="xl:col-span-1 space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-3 text-sm font-semibold text-gray-900">快捷入口</div>
          <div className="space-y-2">
            <Button block onClick={() => router.push('/app/workflow-tasks?status=waiting_input')}>待办任务</Button>
            <Button block onClick={() => router.push('/app/workflow-tasks')}>任务中心</Button>
            <Button block onClick={() => router.push('/app/workflows')}>工作流配置</Button>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-3 text-sm font-semibold text-gray-900">提示</div>
          <div className="text-xs leading-6 text-gray-500">
            当前首页仅展示 `waiting_input` 待办数据，用于快速回到表单提交节点继续流程。
          </div>
        </div>
      </aside>
    </div>
  )
}
