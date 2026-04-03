import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params
  return proxyToBackend({
    request,
    method: 'DELETE',
    path: `/api/chat/conversations/${id}`,
  })
}
