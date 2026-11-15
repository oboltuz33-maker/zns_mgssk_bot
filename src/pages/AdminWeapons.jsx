import { useState } from 'react';
import { SHEET } from '../config.js';
import { deleteWeapon, saveWeapon, weaponProblem } from '../data/admin.js';
import { withSheetRow, withoutWeapon } from '../data/patches.js';
import { fuzzySearch } from '../data/search.js';
import { EmptyState, SearchInput, ShowMore } from '../components.jsx';
import { ROW_HEIGHT, confirmAction, usePaged } from '../helpers.js';

const tg = () => window.Telegram?.WebApp;

// Вкладка «Оружие»: справочник — добавить, исправить название и номер, удалить (вместе с закреплениями).
// Закрепления за спортсменами — во вкладке «Спортсмены» (кнопка «🎯 Оружие»)
export function AdminWeapons({ model, sheets, onMessage }) {
  const [query, setQuery] = useState('');
  // Единица, которая сейчас правится: { id, title, number } (id пуст — новая)
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);

  const sorted = [...model.weapons].sort((a, b) => a.title.localeCompare(b.title, 'ru') || a.number.localeCompare(b.number, 'ru'));
  const list = fuzzySearch(sorted, query, (w) => `${w.title} ${w.number} ${w.owners.map((o) => o.fullName).join(' ')}`);
  const paged = usePaged(list, ROW_HEIGHT, query);

  const run = async (key, action) => {
    setBusy(key);
    try {
      const result = await action();
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось выполнить действие');
      tg()?.HapticFeedback?.notificationOccurred('success');
      return result;
    } catch (e) {
      console.error(e);
      onMessage(e.message || 'Ошибка сети');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const problem = weaponProblem(model, editing);
    if (problem) return onMessage(problem);
    const result = await run('save', () => saveWeapon(editing));
    if (!result) return;
    sheets.patch((data) => withSheetRow(data, SHEET.weapons, result.row));
    setEditing(null);
  };

  const remove = async (weapon) => {
    const owners = weapon.owners.map((o) => o.shortName).join(', ');
    const text =
      `Удалить ${weapon.title} ${weapon.number} из справочника?` +
      (owners ? ` Оно будет откреплено от: ${owners}.` : '') +
      ' В поданных заявках ничего не изменится.';
    if (!(await confirmAction(text))) return;
    if (await run(weapon.id, () => deleteWeapon(weapon.id))) sheets.patch((data) => withoutWeapon(data, weapon.id));
  };

  const form = editing && (
    <div className="card item-card">
      <div className="section-label">{editing.id ? 'Исправить единицу' : 'Новая единица'}</div>
      <label className="form-field">
        <span>Название *</span>
        <input
          className="sheet-search"
          value={editing.title}
          maxLength={200}
          autoComplete="off"
          onChange={(e) => setEditing({ ...editing, title: e.target.value })}
        />
      </label>
      <label className="form-field">
        <span>Номер *</span>
        <input
          className="sheet-search"
          value={editing.number}
          maxLength={100}
          autoComplete="off"
          onChange={(e) => setEditing({ ...editing, number: e.target.value })}
        />
      </label>
      {editing.id && <div className="item-hint">В поданных заявках оружие записано текстом — они не изменятся</div>}
      <div className="card-actions">
        <button className="primary-button" onClick={save} disabled={busy !== null}>
          {busy === 'save' ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button className="secondary-button" onClick={() => setEditing(null)} disabled={busy !== null}>
          Отмена
        </button>
      </div>
    </div>
  );

  return (
    <>
      {!editing && (
        <button className="primary-button wide-button" onClick={() => setEditing({ id: '', title: '', number: '' })}>
          ＋ Новая единица
        </button>
      )}
      {editing && !editing.id && form}

      <SearchInput value={query} onChange={setQuery} placeholder="Название, номер или владелец" />
      {list.length === 0 && <EmptyState icon="🎯" title={model.weapons.length ? 'Ничего не найдено' : 'Справочник пуст'} />}
      <div className="list">
        {paged.visible.map((w) =>
          editing?.id === w.id ? (
            <div key={w.id}>{form}</div>
          ) : (
            <div key={w.id} className="list-item">
              <div className="list-text">
                <div className="item-title">{w.title}</div>
                <div className="item-hint">
                  <code>{w.number}</code>
                  {w.owners.length > 0 && ` · ${w.owners.map((o) => o.shortName).join(', ')}`}
                </div>
              </div>
              <button
                className="icon-button"
                aria-label="Исправить"
                disabled={busy !== null}
                onClick={() => setEditing({ id: w.id, title: w.title, number: w.number })}
              >
                ✏️
              </button>
              <button className="icon-button" aria-label="Удалить" disabled={busy !== null} onClick={() => remove(w)}>
                {busy === w.id ? '…' : '🗑'}
              </button>
            </div>
          ),
        )}
      </div>
      <ShowMore paged={paged} />
    </>
  );
}
