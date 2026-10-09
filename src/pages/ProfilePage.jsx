import { useState } from 'react';
import { postAction } from '../data/api.js';
import { withAthleteFields } from '../data/patches.js';
import { EmptyState, PageHeader } from '../components.jsx';
import { AthleteStatus } from './AthletesPage.jsx';

// Настройки уведомлений перевозчика: ключ — как в запросе setNotifications и в NOTIFY_COLUMN (data/model.js)
const NOTIFICATIONS = [
  { key: 'competitions', field: 'notifyCompetitions', label: 'О новых соревнованиях' },
  { key: 'applications', field: 'notifyApplications', label: 'Об изменении статуса заявок' },
];

// 79001234567 → +7 900 123-45-67
const formatPhone = (phone) => {
  const m = String(phone).replace(/\D/g, '').match(/^7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
};

// Раздел «Профиль»: данные спортсмена (только просмотр — меняет администратор) и настройки уведомлений перевозчика
export function ProfilePage({ model, me, sheets, onOpenPage, onMessage }) {
  // Переключатель, который сейчас сохраняется: новое положение видно сразу, при ошибке — возвращается
  const [pending, setPending] = useState({});

  if (!me) return <EmptyState icon="👤" title="Спортсмен не определён" />;

  const settings = me.isCarrier ? NOTIFICATIONS.filter((n) => model.notificationSettings.includes(n.key)) : [];

  const toggle = async (setting) => {
    const value = !me[setting.field];
    setPending((p) => ({ ...p, [setting.key]: value }));
    try {
      const result = await postAction('setNotifications', { notifications: { [setting.key]: value } });
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось сохранить настройку');
      sheets.patch((data) => withAthleteFields(data, result.athleteId, result.fields));
    } catch (e) {
      console.error(e);
      onMessage(e.message || 'Ошибка сети');
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[setting.key];
        return next;
      });
    }
  };

  return (
    <>
      <PageHeader title="Профиль" />

      <div className="card item-card">
        <div className="section-label">Мои данные</div>
        <div className="item-title">{me.fullName}</div>
        {me.phone && <div className="item-row">📞 {formatPhone(me.phone)}</div>}
        <div className="item-tags">
          <AthleteStatus athlete={me} />
        </div>
        <div className="item-hint">Нашли ошибку в данных — сообщите администратору.</div>
      </div>

      {settings.length > 0 && (
        <div className="card item-card">
          <div className="section-label">Сообщения от бота</div>
          {settings.map((setting) => {
            const saving = setting.key in pending;
            const checked = saving ? pending[setting.key] : me[setting.field];
            return (
              <label key={setting.key} className="switch-row">
                <span>{setting.label}</span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={checked}
                  disabled={saving}
                  onChange={() => toggle(setting)}
                />
              </label>
            );
          })}
        </div>
      )}

      <button className="secondary-button wide-button" onClick={() => onOpenPage('help')}>
        ❓ Помощь
      </button>
    </>
  );
}
