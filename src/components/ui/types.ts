export interface TableColumn {
  key: string
  label: string
  align?: 'left' | 'center' | 'right'
  hideOnMobile?: boolean
  srOnly?: boolean
}
