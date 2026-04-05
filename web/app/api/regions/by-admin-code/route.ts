import { proxyToBackend } from '@/lib/backend-proxy'

export async function GET(request: Request) {
  const { search } = new URL(request.url)
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/regions/by-admin-code${search}`,
  })
}
