import { proxyToBackend } from '@/lib/backend-proxy'

type Params = { params: Promise<{ enterpriseId: string }> }

export async function GET(request: Request, { params }: Params) {
  const { enterpriseId } = await params
  return proxyToBackend({
    request,
    method: 'GET',
    path: `/api/enterprises/${enterpriseId}`,
  })
}

export async function PUT(request: Request, { params }: Params) {
  const { enterpriseId } = await params
  const bodyText = await request.text()
  return proxyToBackend({
    request,
    method: 'PUT',
    path: `/api/enterprises/${enterpriseId}`,
    bodyText,
  })
}

export async function DELETE(request: Request, { params }: Params) {
  const { enterpriseId } = await params
  return proxyToBackend({
    request,
    method: 'DELETE',
    path: `/api/enterprises/${enterpriseId}`,
  })
}
