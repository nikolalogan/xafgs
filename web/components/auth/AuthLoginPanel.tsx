'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './AuthLoginPanel.module.css'
import { AnimatedCharacters } from './AnimatedCharacters'
import { writeStoredCurrentUser } from '@/lib/current-user'

type LoginResponse = {
  data?: {
    accessToken?: string
    user?: {
      id?: number
      username?: string
      name?: string
      role?: string
    }
  }
  message?: string
}

export type AuthLoginPanelProps = {
  title?: string
  defaultRedirect?: string
  titlePlacement?: 'center' | 'top-left'
  layout?: 'center' | 'split'
}

export default function AuthLoginPanel(props: AuthLoginPanelProps) {
  const router = useRouter()

  const title = props.title || '西安分公司'
  const defaultRedirect = props.defaultRedirect || '/app'
  const titlePlacement = props.titlePlacement || 'center'
  const layout = props.layout || 'center'

  const redirect = useMemo(() => {
    if (typeof window === 'undefined')
      return defaultRedirect
    const params = new URLSearchParams(window.location.search)
    return params.get('redirect') || defaultRedirect
  }, [defaultRedirect])

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
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
      const payload = await response.json() as LoginResponse
      if (!response.ok || !payload.data?.accessToken)
        throw new Error(payload.message || '登录失败')

      window.localStorage.setItem('sxfg_access_token', payload.data.accessToken)
      window.localStorage.setItem('access_token', payload.data.accessToken)
      const role = payload.data.user?.role === 'admin' || payload.data.user?.role === 'user'
        ? payload.data.user.role
        : 'guest'
      window.localStorage.setItem('sxfg_user_role', role)
      window.localStorage.setItem('user_role', role)
      if (payload.data.user && (role === 'admin' || role === 'user')) {
        writeStoredCurrentUser({
          id: Number(payload.data.user.id || 0),
          username: String(payload.data.user.username || username).trim() || username,
          name: String(payload.data.user.name || payload.data.user.username || username).trim() || username,
          role,
        })
      }
      if (typeof window !== 'undefined') {
        if (password === '123456')
          window.sessionStorage.setItem('sxfg_default_password_prompt', '1')
        else
          window.sessionStorage.removeItem('sxfg_default_password_prompt')
      }
      router.replace(redirect)
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '登录失败')
    }
    finally {
      setSubmitting(false)
    }
  }

  const titleClassName = titlePlacement === 'top-left' ? styles.titleTopLeft : styles.title
  const rootClassName = layout === 'split' ? styles.pageSplit : styles.page

  const formEl = (
    <div className={styles.card}>
      <form onSubmit={onSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="username">账号</label>
          <input
            id="username"
            className={styles.input}
            placeholder="请输入账号"
            autoComplete="username"
            value={username}
            onChange={event => setUsername(event.target.value)}
            onFocus={() => setIsTyping(true)}
            onBlur={() => setIsTyping(false)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">密码</label>
          <div className={styles.passwordRow}>
            <input
              id="password"
              className={styles.input}
              type={showPassword ? 'text' : 'password'}
              placeholder="请输入密码"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              onFocus={() => setIsTyping(true)}
              onBlur={() => setIsTyping(false)}
            />
            <button
              type="button"
              className={styles.eyeBtn}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              onClick={() => setShowPassword(prev => !prev)}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M2.1 3.51 3.5 2.1l18.4 18.4-1.41 1.41-2.2-2.2A11.7 11.7 0 0 1 12 21C6.5 21 2.1 16.7.6 12c.6-1.8 1.5-3.4 2.7-4.8L2.1 3.5Zm6.1 6.1 1.7 1.7a2.5 2.5 0 0 0 3.5 3.5l1.7 1.7A4.5 4.5 0 0 1 8.2 9.6Zm3.8-3.1 7.3 7.3c1.1-1 1.9-2.2 2.4-3.5C20.9 7.9 16.7 3.9 12 3.9c-1.3 0-2.6.3-3.8.7l1.6 1.6c.7-.2 1.4-.3 2.2-.3Z"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 5c5.5 0 9.9 4.3 11.4 9-1.5 4.7-5.9 9-11.4 9S2.1 18.7.6 14C2.1 9.3 6.5 5 12 5Zm0 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <button type="submit" disabled={submitting} className={styles.submit}>
          {submitting ? '登录中...' : '账号密码登录'}
        </button>
      </form>
    </div>
  )

  if (layout === 'split') {
    return (
      <div className={rootClassName}>
        <section className={styles.left}>
          <div className={styles.leftContent}>
            <div className={styles.animBox}>
              <AnimatedCharacters
                isTyping={isTyping}
                showPassword={showPassword}
                passwordLength={password.length}
              />
            </div>
          </div>
        </section>

        <section className={styles.right}>
          <div className={styles.wrap}>
            <h1 className={titleClassName}>{title}</h1>
            {formEl}
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className={rootClassName}>
      <div className={styles.wrap}>
        <h1 className={titleClassName}>{title}</h1>
        {formEl}
      </div>
    </div>
  )
}
