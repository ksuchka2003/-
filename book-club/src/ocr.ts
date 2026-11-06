import type { Worker as OcrWorker } from 'tesseract.js';
export function validatePhoto(file: File) {
  if (!/^image\/(jpeg|png|webp|bmp)$/i.test(file.type))
    throw new Error(
      'Выберите фотографию JPG, PNG или WebP. Если снимок HEIC не открывается, сохраните его как JPG.',
    );
  if (file.size > 15 * 1024 * 1024)
    throw new Error('Фотография больше 15 МБ. Выберите снимок меньшего размера.');
  if (!file.size) throw new Error('Фотография пуста');
}
export function cleanOcrText(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/([^\s])-[ \t]*\n[ \t]*([а-яёa-z])/gi, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
async function preparePhoto(file: File): Promise<File | Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error('Не удалось открыть снимок. Попробуйте сохранить его как JPG.'));
      image.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > 64000000)
      throw new Error('Снимок слишком большой. Выберите меньший фрагмент страницы.');
    const scale = Math.min(1, 2600 / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не смог обработать фотографию');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось подготовить фото'))),
        'image/jpeg',
        0.95,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function createPhotoReader(baseUrl: string, progress: (value: number) => void) {
  let worker: OcrWorker | undefined;
  let cancelled = false;
  return {
    async recognize(file: File) {
      validatePhoto(file);
      const image = await preparePhoto(file);
      const { createWorker, OEM } = await import('tesseract.js');
      if (cancelled) throw new DOMException('Распознавание отменено', 'AbortError');
      const base = new URL('ocr/', baseUrl).href;
      const ready = await createWorker(['rus', 'eng'], OEM.LSTM_ONLY, {
        workerPath: base + 'worker.min.js',
        corePath: base,
        langPath: base.replace(/\/$/, ''),
        workerBlobURL: false,
        logger: (m) => {
          if (!cancelled)
            progress(m.status === 'recognizing text' ? Math.round(m.progress * 100) : 0);
        },
      });
      worker = ready;
      try {
        if (cancelled) throw new DOMException('Распознавание отменено', 'AbortError');
        const result = await ready.recognize(image);
        const text = cleanOcrText(result.data.text);
        if (!text)
          throw new Error(
            'Текст не найден. Снимите страницу ровнее, при хорошем освещении, или введите цитату вручную.',
          );
        if (text.length > 20000)
          throw new Error(
            'На снимке слишком много текста. Сфотографируйте только нужный фрагмент.',
          );
        return text;
      } finally {
        worker = undefined;
        await ready.terminate();
      }
    },
    cancel() {
      cancelled = true;
      void worker?.terminate();
      worker = undefined;
    },
  };
}
