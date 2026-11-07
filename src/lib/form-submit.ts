import { startTransition } from 'react'

/**
 * onSubmit handler that dispatches a `useActionState` action without React's automatic form
 * reset, so the user's input survives a failed submission (e.g. a CONFLICT or VALIDATION error).
 */
export function submitWith(dispatch: (data: FormData) => void) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    startTransition(() => dispatch(data))
  }
}
