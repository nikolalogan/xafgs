import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ fileId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { fileId } = await context.params
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/files/${fileId}`,
  })
}
