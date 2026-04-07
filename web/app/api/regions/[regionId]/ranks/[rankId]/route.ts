import { proxyToBackend } from '@/lib/backend-proxy'

type Params = { params: Promise<{ regionId: string, rankId: string }> }

export async function PUT(request: Request, { params }: Params) {
  const { regionId, rankId } = await params
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'PUT',
    path: `/api/regions/${regionId}/ranks/${rankId}`,
    bodyText,
  })
}

export async function DELETE(request: Request, { params }: Params) {
  const { regionId, rankId } = await params
  return proxyToBackend({
    request,
    method: 'DELETE',
    path: `/api/regions/${regionId}/ranks/${rankId}`,
  })
}
