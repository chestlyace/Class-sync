import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'

type RacedMethod = 'transaction' | 'update' | 'delete' | 'insert'

/**
 * The ctx with a db whose first `method` call runs `meanwhile` first: another request that
 * commits between a service's checks and its write. For `transaction`, `meanwhile` runs before
 * the transaction starts; for a query builder (`update`, `delete`, `insert`), before the query
 * executes. Later calls go straight through. `meanwhile` should use the real db.
 */
export function racing(ctx: Ctx, method: RacedMethod, meanwhile: () => Promise<unknown>): Ctx {
  let pending = true
  const real = ctx.db
  const db = new Proxy(real, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      const bound = value.bind(target)
      if (prop !== method || !pending) return bound
      pending = false
      if (method === 'transaction') {
        return async (...args: unknown[]) => {
          await meanwhile()
          return bound(...args)
        }
      }
      return (...args: unknown[]) => delayed(bound(...args), meanwhile)
    },
  }) as Db
  return { ...ctx, db }
}

const isThenable = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'

/**
 * A query builder whose execution waits for `meanwhile`. Chained calls keep the wrapper, including
 * those that return a new builder (`update().set()`).
 */
function delayed<T extends object>(builder: T, meanwhile: () => Promise<unknown>): T {
  const wrapper: T = new Proxy(builder, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (prop === 'then' && typeof value === 'function') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          meanwhile().then(() => (target as unknown as PromiseLike<unknown>).then(resolve, reject), reject)
      }
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const out = value.apply(target, args)
        if (out === target) return wrapper
        return isThenable(out) || (typeof out === 'object' && out !== null && 'where' in out) ? delayed(out, meanwhile) : out
      }
    },
  })
  return wrapper
}
