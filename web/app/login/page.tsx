'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [redirect] = useState(() => {
    if (typeof window === 'undefined')
      return '/app/workflow'
    const params = new URLSearchParams(window.location.search)
    return params.get('redirect') || '/app/workflow'
  })

  const [username, setUsername] = useState('developer')
  const [password, setPassword] = useState('123456')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      })
      const payload = await response.json() as {
        data?: { accessToken?: string; user?: { role?: string } }
        message?: string
      }
      if (!response.ok || !payload.data?.accessToken)
        throw new Error(payload.message || '登录失败')

      window.localStorage.setItem('sxfg_access_token', payload.data.accessToken)
      window.localStorage.setItem('access_token', payload.data.accessToken)
      const role = payload.data.user?.role === 'admin' || payload.data.user?.role === 'user'
        ? payload.data.user.role
        : 'guest'
      window.localStorage.setItem('sxfg_user_role', role)
      window.localStorage.setItem('user_role', role)
      router.replace(redirect)
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '登录失败')
    }
    finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md items-center px-4">
      <form onSubmit={onSubmit} className="w-full space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">登录</h1>
        <p className="text-xs text-gray-500">请先登录，再继续运行工作流。</p>
        <input
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          placeholder="用户名"
          value={username}
          onChange={event => setUsername(event.target.value)}
        />
        <input
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          type="password"
          placeholder="密码"
          value={password}
          onChange={event => setPassword(event.target.value)}
        />
        {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {submitting ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  )
}
