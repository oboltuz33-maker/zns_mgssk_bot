import { APPLICATION_STATUS } from '../data/model.js';
import { Badge, DataStatus, PageHeader } from '../components.jsx';
import { ENV_LABEL } from '../config.js';

// Что означает каждый статус заявки — для перевозчика
const STATUS_HELP = [
  { status: APPLICATION_STATUS.new, tone: 'accent', text: 'заявка отправлена; пока она в этом статусе, её можно изменить или удалить' },
  { status: APPLICATION_STATUS.inProgress, tone: 'warning', text: 'оформитель взял заявку в работу — изменить её уже нельзя' },
  { status: APPLICATION_STATUS.done, tone: 'success', text: 'перевозка оформлена' },
  { status: APPLICATION_STATUS.archived, tone: 'muted', text: 'заявка перенесена в архив' },
];

// Раздел «Помощь»: как пользоваться приложением, версия и служебная информация
export function HelpPage({ model, me, sheets, user, telegramStatus }) {
  return (
    <>
      <PageHeader title="Помощь" subtitle="ДОСААФ МГССК" />

      <div className="card item-card">
        <div className="section-label">Как подать заявку на перевозку</div>
        {me?.isCarrier ? (
          <ol className="help-list">
            <li>
              Откройте «Заявки» и нажмите «＋ Новая заявка» — или «Подать заявку» в карточке соревнования.
            </li>
            <li>Выберите соревнование, затем участников — у каждого отметьте его оружие.</li>
            <li>
              На проверке выберите транспорт и отправьте заявку. Сроки перевозки ставятся сами: за день до начала
              соревнования и через день после окончания. Незаконченную заявку можно продолжить позже.
            </li>
          </ol>
        ) : (
          <p className="item-row">
            Создавать заявки могут только перевозчики. Вас могут включить в заявку перевозчики клуба.
          </p>
        )}
      </div>

      <div className="card item-card">
        <div className="section-label">Статусы заявки</div>
        {STATUS_HELP.map((s) => (
          <div key={s.status} className="item-row">
            <Badge tone={s.tone}>{s.status}</Badge> — {s.text}
          </div>
        ))}
        <div className="item-hint">
          Когда статус меняется, бот присылает сообщение в Telegram. Перевозчик может отключить такие сообщения в профиле (👤).
        </div>
      </div>

      <div className="card item-card">
        <div className="section-label">Если что-то не так</div>
        <p className="item-row">
          Нажмите «🔄 Обновить» ниже — данные подгрузятся из таблицы заново (сами они
          обновляются при каждом открытии приложения). Если не помогло, обратитесь к
          администратору и сообщите версию приложения и ваш Telegram ID (они ниже).
        </p>
        <div className="help-refresh">
          <DataStatus sheets={sheets} />
        </div>
      </div>

      <div className="card item-card">
        <div className="section-label">О приложении</div>
        <div className="item-row">
          Версия от {__BUILD_TIME__}
          {ENV_LABEL && <> · <Badge tone="warning">{ENV_LABEL}</Badge></>}
        </div>
        {me && <div className="item-row">Спортсмен: {me.fullName}</div>}
        {user && (
          <div className="item-row">
            Telegram ID: <code>{user.id}</code>
          </div>
        )}
        <div className="item-hint">{telegramStatus}</div>
        {Object.keys(model.skipped).length > 0 && (
          <div className="item-hint">
            Пропущены строки без ID:{' '}
            {Object.entries(model.skipped)
              .map(([sheet, count]) => `${sheet} — ${count}`)
              .join(', ')}
          </div>
        )}
      </div>

    </>
  );
}
