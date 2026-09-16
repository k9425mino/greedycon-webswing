import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// 제품 코드에는 테스트 훅을 두지 않는다. 테스트 응답에만 읽기 전용 관찰 함수를 덧붙여
// 호스트 모듈의 내부 상태(단계·입력·거미줄·효과)를 그대로 읽는다.
const PROBE_SOURCE = `
  export function readHostState() {
    return {
      phase,
      physicsReady,
      controllerConnected,
      sensorAvailable: controllerStatus?.sensorAvailable ?? false,
      pressed,
      firing: swing?.phase === 'firing',
      webPhase: swing?.phase ?? null,
      webFailure: swing?.lastFailure ?? null,
      attached: attachedPoint !== null,
      attachDistance: physics?.attachment?.distance ?? null,
      beam: fireStrand.group.visible,
      beamOpacity: fireStrand.core.material.opacity,
      flash: attachFlash.visible,
      audioAvailable: sfx.available,
      aim: currentAimDirection,
    };
  }
`;

// 줄은 앵커 높이까지 솟으면 저절로 풀린다. 부착 구간이 짧아 폴링으로는 놓칠 수 있으므로
// 프레임마다 확인해 한 번이라도 부착했는지를 남긴다.
const ATTACH_WATCH_SOURCE = `
  export function watchAttach() {
    const data = document.documentElement.dataset;
    delete data.sawAttach;
    function look() {
      if (attachedPoint !== null) data.sawAttach = 'true';
      requestAnimationFrame(look);
    }
    requestAnimationFrame(look);
  }
`;

export type HostState = {
  phase: string;
  physicsReady: boolean;
  controllerConnected: boolean;
  sensorAvailable: boolean;
  pressed: boolean;
  firing: boolean;
  webPhase: string | null;
  webFailure: string | null;
  attached: boolean;
  attachDistance: number | null;
  beam: boolean;
  beamOpacity: number;
  flash: boolean;
  audioAvailable: boolean;
  aim: [number, number, number];
};

// page.goto 전에 호출해야 한다. extraSource로 개별 테스트용 관찰 함수를 더 붙일 수 있다.
export async function installHostProbe(page: Page, extraSource = ''): Promise<void> {
  await page.route('**/host/main.ts', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()) + PROBE_SOURCE + ATTACH_WATCH_SOURCE + extraSource,
    });
  });
}

export function readHostState(page: Page): Promise<HostState> {
  return page.evaluate(async () => {
    const path = '/host/main.ts';
    return (await import(path)).readHostState() as HostState;
  });
}

// 플레이 중 상태는 빠르게 지나간다. 기본 폴링 간격(100ms부터 배로 늘어남)으로는 놓치므로
// 로케이터 검사와 비슷한 간격으로 고정한다.
const POLL_INTERVALS = [50, 50, 100];

// 부착 관찰을 시작한다. 이후 expectAttachSeen으로 한 번이라도 부착했는지 확인한다.
export async function startAttachWatch(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const path = '/host/main.ts';
    (await import(path)).watchAttach();
  });
}

export async function expectAttachSeen(page: Page, options?: { timeout?: number }): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-saw-attach', 'true', options);
}

export async function expectHostState(
  page: Page,
  expected: Partial<HostState>,
  options?: { timeout?: number },
): Promise<void> {
  await expect
    .poll(() => readHostState(page), { intervals: POLL_INTERVALS, ...options })
    .toMatchObject(expected);
}

export async function expectPhase(
  page: Page,
  phase: string,
  options?: { timeout?: number },
): Promise<void> {
  await expectHostState(page, { phase }, options);
}

export async function expectPhysicsReady(
  page: Page,
  options?: { timeout?: number },
): Promise<void> {
  await expectHostState(page, { physicsReady: true }, options);
}
