import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params
  const contentType = request.headers.get('content-type') || ''
  const body = await request.arrayBuffer()
  return proxyToBackend({
    request,
    method: 'POST',
    path: `/api/files/sessions/${sessionId}/content`,
    body,
    contentType,
  })
}
