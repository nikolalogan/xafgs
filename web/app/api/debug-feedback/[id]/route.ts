import { proxyToBackend } from '@/lib/backend-proxy'

type Context = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'PATCH',
    path: `/api/debug-feedback/${id}`,
    bodyText,
  })
}
