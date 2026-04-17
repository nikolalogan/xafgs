import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ templateId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const { templateId } = await context.params
  return proxyToBackend({
    request,
    method: 'POST',
    path: `/api/report-templates/${templateId}/ai-assist`,
  })
}
