import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ caseId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { caseId } = await context.params
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/report-cases/${caseId}`,
  })
}
