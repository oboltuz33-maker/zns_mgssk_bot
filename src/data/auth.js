import { postAction } from './api.js';

// Просит пользователя поделиться номером через Telegram. Возвращает подписанный ответ
// (строку для проверки на сервере) или null, если пользователь отказался.
export function requestContact() {
  return new Promise((resolve, reject) => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.isVersionAtLeast?.('6.9')) {
      reject(new Error('Ваша версия Telegram не умеет делиться номером — обновите приложение или введите ФИО'));
      return;
    }
    tg.requestContact((shared, event) => {
      if (!shared) resolve(null);
      else if (event?.response) resolve(event.response);
      else reject(new Error('Telegram не передал номер — попробуйте ещё раз'));
    });
  });
}

// Просит разрешить боту писать пользователю — без этого бот не сможет прислать уведомление
// (о подтверждении доступа, о смене статуса заявки), если человек ни разу не писал боту сам.
// Если разрешение уже есть, Telegram окно не показывает. Отказ не мешает работе приложения.
export function requestWriteAccess() {
  return new Promise((resolve) => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initData || !tg.isVersionAtLeast?.('6.9')) {
      resolve(false);
      return;
    }
    try {
      tg.requestWriteAccess((allowed) => resolve(Boolean(allowed)));
    } catch {
      resolve(false); // окно уже открыто или метод недоступен
    }
  });
}

// Привязка к спортсмену, которого администратор уже внёс в таблицу с этим номером
export const linkPhone = (contact) => postAction('linkPhone', { contact });

// Заявка на доступ по ФИО — ждёт подтверждения администратором
export const register = ({ lastName, firstName, middleName }, contact) =>
  postAction('register', { lastName, firstName, middleName, contact });
