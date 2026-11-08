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

/** A query builder whose execution waits for `meanwhile`; chained calls keep the wrapper. */
function delayed<T extends object>(builder: T, meanwhile: () => Promise<unknown>): T {
  const wrapper: T = new Proxy(builder, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          meanwhile().then(() => (target as unknown as PromiseLike<unknown>).then(resolve, reject), reject)
      }
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const out = value.apply(target, args)
        return out === target ? wrapper : out
      }
    },
  })
  return wrapper
}
