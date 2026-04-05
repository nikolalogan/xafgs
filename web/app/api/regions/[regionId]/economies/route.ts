import { proxyToBackend } from '@/lib/backend-proxy'

type Params = { params: Promise<{ regionId: string }> }

export async function GET(request: Request, { params }: Params) {
  const { regionId } = await params
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/regions/${regionId}/economies`,
  })
}

export async function POST(request: Request, { params }: Params) {
  const { regionId } = await params
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'POST',
    path: `/api/regions/${regionId}/economies`,
    bodyText,
  })
}
