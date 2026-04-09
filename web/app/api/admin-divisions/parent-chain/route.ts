import { proxyToBackend } from '@/lib/backend-proxy'

export async function GET(request: Request) {
  const { search } = new URL(request.url)
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/admin-divisions/parent-chain${search}`,
  })
}

