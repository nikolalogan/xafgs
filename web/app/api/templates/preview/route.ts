import { proxyToBackend } from '@/lib/backend-proxy'

export async function POST(request: Request) {
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'POST',
    path: '/api/templates/preview',
    bodyText,
    contentType: 'application/json',
  })
}
