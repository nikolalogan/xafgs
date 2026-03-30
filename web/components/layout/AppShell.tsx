'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

type ConsoleRole = 'admin' | 'user' | 'guest'

const menuItems = [
  { key: 'home', label: '控制台', href: '/app', roles: ['admin', 'user', 'guest'] as ConsoleRole[] },
  { key: 'workflow-config', label: '工作流配置', href: '/app/workflows', roles: ['admin', 'user'] as ConsoleRole[] },
  { key: 'workflow', label: '工作流', href: '/app/workflow', roles: ['admin', 'user'] as ConsoleRole[] },
  { key: 'users', label: '用户管理', href: '/app/users', roles: ['admin'] as ConsoleRole[] },
]

const roleLabelMap: Record<ConsoleRole, string> = {
  admin: '管理员',
  user: '普通用户',
  guest: '访客',
}

const getPageTitle = (pathname: string) => {
  if (pathname.startsWith('/app/users'))
    return '用户管理'
  if (pathname.startsWith('/app/workflows'))
    return '工作流配置'
  if (pathname.startsWith('/app/workflow'))
    return '工作流编排'
  if (pathname.startsWith('/app'))
    return '控制台'
  return 'SXFG Console'
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [role, setRole] = useState<ConsoleRole>('guest')
  const pageTitle = getPageTitle(pathname)
  const visibleMenuItems = useMemo(
    () => menuItems.filter(item => item.roles.includes(role)),
    [role],
  )
  const breadcrumbs = useMemo(() => {
    if (pathname.startsWith('/app/users'))
      return ['控制台', '用户管理']
    if (pathname.startsWith('/app/workflows'))
      return ['控制台', '工作流配置']
    if (pathname.startsWith('/app/workflow'))
      return ['控制台', '工作流']
    if (pathname.startsWith('/app'))
      return ['控制台']
    return ['首页']
  }, [pathname])

  const logout = () => {
    window.localStorage.removeItem('sxfg_access_token')
    window.localStorage.removeItem('access_token')
    window.localStorage.removeItem('token')
    window.localStorage.removeItem('sxfg_user_role')
    window.localStorage.removeItem('user_role')
    setRole('guest')
    router.push('/login?redirect=/app/workflow')
  }

  useEffect(() => {
    const syncRole = () => {
      const raw = (window.localStorage.getItem('sxfg_user_role') || window.localStorage.getItem('user_role') || 'guest').toLowerCase()
      if (raw === 'admin' || raw === 'user') {
        setRole(raw)
        return
      }
      setRole('guest')
    }
    syncRole()
    window.addEventListener('storage', syncRole)
    return () => window.removeEventListener('storage', syncRole)
  }, [])

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className={`${collapsed ? 'w-[72px]' : 'w-60'} relative shrink-0 border-r border-gray-200 bg-white transition-all`}>
        <div className="flex h-14 items-center border-b border-gray-200 px-4">
          {!collapsed && <div className="text-sm font-semibold text-gray-900">SXFG Console</div>}
        </div>
        <nav className="space-y-1 p-3">
          {visibleMenuItems.map(item => (
            <Link
              key={item.key}
              href={item.href}
              className={`block rounded px-3 py-2 text-sm transition ${collapsed ? 'text-center' : ''} ${
                pathname === item.href || pathname.startsWith(`${item.href}/`)
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
              title={item.label}
            >
              {collapsed ? item.label.slice(0, 1) : item.label}
            </Link>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setCollapsed(prev => !prev)}
          className="absolute -right-3 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-700"
          title={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {collapsed
              ? <path d="m9 6 6 6-6 6" />
              : <path d="m15 6-6 6 6 6" />}
          </svg>
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900">{pageTitle}</div>
            <div className="truncate text-xs text-gray-500">
              {breadcrumbs.join(' / ')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">{roleLabelMap[role]}</div>
            <button
              type="button"
              onClick={logout}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
            >
              退出登录
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  )
}
