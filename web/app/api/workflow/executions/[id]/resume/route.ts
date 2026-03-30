import { NextResponse } from 'next/server'
import { getWorkflowRuntime } from '@/lib/workflow-runtime/runtime-factory'

type RouteContext = {
  params: Promise<{ id: string }>
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json() as unknown
    if (!isObject(body))
      return NextResponse.json({ error: '请求体必须是对象' }, { status: 400 })
    if (typeof body.nodeId !== 'string' || !body.nodeId.trim())
      return NextResponse.json({ error: 'nodeId 不能为空' }, { status: 400 })
    if (!isObject(body.input))
      return NextResponse.json({ error: 'input 必须是对象' }, { status: 400 })

    const runtime = getWorkflowRuntime()
    const execution = await runtime.resume({
      executionId: id,
      nodeId: body.nodeId,
      input: body.input,
    })
    return NextResponse.json({ data: execution })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '恢复执行失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
