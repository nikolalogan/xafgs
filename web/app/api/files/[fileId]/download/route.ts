import { proxyBinaryToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ fileId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { fileId } = await context.params
  const url = new URL(request.url)
  const versionNo = (url.searchParams.get('versionNo') || '').trim()
  const query = versionNo ? `?versionNo=${encodeURIComponent(versionNo)}` : ''
  return proxyBinaryToBackend({
    request,
    method: 'GET',
    path: `/api/files/${fileId}/download${query}`,
  })
}
