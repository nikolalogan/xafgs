'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd'

type UserRole = 'admin' | 'user'

type UserDTO = {
  id: number
  username: string
  name: string
  role: UserRole
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

const roleColorMap: Record<UserRole, string> = {
  admin: 'blue',
  user: 'default',
}

const roleLabelMap: Record<UserRole, string> = {
  admin: '管理员',
  user: '普通用户',
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

export default function UsersPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<UserDTO[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingUser, setEditingUser] = useState<UserDTO | null>(null)
  const [form] = Form.useForm()

  const currentRole = useMemo(() => {
    if (typeof window === 'undefined')
      return 'guest'
    return (window.localStorage.getItem('sxfg_user_role') || window.localStorage.getItem('user_role') || 'guest') as 'admin' | 'user' | 'guest'
  }, [])

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
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
      router.push('/login?redirect=/app/users')
      throw new Error('未登录或登录已过期')
    }
    if (response.status === 403)
      throw new Error(payload.message || '无权限访问（仅管理员可用）')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')

    return payload.data as T
  }

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const data = await request<UserDTO[]>('/api/users', { method: 'GET' })
      setUsers(Array.isArray(data) ? data : [])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载用户失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const openCreate = () => {
    setEditingUser(null)
    form.setFieldsValue({
      username: '',
      name: '',
      password: '',
      role: 'user',
    })
    setModalOpen(true)
  }

  const openEdit = (user: UserDTO) => {
    setEditingUser(user)
    form.setFieldsValue({
      username: user.username,
      name: user.name,
      password: '',
      role: user.role,
    })
    setModalOpen(true)
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      if (editingUser) {
        await request<UserDTO>(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: values.name,
            password: values.password,
            role: values.role,
          }),
        })
        msgApi.success('更新用户成功')
      }
      else {
        await request<UserDTO>('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            username: values.username,
            name: values.name,
            password: values.password,
            role: values.role,
          }),
        })
        msgApi.success('创建用户成功')
      }
      setModalOpen(false)
      fetchUsers()
    }
    catch (error) {
      if (error instanceof Error && error.message.includes('out of date'))
        return
      msgApi.error(error instanceof Error ? error.message : '提交失败')
    }
    finally {
      setSubmitting(false)
    }
  }

  const remove = async (user: UserDTO) => {
    try {
      await request<boolean>(`/api/users/${user.id}`, { method: 'DELETE' })
      msgApi.success('删除用户成功')
      fetchUsers()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '删除用户失败')
    }
  }

  if (currentRole !== 'admin') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">用户管理仅管理员可访问。</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {contextHolder}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">用户列表</div>
          <Button type="primary" onClick={openCreate}>新增用户</Button>
        </div>
        <Table<UserDTO>
          rowKey="id"
          loading={loading}
          dataSource={users}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 90 },
            { title: '用户名', dataIndex: 'username', width: 180 },
            { title: '姓名', dataIndex: 'name', width: 220 },
            {
              title: '角色',
              dataIndex: 'role',
              width: 140,
              render: (role: UserRole) => (
                <Tag color={roleColorMap[role]}>
                  {roleLabelMap[role]}
                </Tag>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              render: (_, record) => (
                <Space>
                  <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
                  <Popconfirm
                    title="确认删除该用户？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => remove(record)}
                  >
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Modal
        title={editingUser ? '编辑用户' : '新增用户'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        forceRender
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          {!editingUser && (
            <Form.Item
              label="用户名"
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input placeholder="请输入用户名" />
            </Form.Item>
          )}

          {editingUser && (
            <Form.Item label="用户名" name="username">
              <Input disabled />
            </Form.Item>
          )}

          <Form.Item
            label="姓名"
            name="name"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input placeholder="请输入姓名" />
          </Form.Item>

          <Form.Item
            label={editingUser ? '密码（重置）' : '密码'}
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>

          <Form.Item
            label="角色"
            name="role"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              options={[
                { label: '管理员', value: 'admin' },
                { label: '普通用户', value: 'user' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
