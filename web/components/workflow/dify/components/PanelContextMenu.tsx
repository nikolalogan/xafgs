import { panelMenuItems, type PanelMenuActionKey } from '../config/contextMenuPreset'
import type { PanelMenuState } from '../core/store'

type PanelContextMenuProps = {
  menu?: PanelMenuState
  canPaste: boolean
  onPaste: () => void
  onExport: () => void
  onImport: () => void
  onClose: () => void
}

export default function PanelContextMenu({ menu, canPaste, onPaste, onExport, onImport, onClose }: PanelContextMenuProps) {
  if (!menu)
    return null

  const handlers: Record<PanelMenuActionKey, () => void> = {
    paste: onPaste,
    export: onExport,
    import: onImport,
  }

  return (
    <div className="absolute z-20 w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-lg" style={{ left: menu.left, top: menu.top }}>
      {panelMenuItems.map((item, index) => {
        if (item.type === 'label')
          return <div key={`label-${index}`} className="px-3 py-1 text-[11px] text-gray-400">{item.label}</div>

        if (item.type === 'divider')
          return <div key={`divider-${index}`} className="my-1 h-px bg-gray-100" />

        const disabled = item.key === 'paste' && !canPaste
        return (
          <button
            key={item.key}
            disabled={disabled}
            onClick={() => { if (!disabled) handlers[item.key](); onClose() }}
            className="flex h-8 w-full items-center rounded px-3 text-left text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
