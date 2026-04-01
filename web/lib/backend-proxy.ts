import { NextResponse } from 'next/server'

const normalizeBaseURL = (value: string) => value.trim().replace(/\/+$/, '')

const resolveBackendBaseURL = () => {
  const raw = process.env.BACKEND_BASE_URL || process.env.NEXT_PUBLIC_BACKEND_BASE_URL || 'http://backend:8080'
  return normalizeBaseURL(raw)
}

type ProxyOptions = {
  method: string
  path: string
  bodyText?: string
  request: Request
}

export const proxyToBackend = async (options: ProxyOptions) => {
  const baseURL = resolveBackendBaseURL()
  const url = `${baseURL}${options.path.startsWith('/') ? '' : '/'}${options.path}`

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const authorization = options.request.headers.get('authorization')
  if (authorization)
    headers.authorization = authorization
  const cookie = options.request.headers.get('cookie')
  if (cookie)
    headers.cookie = cookie
  const requestID = options.request.headers.get('x-request-id')
  if (requestID)
    headers['x-request-id'] = requestID

  try {
    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.bodyText,
    })

    const raw = await response.text()
    return new NextResponse(raw, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json',
      },
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '后端不可用'
    return NextResponse.json({ message }, { status: 502 })
  }
}

