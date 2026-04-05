import { proxyToBackend } from '@/lib/backend-proxy'

type Params = { params: Promise<{ regionId: string }> }

export async function GET(request: Request, { params }: Params) {
  const { regionId } = await params
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/regions/${regionId}`,
  })
}

export async function PUT(request: Request, { params }: Params) {
  const { regionId } = await params
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'PUT',
    path: `/api/regions/${regionId}`,
    bodyText,
  })
}

export async function DELETE(request: Request, { params }: Params) {
  const { regionId } = await params
  return proxyToBackend({
    request,
    method: 'DELETE',
    path: `/api/regions/${regionId}`,
  })
}
