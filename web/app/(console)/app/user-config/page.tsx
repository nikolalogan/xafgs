'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Divider, Form, Input, message } from 'antd'
import { useConsoleRole } from '@/lib/useConsoleRole'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type UserConfigDTO = {
  userId: number
  warningAccount: string
  warningPassword: string
  aiBaseUrl: string
  aiApiKey: string
  searchServiceBaseUrl: string
  searchServiceApiKey: string
  updatedAt?: string
}

const defaultAIBaseUrl = 'https://api.siliconflow.cn'
const defaultAIApiKey = 'sk-dninauetsqzfirndyjutohuztdwhevpwfvhmejahsunzcxxn'

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const fieldIds = {
  warningAccount: 'warningAccount',
  warningPassword: 'warningPassword',
  aiBaseUrl: 'aiBaseUrl',
  aiApiKey: 'aiApiKey',
  searchServiceBaseUrl: 'searchServiceBaseUrl',
  searchServiceApiKey: 'searchServiceApiKey',
  changePassword: 'changePassword',
} as const

type FieldId = typeof fieldIds[keyof typeof fieldIds]

const normalizeHashToFieldId = (rawHash: string): FieldId | null => {
  const trimmed = String(rawHash || '').replace(/^#/, '').trim()
  if (!trimmed)
    return null
  const normalized = trimmed.replace(/[-_]/g, '').toLowerCase()
  if (normalized === 'warningaccount' || normalized === 'yjtwaccount' || normalized === 'yujingtongaccount')
    return fieldIds.warningAccount
  if (normalized === 'warningpassword' || normalized === 'yjtwpassword' || normalized === 'yujingtongpassword')
    return fieldIds.warningPassword
  if (normalized === 'aibaseurl' || normalized === 'aiserviceurl' || normalized === 'aiproviderurl')
    return fieldIds.aiBaseUrl
  if (normalized === 'aiapikey' || normalized === 'apikey')
    return fieldIds.aiApiKey
  if (normalized === 'searchservicebaseurl' || normalized === 'searchbaseurl' || normalized === 'searchproviderurl' || normalized === 'searchaibaseurl' || normalized === 'searchaiserviceurl')
    return fieldIds.searchServiceBaseUrl
  if (normalized === 'searchserviceapikey' || normalized === 'searchapikey' || normalized === 'searchaiapikey')
    return fieldIds.searchServiceApiKey
  if (normalized === 'changepassword' || normalized === 'password')
    return fieldIds.changePassword
  return null
}

export default function UserConfigPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const { role: currentRole, hydrated } = useConsoleRole()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [highlight, setHighlight] = useState<FieldId | ''>('')
  const highlightTimer = useRef<number | null>(null)
  const [form] = Form.useForm<UserConfigDTO>()
  const [passwordForm] = Form.useForm<{ currentPassword: string, newPassword: string, confirmNewPassword: string }>()

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (init?.headers)
      Object.assign(headers, init.headers as Record<string, string>)
    if (token)
      headers.Authorization = `Bearer ${token}`

    const response = await fetch(url, {
      ...init,
      headers,
      credentials: 'include',
    })
    const payload = await response.json() as ApiResponse<T>
    if (response.status === 401) {
      router.push('/?redirect=/app/user-config')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const fetchConfig = async () => {
    setLoading(true)
    try {
      const data = await request<UserConfigDTO>('/api/user-config', { method: 'GET' })
      form.setFieldsValue({
        userId: Number(data?.userId || 0),
        warningAccount: data?.warningAccount || '',
        warningPassword: data?.warningPassword || '',
        aiBaseUrl: data?.aiBaseUrl || defaultAIBaseUrl,
        aiApiKey: data?.aiApiKey || defaultAIApiKey,
        searchServiceBaseUrl: data?.searchServiceBaseUrl || '',
        searchServiceApiKey: data?.searchServiceApiKey || '',
      })
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载失败')
    }
    finally {
      setLoading(false)
    }
  }

  const triggerHighlight = (fieldId: FieldId) => {
    if (highlightTimer.current)
      window.clearTimeout(highlightTimer.current)
    setHighlight(fieldId)
    highlightTimer.current = window.setTimeout(() => {
      setHighlight('')
      highlightTimer.current = null
    }, 1300)
  }

  const applyHash = () => {
    if (typeof window === 'undefined')
      return
    const id = normalizeHashToFieldId(window.location.hash)
    if (!id)
      return
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      triggerHighlight(id)
      window.setTimeout(() => {
        const target = document.getElementById(id)
        if (target && 'focus' in target)
          (target as unknown as { focus: () => void }).focus()
      }, 250)
    }
  }

  useEffect(() => {
    fetchConfig()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    applyHash()
    const onHashChange = () => applyHash()
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const canAccess = useMemo(() => currentRole === 'admin' || currentRole === 'user', [currentRole])

  const save = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await request<UserConfigDTO>('/api/user-config', {
        method: 'PUT',
        body: JSON.stringify({
          warningAccount: values.warningAccount || '',
          warningPassword: values.warningPassword || '',
          aiBaseUrl: values.aiBaseUrl || '',
          aiApiKey: values.aiApiKey || '',
          searchServiceBaseUrl: values.searchServiceBaseUrl || '',
          searchServiceApiKey: values.searchServiceApiKey || '',
        }),
      })
      msgApi.success('保存成功')
      fetchConfig()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '保存失败')
    }
    finally {
      setSaving(false)
    }
  }

  const changePassword = async () => {
    const values = await passwordForm.validateFields()
    setChangingPassword(true)
    try {
      await request<boolean>('/api/users/me/password', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: values.currentPassword || '',
          newPassword: values.newPassword || '',
        }),
      })
      msgApi.success('修改密码成功')
      passwordForm.resetFields()
      if (typeof window !== 'undefined')
        window.sessionStorage.removeItem('sxfg_default_password_prompt')
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '修改密码失败')
    }
    finally {
      setChangingPassword(false)
    }
  }

  if (!hydrated) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <div className="text-sm text-gray-500">加载中...</div>
      </div>
    )
  }

  if (!canAccess) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">请先登录后再访问用户配置。</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {contextHolder}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">用户配置</div>
          <Button type="primary" onClick={save} loading={saving} disabled={loading}>保存</Button>
        </div>

        <Form<UserConfigDTO>
          form={form}
          layout="vertical"
          disabled={loading}
          initialValues={{
            warningAccount: '',
            warningPassword: '',
            aiBaseUrl: defaultAIBaseUrl,
            aiApiKey: defaultAIApiKey,
            searchServiceBaseUrl: '',
            searchServiceApiKey: '',
          }}
        >
          <Form.Item label="预警通账号" name="warningAccount">
            <Input
              id={fieldIds.warningAccount}
              className={highlight === fieldIds.warningAccount ? 'blinkTwice' : ''}
              placeholder="请输入预警通账号"
              autoComplete="off"
            />
          </Form.Item>
          <Form.Item label="预警通密码" name="warningPassword">
            <Input.Password
              id={fieldIds.warningPassword}
              className={highlight === fieldIds.warningPassword ? 'blinkTwice' : ''}
              placeholder="请输入预警通密码"
              autoComplete="new-password"
              visibilityToggle={false}
            />
          </Form.Item>
          <Form.Item label="AI 服务商地址" name="aiBaseUrl">
            <Input
              id={fieldIds.aiBaseUrl}
              className={highlight === fieldIds.aiBaseUrl ? 'blinkTwice' : ''}
              placeholder="例如 http://ai-service:8080"
              autoComplete="off"
            />
          </Form.Item>
          <Form.Item label="AI APIKey" name="aiApiKey">
            <Input.Password
              id={fieldIds.aiApiKey}
              className={highlight === fieldIds.aiApiKey ? 'blinkTwice' : ''}
              placeholder="请输入 APIKey"
              autoComplete="new-password"
              visibilityToggle={false}
            />
          </Form.Item>
          <Form.Item label="搜索服务地址（可选）" name="searchServiceBaseUrl">
            <Input
              id={fieldIds.searchServiceBaseUrl}
              className={highlight === fieldIds.searchServiceBaseUrl ? 'blinkTwice' : ''}
              placeholder="默认留空使用系统服务地址"
              autoComplete="off"
            />
          </Form.Item>
          <Form.Item label="搜索服务 APIKey" name="searchServiceApiKey">
            <Input.Password
              id={fieldIds.searchServiceApiKey}
              className={highlight === fieldIds.searchServiceApiKey ? 'blinkTwice' : ''}
              placeholder="请输入搜索服务 APIKey（例如 Tavily）"
              autoComplete="new-password"
              visibilityToggle={false}
            />
          </Form.Item>
        </Form>

        <Divider />

        <div id={fieldIds.changePassword} className="scroll-mt-24">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">修改密码</div>
            <Button type="primary" onClick={changePassword} loading={changingPassword}>修改密码</Button>
          </div>
          <Form<{ currentPassword: string, newPassword: string, confirmNewPassword: string }>
            form={passwordForm}
            layout="vertical"
            disabled={changingPassword}
            initialValues={{
              currentPassword: '',
              newPassword: '',
              confirmNewPassword: '',
            }}
          >
            <Form.Item
              label="当前密码"
              name="currentPassword"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password
                className={highlight === fieldIds.changePassword ? 'blinkTwice' : ''}
                placeholder="请输入当前密码"
                autoComplete="current-password"
                visibilityToggle={false}
              />
            </Form.Item>
            <Form.Item
              label="新密码"
              name="newPassword"
              rules={[{ required: true, message: '请输入新密码' }]}
            >
              <Input.Password
                className={highlight === fieldIds.changePassword ? 'blinkTwice' : ''}
                placeholder="请输入新密码"
                autoComplete="new-password"
                visibilityToggle={false}
              />
            </Form.Item>
            <Form.Item
              label="确认新密码"
              name="confirmNewPassword"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value)
                      return Promise.resolve()
                    return Promise.reject(new Error('两次输入的新密码不一致'))
                  },
                }),
              ]}
            >
              <Input.Password
                className={highlight === fieldIds.changePassword ? 'blinkTwice' : ''}
                placeholder="请再次输入新密码"
                autoComplete="new-password"
                visibilityToggle={false}
              />
            </Form.Item>
          </Form>
        </div>
      </div>

      <style jsx global>{`
        @keyframes blink {
          0% { box-shadow: 0 0 0 rgba(59, 130, 246, 0); border-color: rgba(209, 213, 219, 1); }
          50% { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0.18); border-color: rgba(59, 130, 246, 0.9); }
          100% { box-shadow: 0 0 0 rgba(59, 130, 246, 0); border-color: rgba(209, 213, 219, 1); }
        }
        .blinkTwice.ant-input,
        .blinkTwice .ant-input,
        .blinkTwice.ant-input-affix-wrapper {
          animation: blink 0.55s ease-in-out 0s 2;
        }
      `}</style>
    </div>
  )
}
