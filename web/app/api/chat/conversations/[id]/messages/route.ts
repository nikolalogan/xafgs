import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params
  const url = new URL(request.url)
  const limit = url.searchParams.get('limit') || ''
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : ''
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/chat/conversations/${id}/messages${qs}`,
  })
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'POST',
    path: `/api/chat/conversations/${id}/messages`,
    bodyText,
  })
}
