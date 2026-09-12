import QRCode from 'qrcode';

// 현재 접속 출처(터널 주소일 수 있음)를 그대로 사용해 컨트롤러 URL을 만든다.
export function buildControllerUrl(inviteToken: string): string {
  const url = new URL('/controller/', window.location.origin);
  url.searchParams.set('invite', inviteToken);
  return url.toString();
}

export async function renderQr(imageEl: HTMLImageElement, controllerUrl: string): Promise<void> {
  const dataUrl = await QRCode.toDataURL(controllerUrl, { margin: 1, width: 320 });
  imageEl.src = dataUrl;
}
