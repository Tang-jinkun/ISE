import * as React from "react"
import { cn } from "@/lib/utils"

export interface SliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> {
  value?: number[]
  max?: number
  min?: number
  step?: number
  onValueChange?: (value: number[]) => void
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, onValueChange, min = 0, max = 100, step = 1, ...props }, ref) => {
    // Basic single-thumb slider using native input range
    // Does not support range selection (two thumbs) for now to keep it simple without Radix
    const val = value ? value[0] : 0

    return (
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={(e) => onValueChange?.([parseFloat(e.target.value)])}
        className={cn(
          "flex w-full cursor-pointer items-center rounded-lg bg-secondary accent-primary h-2 appearance-none",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Slider.displayName = "Slider"

export { Slider }
