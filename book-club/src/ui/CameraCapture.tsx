import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus } from 'lucide-react';
import { cameraError, createCameraSession, takePhoto } from '../camera';
import { message } from '../domain';
import { ErrorNote } from './shared';

export function CameraCapture({
  onPhoto,
  onClose,
  onNative,
  onGallery,
}: {
  onPhoto: (file: File) => void;
  onClose: () => void;
  onNative: () => void;
  onGallery: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const current = useRef<ReturnType<typeof createCameraSession> | null>(null);
  const active = useRef(false);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    active.current = true;
    let mounted = true;
    const session = createCameraSession();
    current.current = session;
    const fail = (text: string) => {
      if (!mounted || !active.current) return;
      clearTimeout(timer);
      session.stop();
      setReady(false);
      setError(text);
    };
    const timer = setTimeout(
      () => fail('Камера не ответила. Проверьте запрос разрешения или откройте системную камеру.'),
      25000,
    );
    const element = video.current;
    const loaded = () => {
      if (!mounted || !active.current) return;
      clearTimeout(timer);
      setReady(true);
    };
    element?.addEventListener('loadeddata', loaded);
    void session
      .start()
      .then(async (stream) => {
        if (!mounted || !active.current) return;
        for (const track of stream.getVideoTracks())
          track.addEventListener(
            'ended',
            () => fail('Доступ к камере прерван. Откройте съёмку заново.'),
            { once: true },
          );
        if (!element) {
          session.stop();
          return;
        }
        element.srcObject = stream;
        try {
          await element.play();
        } catch (e) {
          fail(cameraError(e));
        }
      })
      .catch((e) => fail(cameraError(e)));
    const hide = () => {
      active.current = false;
      session.stop();
      closeCallback.current();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') hide();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    return () => {
      mounted = false;
      active.current = false;
      clearTimeout(timer);
      session.stop();
      if (element) {
        element.srcObject = null;
        element.removeEventListener('loadeddata', loaded);
      }
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
    };
  }, []);
  const close = () => {
    active.current = false;
    current.current?.stop();
  };
  return (
    <div className="camera-capture" role="group" aria-label="Камера для цитаты">
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        aria-label="Предпросмотр камеры"
        hidden={!!error}
      />
      {!ready && !error && (
        <p role="status">Открываем камеру… Разрешите доступ, если появится запрос.</p>
      )}
      <ErrorNote text={error} />
      <div className="actions">
        {!error && (
          <button
            className="primary"
            type="button"
            disabled={!ready || taking}
            onClick={async () => {
              if (!video.current) return;
              setTaking(true);
              try {
                const file = await takePhoto(video.current);
                if (active.current) {
                  close();
                  onPhoto(file);
                }
              } catch (e) {
                if (active.current) setError(message(e));
                current.current?.stop();
              } finally {
                if (active.current) setTaking(false);
              }
            }}
          >
            <Camera size={17} />
            Сделать снимок
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            close();
            onClose();
          }}
        >
          Отменить съёмку
        </button>
      </div>
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            close();
            onNative();
          }}
        >
          Системная камера
        </button>
        <button
          type="button"
          onClick={() => {
            close();
            onGallery();
          }}
        >
          <ImagePlus size={17} />
          Из галереи
        </button>
      </div>
    </div>
  );
}
