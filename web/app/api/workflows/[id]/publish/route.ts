import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params
  return proxyToBackend({
    request,
    method: 'POST',
    path: `/workflows/${id}/publish`,
  })
}
