import { competitionStatus, findMyAthlete } from '../data/model.js';
import { EmptyState, PageHeader } from '../components.jsx';
import { SheetBrowser } from '../SheetBrowser.jsx';
import { CompetitionCard } from './CompetitionsPage.jsx';
import { AthleteStatus, WeaponList } from './AthletesPage.jsx';

const UPCOMING_ON_HOME = 3;

export function HomePage({ user, model, sheets, telegramStatus, onOpenPage, onRecheckTelegram }) {
  const me = findMyAthlete(model, user);
  const upcoming = model.competitions.filter((c) => competitionStatus(c) !== 'past');

  const stats = [
    { page: 'competitions', icon: '🏆', value: upcoming.length, label: 'предстоящих соревнований' },
    { page: 'athletes', icon: '👤', value: model.athletes.length, label: 'спортсменов' },
    { page: 'weapons', icon: '🎯', value: model.weapons.length, label: 'единиц оружия' },
    { page: 'applications', icon: '📝', value: model.applications.length, label: 'заявок' },
  ];

  return (
    <>
      <PageHeader title={me?.greetingName ? `Здравствуйте, ${me.greetingName}!` : 'ZNS Mini App'} subtitle="ДОСААФ МГССК" />

      {me && (
        <div className="card item-card">
          <div className="section-label">Мой профиль</div>
          <div className="item-title">{me.fullName}</div>
          <div className="item-tags">
            <AthleteStatus athlete={me} />
          </div>
          <WeaponList weapons={me.weapons} />
        </div>
      )}
      {user && !me && sheets.data && (
        <div className="card item-card">
          <div className="section-label">Мой профиль</div>
          <div className="item-hint">
            Вы не найдены среди спортсменов. Для привязки укажите в таблице ChatId <code>{user.id}</code>
          </div>
        </div>
      )}

      <div className="stats">
        {stats.map((s) => (
          <button key={s.page} className="stat" onClick={() => onOpenPage(s.page)}>
            <span className="stat-icon">{s.icon}</span>
            <span className="stat-value">{s.value}</span>
            <span className="stat-label">{s.label}</span>
          </button>
        ))}
      </div>

      <h2 className="section-title">Ближайшие соревнования</h2>
      {upcoming.length === 0 ? (
        <EmptyState icon="🏆" title="Нет предстоящих соревнований" />
      ) : (
        upcoming.slice(0, UPCOMING_ON_HOME).map((c) => <CompetitionCard key={c.id} competition={c} />)
      )}

      <details className="service">
        <summary>Служебная информация</summary>
        <p className="status">
          <b>Telegram:</b> {telegramStatus}
        </p>
        {Object.keys(model.skipped).length > 0 && (
          <p className="status">
            <b>Пропущены строки без ID:</b>{' '}
            {Object.entries(model.skipped)
              .map(([sheet, count]) => `${sheet} — ${count}`)
              .join(', ')}
          </p>
        )}
        {!user && (
          <button className="secondary-button" onClick={onRecheckTelegram}>
            🔄 Перепроверить окружение
          </button>
        )}
        <h2 className="section-title">Листы таблицы</h2>
        <SheetBrowser data={sheets.data} />
      </details>
    </>
  );
}
