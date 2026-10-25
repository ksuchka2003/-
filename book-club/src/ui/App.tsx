import { useEffect, useState, Component, type ReactNode } from 'react';
import { NavLink, Route, Routes, Link, useLocation } from 'react-router-dom';
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
  Feather,
} from 'lucide-react';
import { authenticate, configured, currentIdentity, flushQueue, type Identity } from '../cloud';
import { getDB, openLibrary, purgeTrash } from '../db';
import { initializeTelegram, initData } from '../telegram';
import { setSyncScope } from '../local';
import { Session, Loading } from './shared';
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
  const pending = useLiveQuery(() => getDB().sync_queue.toArray()) || [];
  const ownPending = pending.filter((x) => x.scope === identity?.id);
  const sync = async () => {
    await flushQueue();
    if (identity) await query.invalidateQueries({ queryKey: ['cloud'] });
  };
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
    <Session.Provider value={{ identity, error, notify: setToast }}>
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
          <p className="nav-label">НАШЕ ПРОСТРАНСТВО</p>
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
          <div className="sidebar-note">
            <Feather size={25} />
            <p>
              Хорошие книги
              <br />
              лучше читать вместе.
            </p>
            <small>
              Маленький клуб.
              <br />
              Большие истории.
            </small>
          </div>
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
            ) : ownPending.length ? (
              <>
                <RefreshCw size={14} /> Ожидают подтверждения: {ownPending.length}
              </>
            ) : (
              <>
                <Check size={14} />
                {identity ? 'Публикации синхронизированы' : 'Сохраняется только на устройстве'}
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
            <footer className="page-footer">
              Между строк <span>·</span> Пространство для книг и людей
            </footer>
          </main>
        </div>
        <nav className="bottom-nav">
          {navigation.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
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
        setError(e instanceof Error ? e.message : 'Ошибка входа');
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
      if (active) setReady(true);
    })();
    return () => {
      active = false;
      cleanup();
    };
  }, [attempt]);
  return ready ? (
    <Shell
      identity={identity}
      error={error}
      onRetry={() => {
        setError('');
        setAttempt((a) => a + 1);
      }}
    />
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
