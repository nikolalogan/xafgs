import { proxyToBackend } from '@/lib/backend-proxy'

type Context = {
  params: Promise<{ attachmentId: string }>
}

export async function GET(request: Request, context: Context) {
  const { attachmentId } = await context.params
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/debug-feedback/attachments/${attachmentId}`,
  })
}
