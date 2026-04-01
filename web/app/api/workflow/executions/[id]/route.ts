import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_: Request, context: RouteContext) {
  const { id } = await context.params
  return proxyToBackend({
    request: _,
    method: 'GET',
    path: `/api/workflow/executions/${id}`,
  })
}

export async function DELETE(_: Request, context: RouteContext) {
  const { id } = await context.params
  return proxyToBackend({
    request: _,
    method: 'DELETE',
    path: `/api/workflow/executions/${id}`,
  })
}
