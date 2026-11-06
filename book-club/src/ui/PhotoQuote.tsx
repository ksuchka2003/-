import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus } from 'lucide-react';
import { createPhotoReader, validatePhoto } from '../ocr';
import { message } from '../domain';
import { ErrorNote } from './shared';
export function PhotoQuote({
  onText,
  onBusy,
}: {
  onText: (text: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  const job = useRef<ReturnType<typeof createPhotoReader> | null>(null);
  const generation = useRef(0);
  const status = useRef(onBusy);
  status.current = onBusy;
  useEffect(
    () => () => {
      generation.current++;
      job.current?.cancel();
      status.current(false);
    },
    [],
  );
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const cancel = () => {
    generation.current++;
    job.current?.cancel();
    job.current = null;
    setBusy(false);
    status.current(false);
  };
  const select = (selected?: File) => {
    setError('');
    if (!selected) return;
    try {
      validatePhoto(selected);
      setFile(selected);
    } catch (e) {
      setError(message(e));
    }
  };
  const recognize = async () => {
    if (!file) return;
    const current = ++generation.current;
    setError('');
    setPercent(0);
    setBusy(true);
    status.current(true);
    const reader = createPhotoReader(
      new URL(import.meta.env.BASE_URL, location.href).href,
      setPercent,
    );
    job.current = reader;
    const timeout = setTimeout(() => {
      if (generation.current === current) {
        cancel();
        setError('Распознавание заняло слишком долго. Попробуйте снимок меньшего фрагмента.');
      }
    }, 120000);
    try {
      const text = await reader.recognize(file);
      if (current === generation.current) {
        onText(text);
        setFile(null);
      }
    } catch (e) {
      if (current === generation.current) setError(message(e));
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) {
        job.current = null;
        setBusy(false);
        status.current(false);
      }
    }
  };
  return (
    <section className="photo-quote" aria-label="Цитата с фотографии">
      <div className="actions">
        <label className={`button ${busy ? 'disabled' : ''}`}>
          <Camera size={17} />
          Сфотографировать
          <input
            className="file-input"
            aria-label="Сфотографировать цитату"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={busy}
            onChange={(e) => {
              select(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <label className={`button ${busy ? 'disabled' : ''}`}>
          <ImagePlus size={17} />
          Из галереи
          <input
            className="file-input"
            aria-label="Выбрать фото цитаты"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              select(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {preview && (
        <>
          <img
            className="quote-photo-preview"
            src={preview}
            alt="Фотография для распознавания цитаты"
          />
          {busy ? (
            <>
              <p role="status">
                {percent ? `Распознаём текст: ${percent}%` : 'Подготавливаем распознавание…'}
              </p>
              <button type="button" onClick={cancel}>
                Отменить распознавание
              </button>
            </>
          ) : (
            <div className="actions">
              <button type="button" onClick={() => void recognize()}>
                Распознать текст
              </button>
              <button type="button" onClick={() => setFile(null)}>
                Убрать фото
              </button>
            </div>
          )}
          <p className="muted">
            Фото обрабатывается на устройстве. При первом запуске загрузятся файлы распознавания.
            Проверьте текст перед сохранением.
          </p>
        </>
      )}
      <ErrorNote text={error} />
    </section>
  );
}
