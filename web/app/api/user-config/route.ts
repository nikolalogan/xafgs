import { proxyToBackend } from '@/lib/backend-proxy'

export async function GET(request: Request) {
  return proxyToBackend({
    request,
    method: 'GET',
    path: '/api/user-config',
  })
}

export async function PUT(request: Request) {
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'PUT',
    path: '/api/user-config',
    bodyText,
  })
}

