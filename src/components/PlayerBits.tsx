import type { ReactNode } from 'react'
import { UserRound } from 'lucide-react'

export function Avatar({ name, image, tone = 'lime', size = 'md' }: { name: string; image?: string | null; tone?: string; size?: string }) {
  return <span className={`avatar avatar-${tone} avatar-${size}`}>{image ? <img src={image} alt=""/> : name ? name.split(/[\s_]+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() : <UserRound size={15}/>}</span>
}

export function PlayerLink({ id, children, onOpen, className = '' }: { id: string; children: ReactNode; onOpen: (id: string) => void; className?: string }) {
  return <button type="button" className={`player-profile-link ${className}`} onClick={() => onOpen(id)}>{children}</button>
}
