'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, message } from 'antd'

type EnterpriseDTO = {
  id: number
  shortName: string
  unifiedCreditCode: string
  region: string
  admissionStatus: boolean
  createdAt: string
  updatedAt: string
}

type EnterpriseDetailDTO = EnterpriseDTO & {
  inHiddenDebtList: boolean
  in3899List: boolean
  meets335Indicator: boolean
  meets224Indicator: boolean
  enterpriseLevel: string
  mainBusinessType: string
  mainBusiness: string
  relatedPartyPublicOpinion: string
  industry: string
  address: string
  businessScope: string
  legalPerson: string
  companyType: string
  enterpriseNature: string
  actualController: string
  actualControllerControlPath: string
  legalPersonIdCard: string
}

type EnterprisePageResult = {
  items: EnterpriseDTO[]
  page: number
  pageSize: number
  total: number
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

type ListFilters = {
  keyword: string
  region: string
  admissionStatus?: 'true' | 'false'
}

type EnterpriseFormValues = {
  shortName: string
  unifiedCreditCode: string
  region: string
  admissionStatus: boolean
  enterpriseLevel: string
  industry: string
  address: string
  legalPerson: string
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

export default function EnterprisesPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [form] = Form.useForm<EnterpriseFormValues>()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingID, setEditingID] = useState<number | null>(null)
  const [items, setItems] = useState<EnterpriseDTO[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [filters, setFilters] = useState<ListFilters>({ keyword: '', region: '' })

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
      router.push('/?redirect=/app/enterprises')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const fetchList = async () => {
    setLoading(true)
    try {
      const search = new URLSearchParams()
      search.set('page', String(page))
      search.set('pageSize', String(pageSize))
      if (filters.keyword.trim())
        search.set('keyword', filters.keyword.trim())
      if (filters.region.trim())
        search.set('region', filters.region.trim())
      if (filters.admissionStatus)
        search.set('admissionStatus', filters.admissionStatus)

      const data = await request<EnterprisePageResult>(`/api/enterprises?${search.toString()}`, { method: 'GET' })
      setItems(Array.isArray(data?.items) ? data.items : [])
      setTotal(Number(data?.total) || 0)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载企业列表失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchList()
  }, [page, pageSize, filters])

  const openCreate = () => {
    setEditingID(null)
    form.setFieldsValue({
      shortName: '',
      unifiedCreditCode: '',
      region: '',
      admissionStatus: false,
      enterpriseLevel: '',
      industry: '',
      address: '',
      legalPerson: '',
    })
    setModalOpen(true)
  }

  const openEdit = async (id: number) => {
    try {
      const detail = await request<EnterpriseDetailDTO>(`/api/enterprises/${id}`, { method: 'GET' })
      setEditingID(id)
      form.setFieldsValue({
        shortName: detail.shortName || '',
        unifiedCreditCode: detail.unifiedCreditCode || '',
        region: detail.region || '',
        admissionStatus: !!detail.admissionStatus,
        enterpriseLevel: detail.enterpriseLevel || '',
        industry: detail.industry || '',
        address: detail.address || '',
        legalPerson: detail.legalPerson || '',
      })
      setModalOpen(true)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载企业详情失败')
    }
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const payload = {
        shortName: values.shortName,
        unifiedCreditCode: values.unifiedCreditCode,
        region: values.region || '',
        admissionStatus: !!values.admissionStatus,
        enterpriseLevel: values.enterpriseLevel || '',
        industry: values.industry || '',
        address: values.address || '',
        legalPerson: values.legalPerson || '',
      }

      if (editingID) {
        await request<EnterpriseDetailDTO>(`/api/enterprises/${editingID}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
        msgApi.success('更新企业成功')
      }
      else {
        await request<EnterpriseDetailDTO>('/api/enterprises', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        msgApi.success('创建企业成功')
      }

      setModalOpen(false)
      fetchList()
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

  const remove = async (id: number) => {
    try {
      await request<boolean>(`/api/enterprises/${id}`, { method: 'DELETE' })
      msgApi.success('删除企业成功')
      fetchList()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '删除企业失败')
    }
  }

  const pagination = useMemo(() => ({
    current: page,
    pageSize,
    total,
    showSizeChanger: true,
    pageSizeOptions: ['10', '20', '50'],
    onChange: (nextPage: number, nextSize: number) => {
      setPage(nextPage)
      setPageSize(nextSize)
    },
  }), [page, pageSize, total])

  return (
    <div className="space-y-3">
      {contextHolder}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <Input
            placeholder="简称/统一信用代码"
            value={filters.keyword}
            onChange={event => setFilters(prev => ({ ...prev, keyword: event.target.value }))}
          />
          <Input
            placeholder="所在区域"
            value={filters.region}
            onChange={event => setFilters(prev => ({ ...prev, region: event.target.value }))}
          />
          <Select
            allowClear
            placeholder="准入状态"
            value={filters.admissionStatus}
            onChange={value => setFilters(prev => ({ ...prev, admissionStatus: value }))}
            options={[
              { label: '准入', value: 'true' },
              { label: '不准入', value: 'false' },
            ]}
          />
          <Space>
            <Button type="primary" onClick={() => setPage(1)}>查询</Button>
            <Button onClick={() => {
              setFilters({ keyword: '', region: '' })
              setPage(1)
            }}
            >重置</Button>
          </Space>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">企业列表</div>
          <Button type="primary" onClick={openCreate}>新增企业</Button>
        </div>

        <Table<EnterpriseDTO>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={pagination}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 80 },
            { title: '企业简称', dataIndex: 'shortName', width: 180 },
            { title: '统一信用代码', dataIndex: 'unifiedCreditCode', width: 220 },
            { title: '所在区域', dataIndex: 'region', width: 140 },
            {
              title: '是否准入',
              dataIndex: 'admissionStatus',
              width: 120,
              render: (value: boolean) => (value ? '是' : '否'),
            },
            {
              title: '操作',
              key: 'actions',
              width: 180,
              render: (_, record) => (
                <Space>
                  <Button size="small" onClick={() => openEdit(record.id)}>编辑</Button>
                  <Popconfirm
                    title="确认删除该企业？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => remove(record.id)}
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
        title={editingID ? '编辑企业' : '新增企业'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        width={680}
        getContainer={false}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ admissionStatus: false }}>
          <Form.Item label="企业简称" name="shortName" rules={[{ required: true, message: '请输入企业简称' }]}>
            <Input placeholder="请输入企业简称" />
          </Form.Item>
          <Form.Item label="统一信用代码" name="unifiedCreditCode" rules={[{ required: true, message: '请输入统一信用代码' }]}>
            <Input placeholder="请输入统一信用代码" disabled={!!editingID} />
          </Form.Item>
          <Form.Item label="所在区域" name="region">
            <Input placeholder="请输入所在区域" />
          </Form.Item>
          <Form.Item label="企业层级" name="enterpriseLevel">
            <Input placeholder="请输入企业层级" />
          </Form.Item>
          <Form.Item label="所属行业" name="industry">
            <Input placeholder="请输入所属行业" />
          </Form.Item>
          <Form.Item label="法人" name="legalPerson">
            <Input placeholder="请输入法人" />
          </Form.Item>
          <Form.Item label="地址" name="address">
            <Input.TextArea rows={2} placeholder="请输入地址" />
          </Form.Item>
          <Form.Item label="是否准入" name="admissionStatus" valuePropName="checked">
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
