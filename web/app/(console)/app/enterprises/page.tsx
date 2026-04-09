'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, message } from 'antd'

type AdmissionStatus = 'admitted' | 'rejected' | 'pending'

type EnterpriseDTO = {
  id: number
  shortName: string
  unifiedCreditCode: string
  regionId: number
  regionAdminCode?: string
  regionCode?: string
  regionName?: string
  admissionStatus: AdmissionStatus
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
  regionId?: number
  admissionStatus?: AdmissionStatus
}

type EnterpriseFormValues = {
  shortName: string
  unifiedCreditCode: string
  regionId?: number
  admissionStatus: AdmissionStatus
  enterpriseLevel: string
  industry: string
  address: string
  legalPerson: string
}

const admissionStatusOptions = [
  { label: '准入', value: 'admitted' as const },
  { label: '不准入', value: 'rejected' as const },
  { label: '待定', value: 'pending' as const },
]

const admissionStatusLabelMap: Record<AdmissionStatus, string> = {
  admitted: '准入',
  rejected: '不准入',
  pending: '待定',
}

const normalizeAdmissionStatus = (value: unknown): AdmissionStatus => {
  if (value === 'admitted' || value === true || value === 'true')
    return 'admitted'
  if (value === 'rejected' || value === false || value === 'false')
    return 'rejected'
  return 'pending'
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
  const [exporting, setExporting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingID, setEditingID] = useState<number | null>(null)
  const [items, setItems] = useState<EnterpriseDTO[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [filters, setFilters] = useState<ListFilters>({ keyword: '' })
  const lastQueryRef = useRef('')

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
    const search = new URLSearchParams()
    search.set('page', String(page))
    search.set('pageSize', String(pageSize))
    if (filters.keyword.trim())
      search.set('keyword', filters.keyword.trim())
    if (typeof filters.regionId === 'number' && filters.regionId > 0)
      search.set('regionId', String(filters.regionId))
    if (filters.admissionStatus)
      search.set('admissionStatus', filters.admissionStatus)

    const queryKey = search.toString()
    if (queryKey === lastQueryRef.current)
      return
    lastQueryRef.current = queryKey

    setLoading(true)
    try {
      const data = await request<EnterprisePageResult>(`/api/enterprises?${queryKey}`, { method: 'GET' })
      const normalizedItems = (Array.isArray(data?.items) ? data.items : []).map(item => ({
        ...item,
        admissionStatus: normalizeAdmissionStatus(item?.admissionStatus),
      }))
      setItems(normalizedItems)
      setTotal(Number(data?.total) || 0)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载企业列表失败')
    }
    finally {
      setLoading(false)
    }
  }

  const buildSearchParams = (targetPage: number, targetPageSize: number) => {
    const search = new URLSearchParams()
    search.set('page', String(targetPage))
    search.set('pageSize', String(targetPageSize))
    if (filters.keyword.trim())
      search.set('keyword', filters.keyword.trim())
    if (typeof filters.regionId === 'number' && filters.regionId > 0)
      search.set('regionId', String(filters.regionId))
    if (filters.admissionStatus)
      search.set('admissionStatus', filters.admissionStatus)
    return search
  }

  const exportExcel = async () => {
    setExporting(true)
    try {
      const exportPageSize = 100
      const firstSearch = buildSearchParams(1, exportPageSize)
      const firstData = await request<EnterprisePageResult>(`/api/enterprises?${firstSearch.toString()}`, { method: 'GET' })
      const firstItems = (Array.isArray(firstData?.items) ? firstData.items : []).map(item => ({
        ...item,
        admissionStatus: normalizeAdmissionStatus(item?.admissionStatus),
      }))
      const exportItems: EnterpriseDTO[] = [...firstItems]
      const totalCount = Number(firstData?.total) || firstItems.length
      const totalPages = Math.max(1, Math.ceil(totalCount / exportPageSize))

      for (let currentPage = 2; currentPage <= totalPages; currentPage++) {
        const nextSearch = buildSearchParams(currentPage, exportPageSize)
        const nextData = await request<EnterprisePageResult>(`/api/enterprises?${nextSearch.toString()}`, { method: 'GET' })
        const nextItems = (Array.isArray(nextData?.items) ? nextData.items : []).map(item => ({
          ...item,
          admissionStatus: normalizeAdmissionStatus(item?.admissionStatus),
        }))
        exportItems.push(...nextItems)
      }

      if (exportItems.length === 0) {
        msgApi.warning('暂无可导出的企业数据')
        return
      }

      const rows = exportItems.map(item => {
        const regionCode = item.regionCode || item.regionAdminCode || String(item.regionId || '')
        const regionName = item.regionName || `区域#${item.regionId || ''}`
        return {
          id: item.id,
          shortName: item.shortName || '',
          unifiedCreditCode: item.unifiedCreditCode || '',
          region: `${regionName}（${regionCode}）`,
          admissionStatus: admissionStatusLabelMap[item.admissionStatus] || '待定',
          createdAt: item.createdAt || '',
          updatedAt: item.updatedAt || '',
        }
      })

      const escapeHTML = (value: string | number) =>
        String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll('\'', '&#39;')

      const tableRowsHTML = rows
        .map(row => `<tr>
<td>${escapeHTML(row.id)}</td>
<td>${escapeHTML(row.shortName)}</td>
<td>${escapeHTML(row.unifiedCreditCode)}</td>
<td>${escapeHTML(row.region)}</td>
<td>${escapeHTML(row.admissionStatus)}</td>
<td>${escapeHTML(row.createdAt)}</td>
<td>${escapeHTML(row.updatedAt)}</td>
</tr>`)
        .join('')

      const excelHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
</head>
<body>
  <table border="1">
    <thead>
      <tr>
        <th>ID</th>
        <th>企业简称</th>
        <th>统一信用代码</th>
        <th>所在区域</th>
        <th>准入状态</th>
        <th>创建时间</th>
        <th>更新时间</th>
      </tr>
    </thead>
    <tbody>${tableRowsHTML}</tbody>
  </table>
</body>
</html>`

      const blob = new Blob([`\uFEFF${excelHTML}`], { type: 'application/vnd.ms-excel;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const now = new Date()
      const filename = `企业列表_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.xls`
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
      msgApi.success(`已导出 ${exportItems.length} 条企业数据`)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '导出失败')
    }
    finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    fetchList()
  }, [page, pageSize, filters])

  const openCreate = () => {
    setEditingID(null)
    setModalOpen(true)
    form.setFieldsValue({
      shortName: '',
      unifiedCreditCode: '',
      regionId: undefined,
      admissionStatus: 'pending',
      enterpriseLevel: '',
      industry: '',
      address: '',
      legalPerson: '',
    })
  }

  const openEdit = async (id: number) => {
    try {
      const detail = await request<EnterpriseDetailDTO>(`/api/enterprises/${id}`, { method: 'GET' })
      setEditingID(id)
      setModalOpen(true)
      form.setFieldsValue({
        shortName: detail.shortName || '',
        unifiedCreditCode: detail.unifiedCreditCode || '',
        regionId: detail.regionId,
        admissionStatus: normalizeAdmissionStatus(detail.admissionStatus),
        enterpriseLevel: detail.enterpriseLevel || '',
        industry: detail.industry || '',
        address: detail.address || '',
        legalPerson: detail.legalPerson || '',
      })
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
        regionId: Number(values.regionId) || 0,
        admissionStatus: normalizeAdmissionStatus(values.admissionStatus),
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
      lastQueryRef.current = ''
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
      lastQueryRef.current = ''
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

  const regionLabelMap = useMemo(() => {
    const out = new Map<number, string>()
    for (const item of items) {
      if (!item.regionId || out.has(item.regionId))
        continue
      const regionCode = item.regionCode || item.regionAdminCode || String(item.regionId)
      const regionName = item.regionName || `区域#${item.regionId}`
      out.set(item.regionId, `${regionName}（${regionCode}）`)
    }
    return out
  }, [items])

  const regionOptions = useMemo(
    () => Array.from(regionLabelMap.entries()).map(([value, label]) => ({ value, label })),
    [regionLabelMap],
  )

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
          <Select
            allowClear
            placeholder="所在区域"
            value={filters.regionId}
            options={regionOptions}
            onChange={value => setFilters(prev => ({ ...prev, regionId: value }))}
          />
          <Select
            allowClear
            placeholder="准入状态"
            value={filters.admissionStatus}
            onChange={value => setFilters(prev => ({ ...prev, admissionStatus: value }))}
            options={admissionStatusOptions}
          />
          <Space>
            <Button type="primary" onClick={() => setPage(1)}>查询</Button>
            <Button onClick={() => {
              setFilters({ keyword: '' })
              setPage(1)
            }}
            >重置</Button>
          </Space>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">企业列表</div>
          <Space>
            <Button onClick={exportExcel} loading={exporting}>导出Excel</Button>
            <Button type="primary" onClick={openCreate}>新增企业</Button>
          </Space>
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
            {
              title: '所在区域',
              dataIndex: 'regionId',
              width: 180,
              render: (value: number) => regionLabelMap.get(value) || `#${value}`,
            },
            {
              title: '准入状态',
              dataIndex: 'admissionStatus',
              width: 120,
              render: (value: AdmissionStatus) => admissionStatusLabelMap[value] || '待定',
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
        <Form form={form} layout="vertical" initialValues={{ admissionStatus: 'pending' }}>
          <Form.Item label="企业简称" name="shortName" rules={[{ required: true, message: '请输入企业简称' }]}>
            <Input placeholder="请输入企业简称" />
          </Form.Item>
          <Form.Item label="统一信用代码" name="unifiedCreditCode" rules={[{ required: true, message: '请输入统一信用代码' }]}>
            <Input placeholder="请输入统一信用代码" disabled={!!editingID} />
          </Form.Item>
          <Form.Item label="所在区域" name="regionId" rules={[{ required: true, message: '请选择所在区域' }]}>
            <Select placeholder="请选择所在区域" options={regionOptions} />
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
          <Form.Item label="准入状态" name="admissionStatus">
            <Select options={admissionStatusOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
