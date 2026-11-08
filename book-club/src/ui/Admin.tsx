import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  CalendarDays,
  MessageSquarePlus,
  Users,
  Bell,
  ChevronRight,
  ArrowLeft,
  Plus,
} from 'lucide-react';
import type { ClubBook, Proposal, Meeting } from '../domain';
import { meetingEnd } from '../collection';
import {
  CloudGate,
  useSession,
  useCloud,
  BackLink,
  Empty,
  ErrorNote,
  Loading,
  useClock,
} from './shared';
import { AdminBooks, AdminProposals } from './AdminBooks';
import { AdminMembers, type ManagedMember } from './AdminMembers';
import { AdminNotifications } from './AdminNotifications';
import { MeetingEditor, meetingDateLabel } from './Meetings';

const sections = [
  { key: 'books', title: 'Книги клуба', description: 'Каталог и текущее чтение', icon: BookOpen },
  {
    key: 'meetings',
    title: 'Встречи',
    description: 'Дата, место и напоминания',
    icon: CalendarDays,
  },
  {
    key: 'proposals',
    title: 'Предложения книг',
    description: 'Книги от участников',
    icon: MessageSquarePlus,
  },
  { key: 'members', title: 'Участники', description: 'Приглашения и доступ в клуб', icon: Users },
  {
    key: 'notifications',
    title: 'Уведомления',
    description: 'Проверить отправки бота',
    icon: Bell,
  },
];

function AdminMeetings() {
  const meetings = useCloud<Meeting>('meetings');
  const clock = useClock();
  const [past, setPast] = useState(false);
  const [edit, setEdit] = useState<Meeting | true | null>(null);
  const listed = (meetings.data || [])
    .filter((m) =>
      past ? m.cancelled || meetingEnd(m) <= clock : !m.cancelled && meetingEnd(m) > clock,
    )
    .sort((a, b) =>
      past ? b.starts_at.localeCompare(a.starts_at) : a.starts_at.localeCompare(b.starts_at),
    );
  return (
    <>
      <div className="section-actions">
        <button className="primary" onClick={() => setEdit(true)}>
          <Plus size={18} />
          Создать встречу
        </button>
      </div>
      <div className="segmented" role="group" aria-label="Встречи в управлении">
        <button aria-pressed={!past} onClick={() => setPast(false)}>
          Предстоящие
        </button>
        <button aria-pressed={past} onClick={() => setPast(true)}>
          Прошедшие
        </button>
      </div>
      <ErrorNote text={meetings.error?.message} />
      {meetings.isLoading ? (
        <Loading label="Загружаем встречи…" />
      ) : (
        !meetings.error &&
        (!listed.length ? (
          <Empty title={past ? 'Прошедших встреч нет' : 'Предстоящих встреч пока нет'} />
        ) : (
          <div className="stack admin-list">
            {listed.map((m) => (
              <button
                className="management-row"
                key={m.id}
                aria-label={`Изменить встречу: ${m.title}`}
                onClick={() => setEdit(m)}
              >
                <CalendarDays size={22} />
                <span>
                  <b>{m.title}</b>
                  <small>{meetingDateLabel(m.starts_at)}</small>
                  {m.place && <small>{m.place}</small>}
                  {m.cancelled && <small>Отменена</small>}
                </span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        ))
      )}
      {edit && (
        <MeetingEditor meeting={edit === true ? undefined : edit} onClose={() => setEdit(null)} />
      )}
    </>
  );
}

export function Admin() {
  const { identity } = useSession();
  const [params] = useSearchParams();
  const section = sections.find((s) => s.key === params.get('section'));
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [section?.key]);
  const dashboard = !section && identity?.role === 'admin';
  const books = useCloud<ClubBook>('club_books', dashboard);
  const proposals = useCloud<Proposal>('book_proposals', dashboard);
  const members = useCloud<ManagedMember>('visible_club_members', dashboard);
  const meetings = useCloud<Meeting>('meetings', dashboard);
  const clock = useClock();
  if (identity?.role !== 'admin')
    return (
      <CloudGate>
        <Empty title="Раздел администратора" />
      </CloudGate>
    );
  const counts: Record<string, number | undefined> = {
    books: books.data?.length,
    meetings: meetings.data?.filter((m) => !m.cancelled && meetingEnd(m) > clock).length,
    proposals: proposals.data?.filter((p) => p.status === 'pending').length,
    members: members.data?.filter((m) => m.active).length,
  };
  return (
    <div className="management-page">
      <div className="page-heading with-back">
        {section ? (
          <Link className="detail-back" aria-label="К управлению клубом" to="/admin">
            <ArrowLeft size={21} />
          </Link>
        ) : (
          <BackLink fallback="/profile" />
        )}
        <h1>{section?.title || 'Управление'}</h1>
      </div>
      {!section ? (
        <>
          <nav className="management-menu" aria-label="Разделы управления">
            {sections.map(({ key, title, description, icon: Icon }) => (
              <Link className="management-row" to={`/admin?section=${key}`} key={key}>
                <span className="management-symbol">
                  <Icon size={22} />
                </span>
                <span>
                  <b>{title}</b>
                  <small>{description}</small>
                </span>
                {counts[key] !== undefined && (
                  <span
                    className={`management-count ${key === 'proposals' && counts[key] ? 'has-pending' : ''}`}
                  >
                    {counts[key]}
                  </span>
                )}
                <ChevronRight size={18} />
              </Link>
            ))}
          </nav>
          <ErrorNote
            text={
              books.error?.message ||
              proposals.error?.message ||
              members.error?.message ||
              meetings.error?.message
            }
          />
        </>
      ) : (
        <section className="management-section" aria-label={section.title} key={section.key}>
          {section.key === 'books' && <AdminBooks />}
          {section.key === 'meetings' && <AdminMeetings />}
          {section.key === 'proposals' && <AdminProposals />}
          {section.key === 'members' && <AdminMembers />}
          {section.key === 'notifications' && <AdminNotifications />}
        </section>
      )}
    </div>
  );
}
