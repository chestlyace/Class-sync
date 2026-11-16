import * as React from "react"
import { LoaderCircle } from "lucide-react"
import { cn } from "cn"

/** A small spinning ring for busy states. Decorative: the busy element carries `aria-busy`. */
function Spinner({ className, ...props }: React.ComponentProps<typeof LoaderCircle>) {
  return (
    <LoaderCircle
      aria-hidden="true"
      data-spinner=""
      className={cn("animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Spinner }
