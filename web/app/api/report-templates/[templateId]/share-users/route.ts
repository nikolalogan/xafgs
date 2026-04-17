import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ templateId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { templateId } = await context.params
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/report-templates/${templateId}/share-users`,
  })
}

export async function PUT(request: Request, context: RouteContext) {
  const { templateId } = await context.params
  return proxyToBackend({
    request,
    method: 'PUT',
    path: `/api/report-templates/${templateId}/share-users`,
  })
}
