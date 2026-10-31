import { useEffect, useState, Component, type ReactNode } from 'react';
import { NavLink, Route, Routes, Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookOpen,
  Home as HomeIcon,
  Library,
  Quote,
  Users,
  CalendarDays,
  UserRound,
  Settings2,
  CloudOff,
  RefreshCw,
  Check,
  ArrowLeft,
  Menu,
} from 'lucide-react';
import { authenticate, configured, currentIdentity, flushQueue, type Identity } from '../cloud';
import { getDB, openLibrary, purgeTrash } from '../db';
import { initializeTelegram, initData, registerBack } from '../telegram';
import { setSyncScope } from '../local';
import { accountSync } from '../accountSync';
import type { LibrarySyncState } from '../privateTypes';
import { message } from '../domain';
import { Session, Loading, Modal } from './shared';
import { Home, Club, ClubDetail } from './Club';
import { MyBooks } from './Books';
import { Quotes } from './Quotes';
import { Members, MemberDetail } from './Social';
import { Meetings } from './Meetings';
import { Profile } from './Profile';
import { Admin } from './Admin';
class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main>
        <h1>Не удалось открыть приложение</h1>
        <p>
          Проверьте, что браузер разрешает IndexedDB, и перезагрузите страницу. Личные данные не
          удаляются.
        </p>
        <button onClick={() => location.reload()}>Перезагрузить</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
