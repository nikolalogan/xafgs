import { NextResponse } from 'next/server'
import { getWorkflowRuntime } from '@/lib/workflow-runtime/runtime-factory'
import { parseWorkflowDSL } from '@/lib/workflow-dsl'
import type { WorkflowDSL } from '@/lib/workflow-types'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export async function POST(request: Request) {
  try {
    const body = await request.json() as unknown
    if (!isObject(body))
      return NextResponse.json({ error: '请求体必须是对象' }, { status: 400 })

    const rawDsl = body.workflowDsl ?? body.dsl
    if (typeof rawDsl !== 'string' && !isObject(rawDsl))
      return NextResponse.json({ error: 'workflowDsl/dsl 必须是 JSON 字符串或对象' }, { status: 400 })
    const workflowDsl = parseWorkflowDSL(rawDsl as string | WorkflowDSL)
    const input = isObject(body.input) ? body.input : {}
    const runtime = getWorkflowRuntime()
    const execution = await runtime.start({ workflowDsl, input })
    return NextResponse.json({ data: execution })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '创建执行失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
