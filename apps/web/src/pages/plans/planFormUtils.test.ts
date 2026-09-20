import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { planFormValuesToPayload, toOptionalInt } from './planFormUtils';

describe('toOptionalInt', () => {
  it('truncates numeric strings from InputNumber', () => {
    assert.equal(toOptionalInt('2000'), 2000);
    assert.equal(toOptionalInt(1.9), 1);
    assert.equal(toOptionalInt(''), null);
    assert.equal(toOptionalInt(undefined), undefined);
  });
});

describe('planFormValuesToPayload', () => {
  it('sends integer day and device limits', () => {
    const payload = planFormValuesToPayload({
      name: 'тест',
      defaultExpiryDays: '2000' as unknown as number,
      defaultDeviceLimit: '1' as unknown as number,
      defaultResetStrategy: 'MONTHLY',
      inboundIds: ['f7894700-7414-48a5-a80d-ad5eb9e8a166'],
    });
    assert.equal(payload.defaultExpiryDays, 2000);
    assert.equal(payload.defaultDeviceLimit, 1);
  });
});
