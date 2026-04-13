import { proxyToBackend } from '@/lib/backend-proxy'

export async function GET(request: Request) {
  return proxyToBackend({
    request,
    method: 'GET',
    path: '/api/debug-feedback',
  })
}

export async function POST(request: Request) {
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'POST',
    path: '/api/debug-feedback',
    bodyText,
  })
}
