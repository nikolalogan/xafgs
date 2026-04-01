import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'POST',
    path: `/api/workflow/executions/${id}/resume`,
    bodyText,
  })
}
