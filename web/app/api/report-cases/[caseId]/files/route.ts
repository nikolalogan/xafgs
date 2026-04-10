import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ caseId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const { caseId } = await context.params
  return proxyToBackend({
    request,
    method: 'POST',
    path: `/api/report-cases/${caseId}/files`,
  })
}
