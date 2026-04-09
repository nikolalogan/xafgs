import { proxyToBackend } from '@/lib/backend-proxy'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = url.search || ''
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/workflow/tasks${query}`,
  })
}
