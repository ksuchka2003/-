import type { Book } from './domain';
export function validateCover(file: File) {
  if (!/^image\/(jpeg|png|webp|bmp)$/i.test(file.type))
    throw new Error('Выберите обложку JPG, PNG или WebP.');
  if (!file.size) throw new Error('Картинка пуста');
  if (file.size > 15 * 1024 * 1024)
    throw new Error('Картинка больше 15 МБ. Выберите меньший файл.');
}
export const bookCover = (book: Pick<Book, 'cover' | 'coverData'> | undefined, fallback = '') =>
  book?.coverData || book?.cover || fallback;
export async function prepareCover(file: File): Promise<string> {
  validateCover(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error('Не удалось открыть обложку. Выберите JPG, PNG или WebP.'));
      image.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > 64000000)
      throw new Error('Изображение слишком большое. Выберите фото меньшего размера.');
    for (const edge of [900, 720, 560, 420]) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Не удалось подготовить обложку');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.55, 0.4]) {
        const data = canvas.toDataURL('image/jpeg', quality);
        if (data.length <= 60000) return data;
      }
    }
    throw new Error('Не удалось уменьшить обложку. Выберите более простое изображение.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
