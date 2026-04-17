import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ caseId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { caseId } = await context.params
  const url = new URL(request.url)
  const consume = url.searchParams.get('consume')
  const query = consume === null ? '' : `?consume=${encodeURIComponent(consume)}`
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/report-cases/${caseId}/generation-context${query}`,
  })
}
