export function cameraError(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Нет доступа к камере. Разрешите Telegram доступ к камере в настройках телефона. Можно также открыть системную камеру или выбрать фото из галереи.';
  if (name === 'NotFoundError')
    return 'Камера не найдена. Откройте системную камеру или выберите фото из галереи.';
  if (name === 'NotReadableError')
    return 'Камера занята другим приложением. Закройте его и попробуйте снова или выберите фото из галереи.';
  if (name === 'NotSupportedError' || name === 'TypeError')
    return 'В этой версии Telegram предпросмотр камеры недоступен. Попробуйте системную камеру или выберите готовое фото из галереи.';
  return 'Не удалось открыть камеру. Попробуйте системную камеру или выберите фото из галереи.';
}

export function createCameraSession() {
  let closed = false;
  let stream: MediaStream | undefined;
  return {
    async start() {
      if (closed) throw new DOMException('Съёмка отменена', 'AbortError');
      if (!navigator.mediaDevices?.getUserMedia)
        throw new DOMException('Камера недоступна', 'NotSupportedError');
      const result = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
      });
      if (closed) {
        result.getTracks().forEach((track) => track.stop());
        throw new DOMException('Съёмка отменена', 'AbortError');
      }
      stream = result;
      return result;
    },
    stop() {
      closed = true;
      stream?.getTracks().forEach((track) => track.stop());
      stream = undefined;
    },
  };
}

export async function takePhoto(video: HTMLVideoElement): Promise<File> {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
    throw new Error('Дождитесь изображения с камеры');
  const scale = Math.min(1, 2600 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось подготовить снимок. Попробуйте системную камеру.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(new Error('Не удалось сохранить снимок. Попробуйте снова.')),
      'image/jpeg',
      0.95,
    ),
  );
  return new File([blob], `quote-${Date.now()}.jpg`, { type: 'image/jpeg' });
}
