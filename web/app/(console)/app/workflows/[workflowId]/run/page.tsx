'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, message } from 'antd'
import WorkflowRunPage from '@/components/workflow/dify/components/WorkflowRunPage'
import WorkflowRunFrame from '@/components/workflow/module/WorkflowRunFrame'
import { parseDifyWorkflowDSL } from '@/components/workflow/dify/core/dsl'
import type { DifyWorkflowDSL } from '@/components/workflow/dify/core/types'
import { useConsoleRole } from '@/lib/useConsoleRole'

type WorkflowDetailDTO = {
  id: number
  workflowKey: string
  name: string
  description: string
  status: 'active' | 'disabled'
  dsl: Record<string, unknown>
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

export default function WorkflowRunRoutePage() {
  const router = useRouter()
  const params = useParams<{ workflowId: string }>()
  const workflowIDValue = Number(params.workflowId)
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<WorkflowDetailDTO | null>(null)
  const [autoRun, setAutoRun] = useState(true)
  const { role: currentRole, hydrated } = useConsoleRole()

  const parsed = useMemo(() => {
    if (!detail)
      return null
    try {
      return parseDifyWorkflowDSL(detail.dsl as unknown as DifyWorkflowDSL)
    }
    catch {
      return null
    }
  }, [detail])

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    const raw = new URLSearchParams(window.location.search).get('auto')
    if (!raw)
      return
    setAutoRun(!(raw === '0' || raw === 'false'))
  }, [])

  useEffect(() => {
    if (currentRole === 'guest')
      return
    if (!Number.isFinite(workflowIDValue) || workflowIDValue <= 0)
      return

    const run = async () => {
      setLoading(true)
      try {
        const token = getToken()
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (token)
          headers.Authorization = `Bearer ${token}`
	        const response = await fetch(`/api/workflows/${workflowIDValue}`, { method: 'GET', headers, credentials: 'include' })
	        const payload = await response.json() as ApiResponse<WorkflowDetailDTO>
	        if (response.status === 401) {
	          router.push('/?redirect=/app/workflows')
	          return
	        }
        if (response.status === 403)
          throw new Error(payload.message || '无权限访问')
        if (!response.ok || !payload.data)
          throw new Error(payload.message || '加载工作流失败')
        setDetail(payload.data)
      }
      catch (error) {
        msgApi.error(error instanceof Error ? error.message : '加载工作流失败')
      }
      finally {
        setLoading(false)
      }
    }
    run()
  }, [currentRole, msgApi, router, workflowIDValue])

  if (!hydrated) {
    return (
      <div className="space-y-3">
        {contextHolder}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="text-sm text-gray-500">加载中...</div>
        </div>
      </div>
    )
  }

  if (currentRole === 'guest') {
    return (
      <div className="space-y-3">
        {contextHolder}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="text-base font-semibold text-gray-900">无权限访问</div>
          <div className="mt-2 text-sm text-gray-500">请先登录后再运行工作流。</div>
        </div>
      </div>
    )
  }

  if (!Number.isFinite(workflowIDValue) || workflowIDValue <= 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-base font-semibold text-gray-900">参数错误</div>
        <div className="mt-2 text-sm text-gray-500">workflowId 必须为正整数。</div>
      </div>
    )
  }

  return (
    <WorkflowRunFrame
      title={detail?.name || '工作流运行'}
      description="运行态继续使用现有 Dify 工作流执行与 SSE 回放能力，仅统一页面壳层。"
      toolbar={<Button onClick={() => router.push(`/app/workflows/${workflowIDValue}`)}>返回编辑页</Button>}
    >
      {contextHolder}
      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Execution</div>
          <div className="mt-2 text-sm leading-6 text-slate-600">
            运行时数据直接读取当前工作流 DSL，并沿用既有 `/api/workflow/executions` 执行链路。
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</div>
          <div className="mt-2 text-sm text-slate-600">{loading ? '加载中...' : parsed ? '已就绪' : 'DSL 解析失败或为空。'}</div>
        </div>
      </div>
      {parsed && <WorkflowRunPage workflowId={workflowIDValue} nodes={parsed.nodes} edges={parsed.edges} globalVariables={parsed.globalVariables ?? []} workflowParameters={parsed.workflowParameters ?? []} autoRun={autoRun} />}
    </WorkflowRunFrame>
  )
}
