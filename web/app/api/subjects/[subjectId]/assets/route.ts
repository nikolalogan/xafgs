import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ subjectId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { subjectId } = await context.params
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/subjects/${subjectId}/assets`,
  })
}
