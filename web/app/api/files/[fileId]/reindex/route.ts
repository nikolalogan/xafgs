import { proxyToBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ fileId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const { fileId } = await context.params
  const url = new URL(request.url)
  const versionNo = (url.searchParams.get('versionNo') || '').trim()
  const query = versionNo ? `?versionNo=${encodeURIComponent(versionNo)}` : ''
  return proxyToBackend({
    request,
    method: 'POST',
    path: `/api/files/${fileId}/reindex${query}`,
  })
}

