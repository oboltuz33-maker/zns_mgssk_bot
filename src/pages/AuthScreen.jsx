import { useState } from 'react';
import { linkPhone, register, requestContact, requestWriteAccess } from '../data/auth.js';
import { EmptyState } from '../components.jsx';

// Экран входа для пользователя, у которого нет доступа к данным.
// reason (из ответа Apps Script): unregistered → привязка по телефону или заявка по ФИО;
// pending → ждём администратора; expired → переоткрыть приложение; forbidden / no-telegram → только сообщение.
export function AuthScreen({ access, user, onAccessGranted }) {
  // step: start | form | pending | expired | denied
  const [step, setStep] = useState(() => {
    if (access.reason === 'unregistered') return 'start';
    if (access.reason === 'pending') return 'pending';
    if (access.reason === 'expired') return 'expired';
    return 'denied';
  });
  const [message, setMessage] = useState(access.message);
  const [deniedTitle, setDeniedTitle] = useState('Нет доступа');
  const [contact, setContact] = useState(null); // подписанный номер, если пользователь им поделился
  const [form, setForm] = useState({ lastName: '', firstName: '', middleName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Общая обработка ответа Apps Script на привязку или регистрацию
  const applyResult = (result) => {
    if (result.status === 'success') onAccessGranted();
    else if (result.status === 'pending') {
      setMessage(result.message);
      setStep('pending');
    } else if (result.status === 'not_found') setStep('form');
    else if (result.status === 'conflict' || result.status === 'forbidden') {
      setMessage(result.message);
      if (result.status === 'conflict') setDeniedTitle(result.title || 'Номер уже используется');
      setStep('denied');
    } else setError(result.message || 'Неизвестная ошибка');
  };

  const run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      console.error(e);
      setError(e.message || 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  const sharePhone = () =>
    run(async () => {
      const signed = await requestContact();
      if (!signed) {
        // Без номера дальше не пускаем: по нему спортсмен находится в списке, а без него появились бы дубли
        setError('Без номера телефона войти нельзя: по нему мы находим вас в списке спортсменов');
        return;
      }
      setContact(signed);
      // Сразу просим разрешить боту писать — чтобы он сообщил о подтверждении доступа
      await requestWriteAccess();
      applyResult(await linkPhone(signed));
    });

  const submitForm = (e) => {
    e.preventDefault();
    run(async () => applyResult(await register(form, contact)));
  };

  const field = (name, label, required) => (
    <label className="form-field">
      <span>
        {label}
        {required && ' *'}
      </span>
      <input
        className="sheet-search"
        value={form[name]}
        required={required}
        maxLength={100}
        autoComplete="off"
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      />
    </label>
  );

  const errorLine = error && <p className="sheet-error">{error}</p>;

  if (step === 'start') {
    return (
      <div className="auth">
        <EmptyState icon="👋" title="Здравствуйте!">
          Чтобы пользоваться приложением, поделитесь номером телефона — по нему мы найдём вас в списке
          спортсменов клуба.
        </EmptyState>
        <div className="auth-actions">
          <button className="primary-button" onClick={sharePhone} disabled={busy}>
            📱 Поделиться номером телефона
          </button>
        </div>
        {busy && <p className="sheet-meta auth-center">Проверяем…</p>}
        {errorLine}
      </div>
    );
  }

  if (step === 'form') {
    return (
      <form className="auth" onSubmit={submitForm}>
        <EmptyState icon="📝" title="Заявка на доступ">
          Ваш номер не найден в списке спортсменов. Укажите ФИО — администратор проверит и откроет доступ.
        </EmptyState>
        {field('lastName', 'Фамилия', true)}
        {field('firstName', 'Имя', true)}
        {field('middleName', 'Отчество')}
        <div className="auth-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Отправляем…' : 'Отправить заявку'}
          </button>
        </div>
        {errorLine}
      </form>
    );
  }

  if (step === 'pending') {
    return (
      <div className="auth">
        <EmptyState icon="⏳" title="Ожидает подтверждения">
          {message}. Доступ откроется, когда администратор подтвердит заявку.
        </EmptyState>
        <div className="auth-actions">
          <button className="primary-button" onClick={onAccessGranted}>
            🔄 Проверить снова
          </button>
        </div>
      </div>
    );
  }

  if (step === 'expired') {
    // Повторный запрос не поможет: новая подпись появится, только когда Telegram заново откроет приложение
    return (
      <div className="auth">
        <EmptyState icon="⏰" title="Сеанс устарел">
          Приложение открыто слишком давно. Закройте его и откройте заново.
        </EmptyState>
        {window.Telegram?.WebApp?.initData && (
          <div className="auth-actions">
            <button className="primary-button" onClick={() => window.Telegram.WebApp.close()}>
              Закрыть приложение
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="auth">
      <EmptyState icon="🔒" title={deniedTitle}>
        {message}
        {user && (
          <>
            <br />
            Ваш Telegram ID: <code>{user.id}</code>
          </>
        )}
      </EmptyState>
      {access.reason !== 'no-telegram' && (
        <div className="auth-actions">
          <button className="primary-button" onClick={onAccessGranted}>
            🔄 Повторить
          </button>
        </div>
      )}
    </div>
  );
}
