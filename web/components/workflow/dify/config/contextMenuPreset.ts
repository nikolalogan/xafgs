export type MenuItemVariant = 'default' | 'danger'

type MenuActionItem<ActionKey extends string> = {
  type: 'action'
  key: ActionKey
  label: string
  variant?: MenuItemVariant
}

type MenuLabelItem = {
  type: 'label'
  label: string
}

type MenuDividerItem = {
  type: 'divider'
}

export type ContextMenuItem<ActionKey extends string> =
  | MenuActionItem<ActionKey>
  | MenuLabelItem
  | MenuDividerItem

export type ActionMenuItem<ActionKey extends string> = MenuActionItem<ActionKey>

export type NodeMenuActionKey = 'copy' | 'duplicate' | 'delete'
export type EdgeMenuActionKey = 'delete'
export type PanelMenuActionKey = 'paste' | 'export' | 'import'
export type SelectionMenuActionKey =
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignTop'
  | 'alignMiddle'
  | 'alignBottom'
  | 'distributeHorizontal'
  | 'distributeVertical'
  | 'copy'
  | 'duplicate'
  | 'delete'

export const nodeMenuItems: ActionMenuItem<NodeMenuActionKey>[] = [
  { type: 'action', key: 'copy', label: '复制' },
  { type: 'action', key: 'duplicate', label: '复制并粘贴' },
  { type: 'action', key: 'delete', label: '删除', variant: 'danger' },
]

export const edgeMenuItems: ActionMenuItem<EdgeMenuActionKey>[] = [
  { type: 'action', key: 'delete', label: '删除连线', variant: 'danger' },
]

export const panelMenuItems: ContextMenuItem<PanelMenuActionKey>[] = [
  { type: 'action', key: 'paste', label: '粘贴' },
  { type: 'divider' },
  { type: 'action', key: 'export', label: '导出 DSL' },
  { type: 'action', key: 'import', label: '导入 DSL' },
]

export const selectionMenuItems: ContextMenuItem<SelectionMenuActionKey>[] = [
  { type: 'label', label: '对齐' },
  { type: 'action', key: 'alignLeft', label: '左对齐' },
  { type: 'action', key: 'alignCenter', label: '水平居中' },
  { type: 'action', key: 'alignRight', label: '右对齐' },
  { type: 'action', key: 'alignTop', label: '顶对齐' },
  { type: 'action', key: 'alignMiddle', label: '垂直居中' },
  { type: 'action', key: 'alignBottom', label: '底对齐' },
  { type: 'action', key: 'distributeHorizontal', label: '水平分布' },
  { type: 'action', key: 'distributeVertical', label: '垂直分布' },
  { type: 'divider' },
  { type: 'label', label: '操作' },
  { type: 'action', key: 'copy', label: '复制所选' },
  { type: 'action', key: 'duplicate', label: '复制并粘贴' },
  { type: 'action', key: 'delete', label: '删除所选', variant: 'danger' },
]
