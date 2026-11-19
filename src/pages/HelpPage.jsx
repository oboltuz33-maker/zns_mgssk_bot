import { APPLICATION_STATUS } from '../data/model.js';
import { Badge, DataStatus, PageHeader } from '../components.jsx';
import { ENV_LABEL } from '../config.js';

// Что означает каждый статус заявки — для перевозчика
const STATUS_HELP = [
  { status: APPLICATION_STATUS.new, tone: 'accent', text: 'заявка отправлена; пока она в этом статусе, её можно изменить или удалить' },
  { status: APPLICATION_STATUS.inProgress, tone: 'warning', text: 'оформитель взял заявку в работу — изменить её уже нельзя' },
  { status: APPLICATION_STATUS.done, tone: 'success', text: 'перевозка оформлена' },
  { status: APPLICATION_STATUS.rejected, tone: 'danger', text: 'заявку нельзя выполнить — причина указана в заявке и в сообщении бота' },
  { status: APPLICATION_STATUS.archived, tone: 'muted', text: 'заявка перенесена в архив' },
];

// Раздел «Помощь»: как пользоваться приложением, версия и служебная информация
export function HelpPage({ model, me, sheets, user }) {
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
            <li>
              Выберите соревнование, затем участников — у каждого отметьте его оружие. Выбрать можно только оружие,
              закреплённое за спортсменом; закрепляет его администратор.
            </li>
            <li>
              На проверке выберите транспорт и отправьте заявку. Сроки перевозки ставятся сами: за день до начала
              соревнования и через день после окончания. Если соревнование помечено «Одним днём», выберите день
              перевозки из периода соревнования — без него заявку не отправить. Незаконченную заявку можно продолжить
              позже.
            </li>
          </ol>
        ) : (
          <p className="item-row">
            Создавать заявки могут только перевозчики. Заявки, в которые вас включили, видны в разделе «Заявки» —
            только для просмотра.
          </p>
        )}
        {me?.isCarrier && (
          <div className="item-hint">
            Заявки других перевозчиков, в которые включили вас, — в «Заявках», в блоке «Заявки с моим участием».
          </div>
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
          Когда статус меняется, бот присылает сообщение в Telegram. Администраторам бот сообщает о каждой новой заявке.
          Отключить сообщения о заявках можно в профиле (👤).
        </div>
      </div>

      {me?.isAdmin && (
        <div className="card item-card">
          <div className="section-label">Вход новых пользователей</div>
          <p className="item-row">
            Когда человек делится номером телефона, бот присылает администраторам сообщение. «❗ Требуется ваше
            участие» — без вас он не войдёт: новая заявка на доступ, такие ФИО уже есть в списке, номер привязан к
            другому аккаунту Telegram, запись ждёт подтверждения или доступ закрыт. «ℹ️ Для сведения» — внесённый
            заранее спортсмен вошёл и подтверждён автоматически. Эти сообщения отключить нельзя.
          </p>
          <div className="item-hint">
            Подтвердить в приложении можно только того, кто уже входил. Внесённый заранее подтверждается сам, когда
            войдёт по номеру телефона. Нового спортсмена можно добавить кнопкой «＋ Новый спортсмен» во вкладке
            «Спортсмены» — со статусом «Добавлен вручную».
          </div>
        </div>
      )}

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
