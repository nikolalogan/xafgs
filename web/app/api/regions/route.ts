import { proxyToBackend } from '@/lib/backend-proxy'

export async function GET(request: Request) {
  const { search } = new URL(request.url)
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/regions${search}`,
  })
}

export async function POST(request: Request) {
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'POST',
    path: '/api/regions',
    bodyText,
  })
}
