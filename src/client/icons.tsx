import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon ({ children, ...props }: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>
}

export const CloudIcon = (props: IconProps) => <Icon {...props}><path d="M17.5 19H6.2a4.2 4.2 0 0 1-.6-8.36A6.5 6.5 0 0 1 18.05 9a5 5 0 0 1-.55 10Z" /></Icon>
export const UploadIcon = (props: IconProps) => <Icon {...props}><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></Icon>
export const CopyIcon = (props: IconProps) => <Icon {...props}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></Icon>
export const TrashIcon = (props: IconProps) => <Icon {...props}><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></Icon>
export const FolderIcon = (props: IconProps) => <Icon {...props}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" /></Icon>
export const FileIcon = (props: IconProps) => <Icon {...props}><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v5h5" /></Icon>
export const RefreshIcon = (props: IconProps) => <Icon {...props}><path d="M20 7v5h-5" /><path d="M18.2 16a8 8 0 1 1 .4-8.5L20 12" /></Icon>
export const ListIcon = (props: IconProps) => <Icon {...props}><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></Icon>
export const GridIcon = (props: IconProps) => <Icon {...props}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></Icon>
export const ArrowIcon = (props: IconProps) => <Icon {...props}><path d="m15 18-6-6 6-6" /></Icon>
export const ExternalIcon = (props: IconProps) => <Icon {...props}><path d="M14 4h6v6m0-6-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></Icon>
