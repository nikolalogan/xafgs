'use client'

export type CurrentUserRole = 'admin' | 'user'

export type CurrentUserDTO = {
  id: number
  username: string
  name: string
  role: CurrentUserRole
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

const CURRENT_USER_STORAGE_KEY = 'sxfg_current_user'

export const getAccessToken = () => {
  if (typeof window === 'undefined')
    return ''
  return (window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || '').trim()
}

export const readStoredCurrentUser = () => {
  if (typeof window === 'undefined')
    return null
  try {
    const raw = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY)
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as Partial<CurrentUserDTO>
    if (!parsed || !parsed.id || !parsed.username || !parsed.role)
      return null
    if (parsed.role !== 'admin' && parsed.role !== 'user')
      return null
    return {
      id: Number(parsed.id),
      username: String(parsed.username),
      name: String(parsed.name || parsed.username),
      role: parsed.role,
    } satisfies CurrentUserDTO
  }
  catch {
    return null
  }
}

export const writeStoredCurrentUser = (user: CurrentUserDTO) => {
  if (typeof window === 'undefined')
    return
  window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user))
  window.localStorage.setItem('sxfg_username', user.username)
  window.localStorage.setItem('username', user.username)
  window.localStorage.setItem('sxfg_user_name', user.name || user.username)
  window.localStorage.setItem('user_name', user.name || user.username)
}

export const clearStoredCurrentUser = () => {
  if (typeof window === 'undefined')
    return
  window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY)
  window.localStorage.removeItem('sxfg_username')
  window.localStorage.removeItem('username')
  window.localStorage.removeItem('sxfg_user_name')
  window.localStorage.removeItem('user_name')
}

export const fetchCurrentUser = async () => {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (token)
    headers.Authorization = `Bearer ${token}`

  const response = await fetch('/api/me', {
    method: 'GET',
    headers,
    credentials: 'include',
  })
  const payload = await response.json() as ApiResponse<CurrentUserDTO>

  if (response.status === 401)
    throw new Error('未登录或登录已过期')
  if (!response.ok || !payload.data)
    throw new Error(payload.message || '加载当前用户失败')

  writeStoredCurrentUser(payload.data)
  return payload.data
}
