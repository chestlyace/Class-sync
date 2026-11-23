import { describe, expect, it } from 'vitest'
import { poolSsl } from './ssl'

const HEROKU_URL = 'postgres://u:p@ec2-1-2-3-4.eu-west-1.compute.amazonaws.com:5432/d'

describe('poolSsl', () => {
  it('encrypts without verifying on Heroku', () => {
    expect(poolSsl(HEROKU_URL, { DYNO: 'web.1' })).toEqual({ rejectUnauthorized: false })
  })

  it('follows DATABASE_SSL', () => {
    expect(poolSsl(HEROKU_URL, { DATABASE_SSL: 'no-verify' })).toEqual({ rejectUnauthorized: false })
    expect(poolSsl(HEROKU_URL, { DYNO: 'web.1', DATABASE_SSL: 'off' })).toBeUndefined()
  })

  it('leaves it to the URL when it names an sslmode, and off locally', () => {
    expect(poolSsl(`${HEROKU_URL}?sslmode=require`, { DYNO: 'web.1' })).toBeUndefined()
    expect(poolSsl('postgres://postgres@127.0.0.1:5432/clasync', {})).toBeUndefined()
  })
})
