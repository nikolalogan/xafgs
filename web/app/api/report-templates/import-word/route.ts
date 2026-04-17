import { proxyToBackend } from '@/lib/backend-proxy'

export async function POST(request: Request) {
  const body = await request.arrayBuffer()
  return proxyToBackend({
    request,
    method: 'POST',
    path: '/api/report-templates/import-word',
    body,
  })
}
