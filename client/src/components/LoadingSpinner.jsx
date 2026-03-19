/**
 * Ring spinner with logo centred (logo does not rotate).
 * Uses /logo.png from client/public (Vite).
 */
export default function LoadingSpinner({ size = 'md', className = '' }) {
  const sizes = {
    xs: { box: 'w-10 h-10', ring: 'border-[3px]', img: 'w-7 h-7' },
    sm: { box: 'w-16 h-16', ring: 'border-4', img: 'w-11 h-11' },
    md: { box: 'w-32 h-32', ring: 'border-4', img: 'w-24 h-24' },
    lg: { box: 'w-40 h-40', ring: 'border-4', img: 'w-32 h-32' },
  }
  const s = sizes[size] || sizes.md

  return (
    <div
      className={`relative flex items-center justify-center ${s.box} ${className}`}
      role="status"
      aria-label="Loading"
    >
      <div
        className={`students-loading-spinner-ring absolute inset-0 rounded-full border-gray-200 border-t-green-600 ${s.ring}`}
      />
      <img
        src="/logo.png"
        alt=""
        className={`relative z-10 ${s.img} object-contain pointer-events-none select-none`}
        draggable={false}
      />
    </div>
  )
}
