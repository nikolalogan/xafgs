'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Breadcrumb, Button, Drawer, Grid, Layout, Menu, Modal, Space, Tag, Typography } from 'antd'
import type { MenuProps } from 'antd'
import DebugFeedbackEntry from './DebugFeedbackEntry'
import { clearStoredCurrentUser } from '@/lib/current-user'

type ConsoleRole = 'admin' | 'user' | 'guest'

type MenuItem = {
  key: string
  label: string
  href: string
  roles: ConsoleRole[]
  indent?: boolean
}

type WorkflowMenuKey = '' | 'reserve' | 'review' | 'postloan'

type WorkflowDTO = {
  id: number
  name: string
  menuKey: WorkflowMenuKey
  status: 'active' | 'disabled'
  currentPublishedVersionNo: number
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

const menuItems: MenuItem[] = [
  { key: 'home', label: '控制台', href: '/app', roles: ['admin', 'user', 'guest'] as ConsoleRole[] },
  { key: 'chat', label: 'AI 对话', href: '/app/chat', roles: ['admin'] as ConsoleRole[] },
  { key: 'workflow-tasks', label: '任务中心', href: '/app/workflow-tasks', roles: ['admin', 'user'] as ConsoleRole[] },
  { key: 'workflow-config', label: '工作流配置', href: '/app/workflows', roles: ['admin'] as ConsoleRole[] },
  { key: 'reserve', label: '储备', href: '/app/workflows?menuKey=reserve', roles: ['admin', 'user'] as ConsoleRole[] },
  { key: 'review', label: '评审', href: '/app/workflows?menuKey=review', roles: ['admin'] as ConsoleRole[] },
  { key: 'postloan', label: '保后', href: '/app/workflows?menuKey=postloan', roles: ['admin'] as ConsoleRole[] },
  { key: 'templates', label: '模板配置', href: '/app/templates', roles: ['admin'] as ConsoleRole[] },
  { key: 'report-templates', label: '报告模板', href: '/app/report-templates', roles: ['admin', 'user'] as ConsoleRole[] },
  { key: 'report-cases', label: '报告组装', href: '/app/report-cases', roles: ['admin'] as ConsoleRole[] },
  { key: 'files', label: '文件管理', href: '/app/files', roles: ['admin'] as ConsoleRole[] },
  { key: 'enterprises', label: '企业管理', href: '/app/enterprises', roles: ['admin', 'user'] as ConsoleRole[] },
  { key: 'file-processing', label: '文件处理清单', href: '/app/file-processing', roles: ['admin', 'user'] as ConsoleRole[] },
  { key: 'admin-divisions', label: '行政区划', href: '/app/admin-divisions', roles: ['admin'] as ConsoleRole[] },
  { key: 'system-settings', label: '系统设置', href: '/app/system-settings', roles: ['admin'] as ConsoleRole[] },
  { key: 'user-config', label: '用户配置', href: '/app/user-config', roles: ['admin', 'user'] as ConsoleRole[] },
  { key: 'api-meta', label: 'API 查询', href: '/app/api-meta', roles: ['admin'] as ConsoleRole[] },
  { key: 'users', label: '用户管理', href: '/app/users', roles: ['admin'] as ConsoleRole[] },
]

const roleLabelMap: Record<ConsoleRole, string> = {
  admin: '管理员',
  user: '普通用户',
  guest: '访客',
}

const getWorkflowMenuLabel = (menuKey: string) => {
  if (menuKey === 'reserve')
    return '储备'
  if (menuKey === 'review')
    return '评审'
  if (menuKey === 'postloan')
    return '保后'
  return ''
}

const getPageTitle = (pathname: string, search: string) => {
  if (pathname.startsWith('/app/chat'))
    return 'AI 对话'
  if (pathname.startsWith('/app/workflow-tasks'))
    return '任务中心'
  if (pathname.startsWith('/app/workflows')) {
    const params = new URLSearchParams(search || '')
    const menuKey = params.get('menuKey') || ''
    const menuLabel = getWorkflowMenuLabel(menuKey)
    if (menuLabel)
      return menuLabel
  }
  if (pathname.startsWith('/app/users'))
    return '用户管理'
  if (pathname.startsWith('/app/templates'))
    return '模板配置'
  if (pathname.startsWith('/app/report-templates'))
    return '报告模板'
  if (pathname.startsWith('/app/report-cases'))
    return '报告组装'
  if (pathname.startsWith('/app/files'))
    return '文件管理'
  if (pathname.startsWith('/app/file-processing'))
    return '文件处理清单'
  if (pathname.startsWith('/app/enterprises') || pathname.startsWith('/app/enterprise-projects'))
    return '企业管理'
  if (pathname.startsWith('/app/admin-divisions'))
    return '行政区划'
  if (pathname.startsWith('/app/system-settings'))
    return '系统设置'
  if (pathname.startsWith('/app/user-config'))
    return '用户配置'
  if (pathname.startsWith('/app/api-meta'))
    return 'API 查询'
  if (pathname.startsWith('/app/debug-feedback'))
    return 'Debug 列表'
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
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [openKeys, setOpenKeys] = useState<string[]>([])
  const [role, setRole] = useState<ConsoleRole>('guest')
  const [workflows, setWorkflows] = useState<WorkflowDTO[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    setSearch(window.location.search || '')
  }, [pathname])

  const pageTitle = getPageTitle(pathname, search)
  const visibleMenuItems = useMemo(() => {
    const base = menuItems.filter(item => item.roles.includes(role))
    if (role === 'guest')
      return base

    const safeWorkflows = Array.isArray(workflows) ? workflows : []
    const activeWorkflows = safeWorkflows.filter(w => w && w.status === 'active' && Number(w.currentPublishedVersionNo) > 0)
    const childrenByKey: Record<Exclude<WorkflowMenuKey, ''>, MenuItem[]> = {
      reserve: [],
      review: [],
      postloan: [],
    }
    for (const workflow of activeWorkflows) {
      if (workflow.menuKey !== 'reserve' && workflow.menuKey !== 'review' && workflow.menuKey !== 'postloan')
        continue
      childrenByKey[workflow.menuKey].push({
        key: `workflow-run-${workflow.id}`,
        label: `· ${workflow.name}`,
        href: `/app/workflows/${workflow.id}/run?auto=1`,
        roles: ['admin', 'user'],
        indent: true,
      })
    }

    const out: MenuItem[] = []
    for (const item of base) {
      out.push(item)
      if (item.key === 'reserve')
        out.push(...childrenByKey.reserve)
      if (item.key === 'review')
        out.push(...childrenByKey.review)
      if (item.key === 'postloan')
        out.push(...childrenByKey.postloan)
    }
    return out
  }, [role, workflows])
  const breadcrumbs = useMemo(() => {
    if (pathname.startsWith('/app/chat'))
      return ['控制台', 'AI 对话']
    if (pathname.startsWith('/app/workflow-tasks'))
      return ['控制台', '任务中心']
    if (pathname.startsWith('/app/workflows')) {
      const params = new URLSearchParams(search || '')
      const menuKey = params.get('menuKey') || ''
      const menuLabel = getWorkflowMenuLabel(menuKey)
      if (menuLabel)
        return ['控制台', menuLabel]
    }
    if (pathname.startsWith('/app/users'))
      return ['控制台', '用户管理']
    if (pathname.startsWith('/app/templates'))
      return ['控制台', '模板配置']
    if (pathname.startsWith('/app/report-templates'))
      return ['控制台', '报告模板']
    if (pathname.startsWith('/app/report-cases'))
      return ['控制台', '报告组装']
    if (pathname.startsWith('/app/files'))
      return ['控制台', '文件管理']
    if (pathname.startsWith('/app/file-processing'))
      return ['控制台', '文件处理清单']
    if (pathname.startsWith('/app/enterprises') || pathname.startsWith('/app/enterprise-projects'))
      return ['控制台', '企业管理']
    if (pathname.startsWith('/app/admin-divisions'))
      return ['控制台', '行政区划']
    if (pathname.startsWith('/app/system-settings'))
      return ['控制台', '系统设置']
    if (pathname.startsWith('/app/user-config'))
      return ['控制台', '用户配置']
    if (pathname.startsWith('/app/api-meta'))
      return ['控制台', 'API 查询']
    if (pathname.startsWith('/app/debug-feedback'))
      return ['控制台', 'Debug 列表']
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
    clearStoredCurrentUser()
    setRole('guest')
    router.push('/login?redirect=/app')
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

  useEffect(() => {
    if (role === 'guest') {
      setWorkflows([])
      return
    }

    const token = (window.localStorage.getItem('sxfg_access_token')
      || window.localStorage.getItem('access_token')
      || window.localStorage.getItem('token')
      || '').trim()
    if (!token) {
      setWorkflows([])
      return
    }

    const run = async () => {
      try {
        const response = await fetch('/api/workflows', {
          method: 'GET',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
        })
        const payload = await response.json() as ApiResponse<WorkflowDTO[]>
        if (!response.ok || !Array.isArray(payload.data)) {
          setWorkflows([])
          return
        }
        setWorkflows(payload.data)
      }
      catch {
        setWorkflows([])
      }
    }
    run()
  }, [role])

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    if (role !== 'admin' && role !== 'user')
      return
    if (window.sessionStorage.getItem('sxfg_default_password_prompt') !== '1')
      return

    window.sessionStorage.removeItem('sxfg_default_password_prompt')
    Modal.confirm({
      title: '请尽快修改默认密码',
      content: '当前账号仍在使用默认密码 123456，建议立即前往用户配置修改密码。',
      okText: '去修改',
      cancelText: '稍后再说',
      onOk: () => router.push('/app/user-config#change-password'),
    })
  }, [role, router])

  const workflowChildren = useMemo(() => {
    const safeWorkflows = Array.isArray(workflows) ? workflows : []
    const activeWorkflows = safeWorkflows.filter(w => w && w.status === 'active' && Number(w.currentPublishedVersionNo) > 0)
    const childrenByKey: Record<Exclude<WorkflowMenuKey, ''>, Array<{ id: number; name: string }>> = {
      reserve: [],
      review: [],
      postloan: [],
    }
    for (const workflow of activeWorkflows) {
      if (workflow.menuKey !== 'reserve' && workflow.menuKey !== 'review' && workflow.menuKey !== 'postloan')
        continue
      childrenByKey[workflow.menuKey].push({ id: workflow.id, name: workflow.name })
    }
    return childrenByKey
  }, [workflows])

  const globalConfigKeys = useMemo(() => ([
    'chat',
    'workflow-config',
    'templates',
    'report-templates',
    'admin-divisions',
    'system-settings',
    'api-meta',
    'users',
    'files',
    'report-cases',
  ]), [])

    const menuTree = useMemo(() => {
      const items: MenuProps['items'] = []
      const pushIfVisible = (key: string) => {
        const item = visibleMenuItems.find(entry => entry.key === key)
        if (!item)
          return
        items.push({ key: item.key, label: item.label })
      }

      pushIfVisible('home')
      pushIfVisible('workflow-tasks')

    if (role === 'admin' || role === 'user') {
      const buildSubMenu = (menuKey: Exclude<WorkflowMenuKey, ''>, title: string) => {
        const children: MenuProps['items'] = [
          ...(workflowChildren[menuKey] ?? []).map(w => ({
            key: `workflow-run-${w.id}`,
            label: w.name,
          })),
        ]
        return { key: `${menuKey}-submenu`, label: title, children }
      }
      items.push(buildSubMenu('reserve', '储备'))
      if (role === 'admin') {
        items.push(buildSubMenu('review', '评审'))
        items.push(buildSubMenu('postloan', '保后'))
      }
    }

    const globalConfigChildren: NonNullable<MenuProps['items']> = []
    for (const key of globalConfigKeys) {
      const item = visibleMenuItems.find(entry => entry.key === key)
      if (!item)
        continue
      globalConfigChildren.push({ key: item.key, label: item.label })
    }
    if (globalConfigChildren.length > 0) {
      items.push({
        key: 'global-config-submenu',
        label: '全局配置',
        children: globalConfigChildren,
      })
    }

    pushIfVisible('enterprises')
    pushIfVisible('file-processing')
    pushIfVisible('user-config')

    return items
  }, [globalConfigKeys, role, visibleMenuItems, workflowChildren])

  const selectedMenuKeys = useMemo(() => {
    if (pathname === '/app')
      return ['home']
    if (pathname.startsWith('/app/templates'))
      return ['templates']
    if (pathname.startsWith('/app/report-templates'))
      return ['report-templates']
    if (pathname.startsWith('/app/report-cases'))
      return ['report-cases']
    if (pathname.startsWith('/app/files'))
      return ['files']
    if (pathname.startsWith('/app/file-processing'))
      return ['file-processing']
    if (pathname.startsWith('/app/workflow-tasks'))
      return ['workflow-tasks']
    if (pathname.startsWith('/app/enterprises') || pathname.startsWith('/app/enterprise-projects'))
      return ['enterprises']
    if (pathname.startsWith('/app/admin-divisions'))
      return ['admin-divisions']
    if (pathname.startsWith('/app/system-settings'))
      return ['system-settings']
    if (pathname.startsWith('/app/user-config'))
      return ['user-config']
    if (pathname.startsWith('/app/api-meta'))
      return ['api-meta']
    if (pathname.startsWith('/app/users'))
      return ['users']
    if (pathname.startsWith('/app/workflows/')) {
      const match = pathname.match(/^\/app\/workflows\/(\d+)\/run$/)
      if (match?.[1])
        return [`workflow-run-${match[1]}`]
      return ['workflow-config']
    }
    if (pathname.startsWith('/app/workflows')) {
      const params = new URLSearchParams(search || '')
      const menuKey = params.get('menuKey') || ''
      if (menuKey === 'reserve' || menuKey === 'review' || menuKey === 'postloan')
        return [menuKey]
      return ['workflow-config']
    }
    return []
  }, [pathname, search])

  useEffect(() => {
    const selected = selectedMenuKeys[0] || ''
    if (selected === 'reserve' || selected === 'review' || selected === 'postloan') {
      setOpenKeys([`${selected}-submenu`])
      return
    }
    if (globalConfigKeys.includes(selected)) {
      setOpenKeys(['global-config-submenu'])
      return
    }
    if (selected.startsWith('workflow-run-')) {
      const id = Number(selected.slice('workflow-run-'.length))
      const matched = workflows.find(w => Number(w.id) === id)
      if (matched?.menuKey === 'reserve' || matched?.menuKey === 'review' || matched?.menuKey === 'postloan') {
        setOpenKeys([`${matched.menuKey}-submenu`])
        return
      }
    }
  }, [globalConfigKeys, selectedMenuKeys, workflows])

  const handleMenuClick: MenuProps['onClick'] = (info) => {
    const key = String(info.key)
    if (key === 'home')
      router.push('/app')
    else if (key === 'chat')
      router.push('/app/chat')
    else if (key === 'workflow-tasks')
      router.push('/app/workflow-tasks')
    else if (key === 'workflow-config')
      router.push('/app/workflows')
    else if (key === 'templates')
      router.push('/app/templates')
    else if (key === 'report-templates')
      router.push('/app/report-templates')
    else if (key === 'report-cases')
      router.push('/app/report-cases')
    else if (key === 'files')
      router.push('/app/files')
    else if (key === 'file-processing')
      router.push('/app/file-processing')
    else if (key === 'enterprises')
      router.push('/app/enterprises')
    else if (key === 'admin-divisions')
      router.push('/app/admin-divisions')
    else if (key === 'system-settings')
      router.push('/app/system-settings')
    else if (key === 'user-config')
      router.push('/app/user-config')
    else if (key === 'api-meta')
      router.push('/app/api-meta')
    else if (key === 'users')
      router.push('/app/users')
    else if (key === 'reserve' || key === 'review' || key === 'postloan')
      router.push(`/app/workflows?menuKey=${key}`)
    else if (key.startsWith('workflow-run-')) {
      const id = Number(key.slice('workflow-run-'.length))
      if (Number.isFinite(id) && id > 0)
        router.push(`/app/workflows/${id}/run?auto=1`)
    }

    if (isMobile)
      setDrawerOpen(false)
  }

  const sideMenu = (
    <Menu
      mode="inline"
      items={menuTree}
      selectedKeys={selectedMenuKeys}
      openKeys={openKeys}
      onOpenChange={(next) => setOpenKeys(next.map(String))}
      onClick={handleMenuClick}
      style={{ borderInlineEnd: 'none' }}
    />
  )

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Layout.Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={240}
          theme="light"
          style={{ borderInlineEnd: '1px solid #f0f0f0' }}
        >
          <div style={{ height: 56, display: 'flex', alignItems: 'center', paddingInline: 16, borderBottom: '1px solid #f0f0f0' }}>
            <Typography.Text strong ellipsis style={{ width: '100%' }}>
              系统
            </Typography.Text>
          </div>
          <div style={{ padding: 8 }}>
            {sideMenu}
          </div>
        </Layout.Sider>
      )}

      {isMobile && (
        <Drawer
          open={drawerOpen}
          placement="left"
          size={280}
          closable={false}
          onClose={() => setDrawerOpen(false)}
          styles={{ body: { padding: 8 } }}
        >
          <div style={{ height: 56, display: 'flex', alignItems: 'center', paddingInline: 8 }}>
            <Typography.Text strong>SXFG Console</Typography.Text>
          </div>
          {sideMenu}
        </Drawer>
      )}

      <Layout>
        <Layout.Header style={{ paddingInline: isMobile ? 12 : 16, background: '#fff', borderBottom: '1px solid #f0f0f0', height: 56 }}>
          <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Space size={10} style={{ minWidth: 0 }}>
              {isMobile && (
                <Button size="small" onClick={() => setDrawerOpen(true)}>
                  菜单
                </Button>
              )}
              <div style={{ minWidth: 0 }}>
                <Typography.Text strong ellipsis style={{ display: 'block', maxWidth: isMobile ? 200 : 420 }}>
                  {pageTitle}
                </Typography.Text>
                {!isMobile && (
                  <Breadcrumb
                    items={breadcrumbs.map(item => ({ title: item }))}
                    style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}
                  />
                )}
              </div>
            </Space>

            <Space size={8}>
              <DebugFeedbackEntry />
              <Tag color={role === 'admin' ? 'blue' : role === 'user' ? 'default' : 'orange'}>
                {roleLabelMap[role]}
              </Tag>
              <Button size="small" onClick={logout}>
                退出登录
              </Button>
            </Space>
          </div>
        </Layout.Header>

        <Layout.Content style={{ padding: isMobile ? 12 : 16 }}>
          {isMobile && (
            <div style={{ marginBottom: 8 }}>
              <Breadcrumb items={breadcrumbs.map(item => ({ title: item }))} style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }} />
            </div>
          )}
          <div style={{ width: '100%' }}>{children}</div>
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
