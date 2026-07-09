import { ok, err } from './types';

describe('Result envelope (tech design §8)', () => {
  it('ok() wraps data with ok:true', () => {
    expect(ok({ hello: 'world' })).toEqual({ ok: true, data: { hello: 'world' } });
  });

  it('err() wraps a code + message with ok:false', () => {
    expect(err('NOT_FOUND', 'missing')).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: 'missing',
    });
  });
});
