import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ fileId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { fileId } = await context.params
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/files/${fileId}/versions`,
  })
}

export async function POST(request: Request, context: RouteContext) {
  const { fileId } = await context.params
  const contentType = request.headers.get('content-type') || ''
  const body = await request.arrayBuffer()
  return proxyToBackend({
    request,
    method: 'POST',
    path: `/api/files/${fileId}/versions`,
    body,
    contentType,
  })
}
