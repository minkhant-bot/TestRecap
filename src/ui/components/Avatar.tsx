interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function Avatar({ name, src, size = 'md' }: AvatarProps) {
  return (
    <span className={`ds-avatar ds-avatar--${size}`} title={name}>
      {src ? <img src={src} alt="" /> : <span aria-hidden="true">{initials(name)}</span>}
      <span className="ds-sr-only">{name}</span>
    </span>
  );
}
