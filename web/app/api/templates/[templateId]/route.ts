import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ templateId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { templateId } = await context.params
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/templates/${templateId}`,
  })
}
