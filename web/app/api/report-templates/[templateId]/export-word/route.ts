import { proxyBinaryToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ templateId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { templateId } = await context.params
  return proxyBinaryToBackend({
    request,
    method: 'GET',
    path: `/api/report-templates/${templateId}/export-word`,
  })
}
