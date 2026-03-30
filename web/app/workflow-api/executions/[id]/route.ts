import { NextResponse } from 'next/server'
import { getWorkflowRuntime } from '@/lib/workflow-runtime/runtime-factory'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_: Request, context: RouteContext) {
  const { id } = await context.params
  const runtime = getWorkflowRuntime()
  const execution = await runtime.get(id)
  if (!execution)
    return NextResponse.json({ error: 'execution 不存在' }, { status: 404 })
  return NextResponse.json({ data: execution })
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const runtime = getWorkflowRuntime()
    const execution = await runtime.cancel(id)
    return NextResponse.json({ data: execution })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '取消执行失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
