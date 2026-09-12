import { afterEach, expect, it, vi } from 'vitest';
import { requestOrientationPermission } from '../../client/controller/sensor';

afterEach(() => vi.unstubAllGlobals());

it('센서 API가 없으면 예외 대신 unavailable을 반환한다', async () => {
  vi.stubGlobal('DeviceOrientationEvent', undefined);
  await expect(requestOrientationPermission()).resolves.toBe('unavailable');
});
