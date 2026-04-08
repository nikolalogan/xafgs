import { NextResponse } from 'next/server'

const normalizeBaseURL = (value: string) => value.trim().replace(/\/+$/, '')

const resolveBackendBaseURL = () => {
  const raw = process.env.BACKEND_BASE_URL || process.env.NEXT_PUBLIC_BACKEND_BASE_URL || 'http://backend:8080'
  return normalizeBaseURL(raw)
}

type ProxyOptions = {
  method: string
  path: string
  body?: BodyInit | null
  bodyText?: string
  contentType?: string
  request: Request
}

export const proxyToBackend = async (options: ProxyOptions) => {
  const baseURL = resolveBackendBaseURL()
  const url = `${baseURL}${options.path.startsWith('/') ? '' : '/'}${options.path}`

  const headers: Record<string, string> = {}
  const authorization = options.request.headers.get('authorization')
  if (authorization)
    headers.authorization = authorization
  const cookie = options.request.headers.get('cookie')
  if (cookie)
    headers.cookie = cookie
  const requestID = options.request.headers.get('x-request-id')
  if (requestID)
    headers['x-request-id'] = requestID
  const inboundContentType = options.request.headers.get('content-type')
  const contentType = options.contentType || inboundContentType
  if (contentType)
    headers['content-type'] = contentType
  else if (typeof options.bodyText === 'string')
    headers['content-type'] = 'application/json'

  try {
    const requestBody = options.body !== undefined ? options.body : options.bodyText
    const response = await fetch(url, {
      method: options.method,
      headers,
      body: requestBody,
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

export const proxyStreamToBackend = async (options: ProxyOptions) => {
  const baseURL = resolveBackendBaseURL()
  const url = `${baseURL}${options.path.startsWith('/') ? '' : '/'}${options.path}`

  const headers: Record<string, string> = {}
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
    })

    const nextHeaders = new Headers()
    nextHeaders.set('content-type', response.headers.get('content-type') || 'text/event-stream')
    nextHeaders.set('cache-control', response.headers.get('cache-control') || 'no-cache, no-transform')
    nextHeaders.set('connection', response.headers.get('connection') || 'keep-alive')
    nextHeaders.set('x-accel-buffering', 'no')

    return new NextResponse(response.body, {
      status: response.status,
      headers: nextHeaders,
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '后端不可用'
    return NextResponse.json({ message }, { status: 502 })
  }
}
