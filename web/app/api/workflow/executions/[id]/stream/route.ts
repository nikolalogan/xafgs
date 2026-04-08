import { proxyStreamToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params
  return proxyStreamToBackend({
    request,
    method: 'GET',
    path: `/api/workflow/executions/${id}/stream`,
  })
}
