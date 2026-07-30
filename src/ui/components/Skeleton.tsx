interface SkeletonProps {
  width?: string;
  height?: string;
  rounded?: boolean;
  label?: string;
}

export function Skeleton({ width = '100%', height = '1rem', rounded = false, label = 'အကြောင်းအရာ ရယူနေသည်' }: SkeletonProps) {
  return (
    <span
      className={`ds-skeleton ${rounded ? 'ds-skeleton--rounded' : ''}`}
      style={{ width, height }}
      role="status"
      aria-label={label}
    />
  );
}
