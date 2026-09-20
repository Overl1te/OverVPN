import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ERROR_CATALOG,
  ERROR_MESSAGES,
  errorDocsUrl,
  isErrorCode,
  type ErrorCode,
} from './constants.ts';

describe('ERROR_CATALOG', () => {
  it('gives every code a unique OVN-xxxx id', () => {
    const codes = Object.keys(ERROR_CATALOG) as ErrorCode[];
    const ids = codes.map((code) => ERROR_CATALOG[code].id);
    assert.equal(ids.length, new Set(ids).size);
    for (const id of ids) {
      assert.match(id, /^OVN-\d{4}$/);
    }
    assert.equal(ERROR_CATALOG.VALIDATION_FAILED.id, 'OVN-4001');
    assert.equal(ERROR_CATALOG.PLAN_NAME_CONFLICT.id, 'OVN-4092');
    assert.ok(isErrorCode('PLAN_INBOUND_NOT_FOUND'));
    assert.equal(
      errorDocsUrl('OVN-4092'),
      'https://overl1te.github.io/OverVPN/errors/ovn-4092.html',
    );
    assert.equal(ERROR_MESSAGES.PLAN_NAME_CONFLICT.ru, ERROR_CATALOG.PLAN_NAME_CONFLICT.title.ru);
  });
});
