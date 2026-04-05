import { proxyToBackend } from '@/lib/backend-proxy'

type Params = { params: Promise<{ regionId: string, economyId: string }> }

export async function PUT(request: Request, { params }: Params) {
  const { regionId, economyId } = await params
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'PUT',
    path: `/api/regions/${regionId}/economies/${economyId}`,
    bodyText,
  })
}

export async function DELETE(request: Request, { params }: Params) {
  const { regionId, economyId } = await params
  return proxyToBackend({
    request,
    method: 'DELETE',
    path: `/api/regions/${regionId}/economies/${economyId}`,
  })
}
