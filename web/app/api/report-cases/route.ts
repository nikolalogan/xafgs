import { proxyToBackend } from '@/lib/backend-proxy'

export async function GET(request: Request) {
  return proxyToBackend({
    request,
    method: 'GET',
    path: '/api/report-cases',
  })
}

export async function POST(request: Request) {
  return proxyToBackend({
    request,
    method: 'POST',
    path: '/api/report-cases',
  })
}
