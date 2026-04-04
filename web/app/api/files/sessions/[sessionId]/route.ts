import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

export async function DELETE(request: Request, context: RouteContext) {
  const { sessionId } = await context.params
  return proxyToBackend({
    request,
    method: 'DELETE',
    path: `/api/files/sessions/${sessionId}`,
  })
}
