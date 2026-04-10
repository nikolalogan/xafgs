import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/workflows/${id}`,
  })
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'PUT',
    path: `/workflows/${id}`,
    bodyText,
  })
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params
  return proxyToBackend({
    request,
    method: 'DELETE',
    path: `/workflows/${id}`,
  })
}