const navigation = [
  ['/', 'Главная', HomeIcon],
  ['/club', 'Клуб', Library],
  ['/books', 'Мои книги', BookOpen],
  ['/quotes', 'Цитаты', Quote],
  ['/members', 'Участники', Users],
  ['/meetings', 'Встречи', CalendarDays],
  ['/profile', 'Профиль', UserRound],
] as const;
function Shell({
  identity,
  error,
  onRetry,
}: {
  identity: Identity | null;
  error: string;
  onRetry: () => void;
}) {
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const query = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  const back = () => {
    if (Number(window.history.state?.idx || 0) > 0) navigate(-1);
    else
      navigate(
        location.pathname.startsWith('/members/')
          ? '/members'
          : location.pathname.startsWith('/club/')
            ? '/club'
            : '/',
      );
  };
  useEffect(
    () => (location.pathname === '/' ? undefined : registerBack(back)),
    [location.pathname, location.key],
  );
  const pending = useLiveQuery(() => getDB().sync_queue.toArray()) || [];
  const ownPending = pending.filter((x) => x.scope === identity?.id);
  const libraryState = useLiveQuery(() => getDB().settings.get('_librarySync'))?.value as
    LibrarySyncState | undefined;
  const sync = async () => {
    const db = getDB();
    try {
      if (identity) await accountSync().sync();
      await flushQueue();
      if (identity) await query.invalidateQueries({ queryKey: ['cloud'] });
    } catch (error) {
      if (db.isOpen())
        await db.settings.put({
          key: '_librarySync',
          value: { phase: 'error', lastSynced: null, conflicts: 0, error: message(error) },
        });
    }
  };
  useEffect(() => {
    if (!identity) return;
    let timeout: ReturnType<typeof setTimeout>;
    const subscription = accountSync().watch(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => void sync(), 600);
    });
    const visible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
    };
  }, [identity?.id]);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void sync();
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const timer = setInterval(() => {
      if (navigator.onLine) void sync();
    }, 30000);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      clearInterval(timer);
    };
  }, [identity?.id]);
  useEffect(() => {
    if (ownPending.length && online) {
      const t = setTimeout(() => void sync(), 500);
      return () => clearTimeout(t);
    }
  }, [ownPending.map((x) => x.revision).join(','), online]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <Session.Provider value={{ identity, error, notify: setToast, retryLogin: onRetry }}>
      <div className="app-shell">
        <aside className="sidebar">
          <Link className="brand" to="/">
            <span>
              <BookOpen size={26} />
            </span>
            <div>
              между строк<small>КНИЖНЫЙ КЛУБ</small>
            </div>
          </Link>
          <nav>
            {navigation.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} end={to === '/'}>
                <Icon size={20} />
                <span>{label}</span>
              </NavLink>
            ))}
            {identity?.role === 'admin' && (
              <NavLink to="/admin">
                <Settings2 size={20} />
                <span>Управление</span>
              </NavLink>
            )}
          </nav>
          <div className="sidebar-footer">
            <span className="status-dot" />
            {identity ? 'Закрытый клуб' : 'Личная библиотека'}
          </div>
        </aside>
        <div className="main-column">
          <header className="mobile-header">
            <Link className="brand" to="/">
              <BookOpen size={24} />
              <div>
                между строк<small>КНИЖНЫЙ КЛУБ</small>
              </div>
            </Link>
            {identity?.role === 'admin' && (
              <Link aria-label="Управление" to="/admin">
                <Settings2 size={21} />
              </Link>
            )}
          </header>
          <div
            className={`connection-bar ${!online || ownPending.length ? 'pending' : ''}`}
            role="status"
          >
            {!online ? (
              <>
                <CloudOff size={14} /> Нет сети · личные данные сохраняются
              </>
            ) : identity && libraryState?.phase === 'error' ? (
              <>
                <CloudOff size={14} /> Не удалось синхронизировать{' '}
                <button onClick={() => void sync()}>Повторить</button>
              </>
            ) : identity && (libraryState?.phase === 'syncing' || !libraryState?.lastSynced) ? (
              <>
                <RefreshCw size={14} /> Синхронизация…
              </>
            ) : identity && libraryState?.conflicts ? (
              <Link to="/profile">Есть изменения с другого устройства — открыть профиль</Link>
            ) : ownPending.length ? (
              <>
                <RefreshCw size={14} /> Ожидают подтверждения: {ownPending.length}
              </>
            ) : (
              <>
                <Check size={14} />
                {identity ? 'Синхронизировано' : 'Только на этом устройстве'}
              </>
            )}
            {identity && ownPending.length > 0 && (
              <button onClick={() => void sync()}>Повторить</button>
            )}
            {configured && !identity && initData() && (
              <button onClick={onRetry}>Повторить вход</button>
            )}
          </div>
          {ownPending.find((x) => x.error) && (
            <p className="sync-error" role="alert">
              {ownPending.find((x) => x.error)?.error}. Изменения остаются в очереди.
            </p>
          )}
          <main>
            {location.pathname !== '/' && (
              <button className="page-back" onClick={back}>
                <ArrowLeft size={18} /> Назад
              </button>
            )}
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/club" element={<Club />} />
              <Route path="/club/:id" element={<ClubDetail />} />
              <Route path="/books" element={<MyBooks />} />
              <Route path="/quotes" element={<Quotes />} />
              <Route path="/members" element={<Members />} />
              <Route path="/members/:id" element={<MemberDetail />} />
              <Route path="/meetings" element={<Meetings />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/admin" element={<Admin />} />
              <Route
                path="*"
                element={
                  <div className="empty">
                    <h1>Страница не найдена</h1>
                    <Link to="/">На главную</Link>
                  </div>
                }
              />
            </Routes>
          </main>
        </div>
        <nav className="bottom-nav">
          {navigation.slice(0, 4).map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
          <button
            className={
              ['/members', '/meetings', '/profile', '/admin'].some((p) =>
                location.pathname.startsWith(p),
              )
                ? 'active'
                : ''
            }
            onClick={() => setMore(true)}
          >
            <Menu size={20} />
            <span>Ещё</span>
          </button>
        </nav>
        {more && (
          <Modal title="Разделы клуба" onClose={() => setMore(false)}>
            <nav className="more-menu">
              {navigation.slice(4).map(([to, label, Icon]) => (
                <Link to={to} key={to} onClick={() => setMore(false)}>
                  <Icon size={22} />
                  {label}
                </Link>
              ))}
              {identity?.role === 'admin' && (
                <Link to="/admin" onClick={() => setMore(false)}>
                  <Settings2 size={22} />
                  Управление клубом
                </Link>
              )}
            </nav>
          </Modal>
        )}
        {toast && (
          <div className="toast" role="status">
            <Check size={18} />
            {toast}
          </div>
        )}
      </div>
    </Session.Provider>
  );
}
function Bootstrap() {
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [localMode, setLocalMode] = useState(false);
  useEffect(() => {
    const cleanup = initializeTelegram();
    let active = true;
    setReady(false);
    (async () => {
      let who = currentIdentity();
      try {
        if (configured && initData()) who = await authenticate();
        else if (configured)
          setError('Для доступа к клубу откройте приложение через вашего Telegram-бота.');
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Ошибка входа');
        who = null;
      }
      if (!active) return;
      openLibrary(who?.id || 'local');
      setSyncScope(who?.id || 'local');
      setIdentity(who);
      try {
        await purgeTrash();
      } catch {
        if (active)
          setError('Браузер не разрешил локальное хранилище. Проверьте настройки приватности.');
      }
      if (who && active) {
        try {
          await accountSync().sync();
        } catch {
          /* The local copy remains available; sync status shows the failure. */
        }
      }
      if (active) setReady(true);
    })();
    return () => {
      active = false;
      cleanup();
    };
  }, [attempt]);
  const retry = () => {
    setLocalMode(false);
    setError('');
    setAttempt((a) => a + 1);
  };
  if (ready && !identity && (configured || initData()) && !localMode)
    return (
      <main className="login-screen">
        <BookOpen size={32} />
        <h1>Вход в книжный клуб</h1>
        <p>{error || 'Подключение к клубу ещё не настроено.'}</p>
        <button className="primary" onClick={retry}>
          Повторить вход
        </button>
        <button onClick={() => setLocalMode(true)}>Открыть локальную библиотеку</button>
        <small>В локальном режиме данные доступны только на этом устройстве.</small>
      </main>
    );
  return ready ? (
    <Shell identity={identity} error={error} onRetry={retry} />
  ) : (
    <main>
      <Loading />
    </main>
  );
}
export function App() {
  return (
    <Boundary>
      <Bootstrap />
    </Boundary>
  );
}
