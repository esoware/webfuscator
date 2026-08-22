import type { ComponentPropsWithoutRef } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700',
  secondary: 'border border-line bg-zinc-900 text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800',
  ghost: 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
}

const BASE_CLASSES =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors outline-offset-2 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:pointer-events-none disabled:opacity-40'

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: Variant
}

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className ?? ''}`}
      {...rest}
    />
  )
}
