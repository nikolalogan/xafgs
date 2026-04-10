import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname !== '/')
    return NextResponse.next()

  const loginUrl = new URL('/login', request.url)
  const redirectTarget = request.nextUrl.searchParams.get('redirect')

  if (redirectTarget)
    loginUrl.searchParams.set('redirect', redirectTarget)

  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/'],
}
