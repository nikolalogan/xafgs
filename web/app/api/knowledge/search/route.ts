import { proxyToBackend } from '@/lib/backend-proxy'

export async function POST(request: Request) {
  const body = await request.text()
  return proxyToBackend({
    request,
    method: 'POST',
    path: '/api/knowledge/search',
    bodyText: body,
    contentType: 'application/json',
  })
}

