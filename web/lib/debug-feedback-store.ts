import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type DebugFeedbackRole = 'admin' | 'user' | 'guest'
export type DebugFeedbackType = 'requirement' | 'bug'
export type DebugFeedbackStatus = 'open' | 'done'

export type DebugFeedbackAttachment = {
  id: string
  name: string
  mimeType: string
  size: number
  storageName: string
}

export type DebugFeedbackItem = {
  id: number
  title: string
  type: DebugFeedbackType
  description: string
  status: DebugFeedbackStatus
  attachments: DebugFeedbackAttachment[]
  submitterId?: number
  submitterUsername: string
  submitterName?: string
  submitterRole: DebugFeedbackRole
  createdAt: string
  completedAt: string | null
  completedBy: string | null
}

type StoreData = {
  lastId: number
  items: DebugFeedbackItem[]
}

type CreateFeedbackInput = {
  title: string
  type: DebugFeedbackType
  description?: string
  submitterId?: number
  submitterUsername?: string
  submitterName?: string
  submitterRole?: DebugFeedbackRole
  files?: File[]
}

const STORE_ROOT = path.join(process.cwd(), '.data', 'debug-feedback')
const ATTACHMENT_ROOT = path.join(STORE_ROOT, 'attachments')
const STORE_FILE = path.join(STORE_ROOT, 'feedback.json')

const DEFAULT_STORE: StoreData = {
  lastId: 0,
  items: [],
}

const ensureStore = async () => {
  await mkdir(ATTACHMENT_ROOT, { recursive: true })
  try {
    await stat(STORE_FILE)
  }
  catch {
    await writeFile(STORE_FILE, JSON.stringify(DEFAULT_STORE, null, 2), 'utf-8')
  }
}

const readStore = async () => {
  await ensureStore()
  try {
    const raw = await readFile(STORE_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<StoreData>
    return {
      lastId: Number(parsed.lastId || 0),
      items: Array.isArray(parsed.items) ? parsed.items : [],
    } satisfies StoreData
  }
  catch {
    return { ...DEFAULT_STORE }
  }
}

const writeStore = async (data: StoreData) => {
  await ensureStore()
  await writeFile(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

const normalizeRole = (role?: string): DebugFeedbackRole => {
  if (role === 'admin' || role === 'user')
    return role
  return 'guest'
}

const normalizeType = (type?: string): DebugFeedbackType => {
  return type === 'requirement' ? 'requirement' : 'bug'
}

const sanitizeFileName = (value: string) => {
  const trimmed = String(value || '').trim()
  const normalized = trimmed.replace(/[^\w.\-()\u4e00-\u9fa5]+/g, '_')
  return normalized || 'attachment'
}

export const listDebugFeedback = async () => {
  const data = await readStore()
  return [...data.items].map(item => ({
    ...item,
    submitterId: Number(item.submitterId || 0) || undefined,
    submitterUsername: String(item.submitterUsername || '').trim() || '未知用户',
    submitterName: String(item.submitterName || '').trim() || undefined,
    submitterRole: normalizeRole(item.submitterRole),
  })).sort((left, right) => {
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })
}

export const getDebugFeedbackSummary = async () => {
  const items = await listDebugFeedback()
  return {
    items,
    openCount: items.filter(item => item.status === 'open').length,
  }
}

export const createDebugFeedback = async (input: CreateFeedbackInput) => {
  const title = String(input.title || '').trim()
  if (!title)
    throw new Error('请输入标题')

  const data = await readStore()
  const nextId = data.lastId + 1
  const now = new Date().toISOString()
  const files = Array.isArray(input.files) ? input.files.filter(file => file.size > 0) : []
  const attachments: DebugFeedbackAttachment[] = []

  for (const file of files) {
    const extension = path.extname(file.name || '')
    const attachmentId = globalThis.crypto.randomUUID()
    const storageName = `${attachmentId}${extension}`
    const outputPath = path.join(ATTACHMENT_ROOT, storageName)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(outputPath, buffer)
    attachments.push({
      id: attachmentId,
      name: sanitizeFileName(file.name || storageName),
      mimeType: String(file.type || 'application/octet-stream'),
      size: Number(file.size || buffer.byteLength),
      storageName,
    })
  }

  const item: DebugFeedbackItem = {
    id: nextId,
    title,
    type: normalizeType(input.type),
    description: String(input.description || '').trim(),
    status: 'open',
    attachments,
    submitterId: Number(input.submitterId || 0) || undefined,
    submitterUsername: String(input.submitterUsername || '').trim() || '未知用户',
    submitterName: String(input.submitterName || '').trim() || undefined,
    submitterRole: normalizeRole(input.submitterRole),
    createdAt: now,
    completedAt: null,
    completedBy: null,
  }

  const nextData: StoreData = {
    lastId: nextId,
    items: [item, ...data.items],
  }
  await writeStore(nextData)
  return item
}

export const completeDebugFeedback = async (id: number, completedBy?: string) => {
  const data = await readStore()
  const index = data.items.findIndex(item => item.id === id)
  if (index < 0)
    throw new Error('记录不存在')

  const current = data.items[index]
  if (current.status === 'done')
    return current

  const nextItem: DebugFeedbackItem = {
    ...current,
    status: 'done',
    completedAt: new Date().toISOString(),
    completedBy: String(completedBy || '').trim() || '管理员',
  }
  const nextItems = [...data.items]
  nextItems[index] = nextItem
  await writeStore({
    ...data,
    items: nextItems,
  })
  return nextItem
}

export const getDebugAttachment = async (attachmentId: string) => {
  const items = await listDebugFeedback()
  for (const item of items) {
    const attachment = item.attachments.find(entry => entry.id === attachmentId)
    if (!attachment)
      continue
    const filePath = path.join(ATTACHMENT_ROOT, attachment.storageName)
    const content = await readFile(filePath)
    return {
      attachment,
      content,
    }
  }
  return null
}
