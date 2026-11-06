import { afterEach, expect, it, vi } from 'vitest';
import { cameraError, createCameraSession, takePhoto } from '../src/camera';
afterEach(() => vi.unstubAllGlobals());
it('не оставляет камеру включённой при позднем разрешении после отмены', async () => {
  let allow!: (stream: MediaStream) => void;
  const getUserMedia = vi.fn(
    () =>
      new Promise<MediaStream>((resolve) => {
        allow = resolve;
      }),
  );
  const stop = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const camera = createCameraSession(),
    request = camera.start();
  camera.stop();
  allow({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(getUserMedia).toHaveBeenCalledWith(
    expect.objectContaining({
      audio: false,
      video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
    }),
  );
});
it('освобождает все дорожки и не запрашивает доступ повторно после закрытия', async () => {
  const stop = vi.fn(),
    getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const camera = createCameraSession();
  await camera.start();
  camera.stop();
  camera.stop();
  expect(stop).toHaveBeenCalledTimes(1);
  await expect(camera.start()).rejects.toMatchObject({ name: 'AbortError' });
  expect(getUserMedia).toHaveBeenCalledTimes(1);
});
it('показывает причину отказа и доступные способы выбрать фото', async () => {
  vi.stubGlobal('navigator', {});
  await expect(createCameraSession().start()).rejects.toMatchObject({ name: 'NotSupportedError' });
  expect(cameraError(new DOMException('denied', 'NotAllowedError'))).toContain(
    'настройках телефона',
  );
  expect(cameraError(new DOMException('busy', 'NotReadableError'))).toContain('занята');
  expect(cameraError(new DOMException('missing', 'NotFoundError'))).toContain('галереи');
  expect(cameraError(new DOMException('unsupported', 'NotSupportedError'))).toContain(
    'системную камеру',
  );
});
it('не сохраняет пустой кадр до готовности видео', async () => {
  await expect(takePhoto(document.createElement('video'))).rejects.toThrow('Дождитесь изображения');
});
