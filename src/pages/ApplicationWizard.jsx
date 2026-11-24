import { useEffect, useMemo, useRef, useState } from 'react';
import { isUpcomingCompetition } from '../data/model.js';
import {
  WIZARD_STEPS,
  applicationsForCompetition,
  clearSavedDraft,
  competitionDays,
  defaultTransportDate,
  defaultWeaponIds,
  draftFromApplication,
  loadSavedDraft,
  newDraft,
  recentAthletes,
  saveApplication,
  saveDraftLocally,
  stepProblem,
  transportDateProblem,
  transportDates,
  weaponLines,
} from '../data/applications.js';
import { withApplicationRow } from '../data/patches.js';
import { newRequestId } from '../data/network.js';
import { Badge, EmptyState, PageHeader, SearchInput, ShowMore } from '../components.jsx';
import {
  COMPETITION_CARD_HEIGHT,
  ROW_HEIGHT,
  competitionSearchText,
  confirmAction,
  formatCompetitionDates,
  formatDateTime,
  formatRange,
  usePaged,
} from '../helpers.js';
import { fuzzySearch } from '../data/search.js';

// Второе нажатие на ту же карточку в пределах этого времени — «двойное»: выбрать и перейти дальше
const DOUBLE_TAP_MS = 400;

const REVIEW_STEP = WIZARD_STEPS.findIndex((s) => s.id === 'review');

const tg = () => window.Telegram?.WebApp;
// Главная кнопка Telegram внизу экрана — в Telegram вместо кнопки на странице
const hasMainButton = () => Boolean(tg()?.initData && tg().MainButton && tg().isVersionAtLeast?.('6.0'));

// Мастер создания и изменения заявки на перевозку: Соревнование → Участники и оружие → Проверка.
// params: { competitionId } — открыт с карточки соревнования (шаг выбора соревнования пропускается),
//         { number } — изменение существующей заявки.
export function ApplicationWizard({ model, me, params, sheets, onOpenPage, onCancel }) {
  const [initial] = useState(() => {
    if (!params.number) return { draft: newDraft(model, me, params.competitionId), problems: [] };
    // Только своя заявка: в данных есть и чужие, где спортсмен участник, — их менять нельзя (сервер тоже не даст)
    const application = model.applications.find((a) => a.number === String(params.number) && a.createdById === me?.id);
    if (application) return draftFromApplication(model, application);
    // Заявки уже нет в данных (например, её взяли в работу и перенесли в архив) — мастер откроется для новой
    return {
      draft: newDraft(model, me),
      problems: [`Заявка № ${params.number} не найдена — возможно, её уже перенесли в архив. Можно подать новую`],
    };
  });
  // Незаконченная новая заявка с прошлого раза — предлагаем продолжить
  const [resume, setResume] = useState(() => (params.number || !me ? null : loadSavedDraft(model, me)));
  const [draft, setDraft] = useState(initial.draft);
  const [step, setStep] = useState(params.competitionId && !params.number ? 1 : 0);
  // Шаг открыт кнопкой «Изменить» с экрана проверки — «Готово» вернёт обратно на проверку
  const [returnToReview, setReturnToReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Пользователь нажал «Далее», а шаг не заполнен — показываем, чего не хватает, и подсвечиваем где
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState(null); // { number, isEdit } — заявка отправлена
  const touched = useRef(false);
  // Номер запроса отправки этого черновика: повторное нажатие после ошибки связи сервер узнает и не создаст вторую
  // заявку. После изменения черновика — новый номер (это уже другой запрос)
  const requestId = useRef(null);
  // Отправка идёт — второе быстрое нажатие главной кнопки (раньше, чем отрисуется busy) игнорируется
  const submitting = useRef(false);

  const stepInfo = WIZARD_STEPS[step];
  const problem = result ? null : stepProblem(stepInfo.id, draft, model);
  const native = hasMainButton();

  const update = (changes) => {
    touched.current = true;
    requestId.current = null;
    setDraft((d) => ({ ...d, ...changes }));
  };

  // Новый шаг открывается без прошлых подсказок об ошибке
  const openStep = (index, fromReview = false) => {
    setStep(index);
    setReturnToReview(fromReview);
    setAttempted(false);
  };

  // Новый шаг (и экран «Заявка отправлена») открывается с начала страницы
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step, result]);

  // Черновик новой заявки сохраняется на устройстве при каждом изменении
  useEffect(() => {
    if (me && !draft.number && !result && touched.current) saveDraftLocally(me, draft, step);
  }, [me, draft, step, result]);

  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    requestId.current ??= newRequestId();
    try {
      const response = await saveApplication(draft, requestId.current);
      if (response.status !== 'success') throw new Error(response.message || 'Не удалось сохранить заявку');
      if (me && !draft.number) clearSavedDraft(me);
      tg()?.HapticFeedback?.notificationOccurred('success');
      setResult({ number: response.number, isEdit: Boolean(draft.number) });
      // Сохранённая строка сразу появляется в «Моих заявках» — таблицу целиком не перекачиваем
      sheets.patch((data) => withApplicationRow(data, response.row));
    } catch (e) {
      console.error(e);
      setError(e.message || 'Ошибка сети');
      tg()?.HapticFeedback?.notificationOccurred('error');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const goNext = () => {
    if (submitting.current) return;
    if (result) return onOpenPage('applications');
    if (problem) {
      setAttempted(true);
      tg()?.HapticFeedback?.notificationOccurred('error');
      // Прокрутка к первому незаполненному месту (например, к спортсмену без оружия) — после отрисовки подсветки
      requestAnimationFrame(() => document.querySelector('.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }
    if (step === REVIEW_STEP) submit();
    else openStep(returnToReview ? REVIEW_STEP : step + 1);
  };

  const goBack = () => {
    if (result) return onOpenPage('applications');
    if (returnToReview) return openStep(REVIEW_STEP);
    if (step === 0) return onCancel();
    openStep(step - 1);
  };

  let mainText = stepInfo.next;
  if (result) mainText = 'К моим заявкам';
  else if (step === REVIEW_STEP) mainText = draft.number ? 'Сохранить изменения' : 'Отправить заявку';
  else if (returnToReview) mainText = 'Готово';

  // Обработчики кнопок Telegram подписываются один раз и вызывают актуальные goBack и goNext из ref —
  // иначе каждая перерисовка (например, буква в поиске) переподписывала бы их и заново настраивала кнопки
  const handlers = useRef({});
  useEffect(() => {
    handlers.current = { goBack, goNext };
  });

  // Кнопка «Назад» в шапке Telegram — на предыдущий шаг (или обратно на проверку), а не выход из мастера
  useEffect(() => {
    const t = tg();
    if (!t?.isVersionAtLeast?.('6.1')) return;
    const onBack = () => handlers.current.goBack();
    t.BackButton.show();
    t.BackButton.onClick(onBack);
    return () => t.BackButton.offClick(onBack);
  }, []);

  // Главная кнопка Telegram: текст по шагу; пока шаг не заполнен — бледнее, но нажимается и объясняет, чего не хватает
  const incomplete = Boolean(problem);
  useEffect(() => {
    if (!native) return;
    const button = tg().MainButton;
    const theme = tg().themeParams || {};
    button.setParams({
      text: busy ? 'Отправляем…' : mainText,
      color: incomplete ? theme.hint_color || '#a7a7a7' : theme.button_color || '#2481cc',
      text_color: theme.button_text_color || '#ffffff',
      is_visible: true,
    });
    if (busy) button.showProgress(false);
    else button.hideProgress();
  }, [native, busy, mainText, incomplete]);
  useEffect(() => {
    if (!native) return;
    const button = tg().MainButton;
    const onMain = () => handlers.current.goNext();
    button.onClick(onMain);
    return () => button.offClick(onMain);
  }, [native]);
  useEffect(() => () => hasMainButton() && tg().MainButton.hide(), []);

  // Пока заявка не отправлена, Telegram переспрашивает перед закрытием приложения
  useEffect(() => {
    const t = tg();
    if (!t?.initData || !t.isVersionAtLeast?.('6.2') || result) return;
    t.enableClosingConfirmation();
    return () => t.disableClosingConfirmation();
  }, [result]);

  if (result) {
    return (
      <SuccessView
        result={result}
        native={native}
        onApplications={() => onOpenPage('applications')}
        onNew={() => onOpenPage('application-form', { fresh: Date.now() })}
      />
    );
  }

  const StepView = { competition: CompetitionStep, participants: ParticipantsStep, review: ReviewStep }[stepInfo.id];
  // На шаге участников видно, на какое соревнование заявка, — особенно когда мастер открыт сразу на нём
  // (из карточки соревнования или по кнопке «Подать заявку» в рассылке бота)
  const competitionTitle = stepInfo.id === 'participants' && model.competitions.find((c) => c.id === draft.competitionId)?.title;

  return (
    <>
      <PageHeader
        title={draft.number ? `Заявка № ${draft.number}` : 'Новая заявка'}
        subtitle={`Шаг ${step + 1} из ${WIZARD_STEPS.length}: ${stepInfo.title}${competitionTitle ? ` · ${competitionTitle}` : ''}`}
      />
      <div className="wizard-progress">
        {WIZARD_STEPS.map((s, i) => (
          <span key={s.id} className={i <= step ? 'done' : ''} />
        ))}
      </div>

      {resume && (
        <div className="card wizard-warning">
          <div className="item-title">Есть незаконченная заявка</div>
          <div className="item-hint">Сохранена {formatDateTime(new Date(resume.savedAt))}</div>
          <div className="card-actions">
            <button
              className="primary-button"
              onClick={() => {
                touched.current = true;
                setDraft(resume.draft);
                openStep(Math.min(resume.step ?? 0, REVIEW_STEP));
                setResume(null);
              }}
            >
              Продолжить
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                clearSavedDraft(me);
                setResume(null);
              }}
            >
              Начать заново
            </button>
          </div>
        </div>
      )}

      {initial.problems.length > 0 && (step === 0 || step === REVIEW_STEP) && (
        <div className="card wizard-warning">
          <b>Часть заявки не распознана — выберите заново:</b>
          <ul className="sub-list">
            {initial.problems.map((p) => (
              <li key={p}>⚠️ {p}</li>
            ))}
          </ul>
        </div>
      )}

      <StepView
        draft={draft}
        model={model}
        me={me}
        update={update}
        next={goNext}
        edit={(index) => openStep(index, true)}
        showErrors={attempted}
      />

      {/* Панель прилипает к низу экрана, поэтому подсказка всегда на виду рядом с главной кнопкой */}
      <div className="wizard-footer">
        {error && <p className="wizard-message error">{error}</p>}
        {problem && (
          <p className={attempted ? 'wizard-message error' : 'wizard-message'}>
            {attempted && '⚠️ '}
            {problem}
          </p>
        )}
        {/* Вне Telegram (нет главной кнопки) — свои кнопки на странице */}
        {!native && (
          <div className="wizard-buttons">
            <button className="secondary-button" onClick={goBack} disabled={busy}>
              {step === 0 && !returnToReview ? 'Отмена' : '← Назад'}
            </button>
            <button className={problem ? 'primary-button incomplete' : 'primary-button'} onClick={goNext} disabled={busy}>
              {busy ? 'Отправляем…' : mainText}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function SuccessView({ result, native, onApplications, onNew }) {
  return (
    <div className="auth">
      <EmptyState icon="✅" title={result.isEdit ? `Заявка № ${result.number} сохранена` : `Заявка № ${result.number} отправлена`}>
        Администратор увидит её в таблице. Когда статус заявки изменится, бот пришлёт сообщение в Telegram. Пока заявка в
        статусе «Новая», её можно изменить или удалить.
      </EmptyState>
      <div className="auth-actions">
        {!native && (
          <button className="primary-button" onClick={onApplications}>
            К моим заявкам
          </button>
        )}
        <button className="secondary-button" onClick={onNew}>
          ＋ Ещё одна заявка
        </button>
      </div>
    </div>
  );
}

function CompetitionStep({ draft, model, me, update, next }) {
  const [query, setQuery] = useState('');
  const [lastTap, setLastTap] = useState({ id: null, at: 0 });
  // Соревнование, выбранное при открытии шага (при изменении заявки), стоит первым. Порядок фиксируется
  // один раз — новый выбор список не переставляет, чтобы он не «прыгал» под пальцем
  const [pinnedId] = useState(draft.competitionId);

  // Предстоящие; соревнование изменяемой заявки показываем, даже если оно уже началось
  const available = model.competitions.filter((c) => isUpcomingCompetition(c) || c.id === pinnedId);
  // Закреплённое — первым, дальше по датам; с запросом — лучшие совпадения
  const pinned = available.find((c) => c.id === pinnedId);
  const ordered = pinned ? [pinned, ...available.filter((c) => c !== pinned)] : available;
  const list = fuzzySearch(ordered, query, competitionSearchText);
  const paged = usePaged(list, COMPETITION_CARD_HEIGHT, query);
  if (!available.length) return <EmptyState icon="🏆" title="Нет предстоящих соревнований" />;

  // Нажатие выбирает соревнование, повторное быстрое нажатие на него же — сразу дальше
  const tap = (c) => {
    const now = Date.now();
    if (lastTap.id === c.id && now - lastTap.at < DOUBLE_TAP_MS) next();
    // Дата перевозки прежнего соревнования к новому не подходит — выбирается заново
    else if (c.id !== draft.competitionId) update({ competitionId: c.id, transportDate: defaultTransportDate(c) });
    setLastTap({ id: c.id, at: now });
  };

  return (
    <>
      <SearchInput value={query} onChange={setQuery} placeholder="Название, город, № ЕКП" />
      <p className="sheet-meta">Двойное нажатие — выбрать и перейти дальше</p>
      {list.length === 0 && <EmptyState icon="🏆" title="Ничего не найдено" />}
      {paged.visible.map((c) => {
        // Уже поданные заявки на это соревнование (кроме той, что сейчас меняется) — предупреждаем о дубле
        const existing = applicationsForCompetition(model, c, me).filter((a) => a.number !== draft.number);
        return (
          <button
            key={c.id}
            className={c.id === draft.competitionId ? 'card choice selected' : 'card choice'}
            onClick={() => tap(c)}
          >
            <div className="item-title">{c.title}</div>
            <div className="item-row">📅 {formatCompetitionDates(c)}</div>
            {c.address && <div className="item-row">📍 {c.address}</div>}
            <div className="item-tags">
              {c.kind && <Badge>{c.kind}</Badge>}
              {c.ekpNumber && <Badge>ЕКП № {c.ekpNumber}</Badge>}
              {c.oneDay && <Badge tone="accent">Выезд одним днём</Badge>}
              {existing.map((a) => (
                <Badge key={a.number} tone="warning">
                  Уже есть заявка № {a.number}
                </Badge>
              ))}
            </div>
          </button>
        );
      })}
      <ShowMore paged={paged} />
    </>
  );
}

const MIN_QUERY = 3; // поиск спортсменов — от стольких символов

// Участники и их оружие на одном экране: каждый добавленный спортсмен — карточка с выбором оружия.
// me — перевозчик, чьи прошлые заявки подсказывают участников (у администратора — автор заявки);
// recentLabel — пометка у таких участников. Перевозчик выбирает спортсмену только закреплённое за ним оружие
// (спортсмена без оружия добавить нельзя); anyWeapon — администратор: любое из справочника
export function ParticipantsStep({ draft, model, me, update, showErrors, recentLabel = 'Был в ваших заявках', anyWeapon = false }) {
  const [query, setQuery] = useState('');
  const selectedIds = draft.items.map((i) => i.athleteId);

  const add = (athlete) => {
    update({ items: [...draft.items, { athleteId: athlete.id, weaponIds: defaultWeaponIds(athlete) }] });
    setQuery('');
  };
  // Убрать участника — после подтверждения: вместе с ним пропадает и выбранное для него оружие
  const remove = async (athleteId) => {
    const athlete = model.athletes.find((a) => a.id === athleteId);
    if (!(await confirmAction(`Убрать ${athlete?.fullName ?? 'участника'} из заявки?`))) return;
    update({ items: draft.items.filter((i) => i.athleteId !== athleteId) });
  };
  const setWeapons = (athleteId, weaponIds) =>
    update({ items: draft.items.map((i) => (i.athleteId === athleteId ? { ...i, weaponIds } : i)) });

  const notSelected = (a) => !selectedIds.includes(a.id);
  // Полный список не показываем: без запроса — только участники прошлых заявок,
  // поиск по всем спортсменам — от MIN_QUERY символов (с опечатками по 1–2 буквам совпадает почти каждый)
  const recent = useMemo(() => recentAthletes(model, me), [model, me]).filter(notSelected);
  const trimmed = query.trim();
  const searching = trimmed.length >= MIN_QUERY;
  const list = searching ? fuzzySearch(model.athletes.filter(notSelected), trimmed, (a) => a.fullName) : trimmed ? [] : recent;
  const paged = usePaged(list, ROW_HEIGHT, query);
  const hint = searching
    ? 'Никого не нашли'
    : trimmed
      ? `Введите не меньше ${MIN_QUERY} букв`
      : 'Начните вводить фамилию или имя';

  return (
    <>
      <div className="section-label">Участники: {draft.items.length}</div>
      {draft.items.length === 0 && (
        <p className={showErrors ? 'invalid-text invalid' : 'sheet-meta'}>Добавьте участников ниже</p>
      )}
      {draft.items.map((item) => (
        <ParticipantCard
          key={item.athleteId}
          item={item}
          model={model}
          onRemove={() => remove(item.athleteId)}
          onWeapons={(weaponIds) => setWeapons(item.athleteId, weaponIds)}
          showErrors={showErrors}
          anyWeapon={anyWeapon}
        />
      ))}

      <h2 className="section-title">Добавить участника</h2>
      <SearchInput value={query} onChange={setQuery} placeholder="Фамилия, имя — можно с опечатками" />
      {list.length === 0 && <p className="sheet-meta">{hint}</p>}
      {!trimmed && list.length > 0 && <p className="sheet-meta">Остальных спортсменов найдите поиском</p>}
      {list.length > 0 && (
        <div className="list">
          {paged.visible.map((a) => {
            const blocked = !anyWeapon && !a.weapons.length;
            return (
              <button key={a.id} className="list-item choice-row" onClick={() => add(a)} disabled={blocked}>
                <span className="add-mark">＋</span>
                <div className="list-text">
                  <div className="item-title">{a.fullName}</div>
                  <div className="item-hint">
                    {!searching && `${recentLabel} · `}
                    {a.weapons.length
                      ? `🎯 ${a.weapons.map((w) => w.title).join(', ')}`
                      : blocked
                        ? 'Оружие не закреплено — обратитесь к администратору'
                        : 'Оружие не закреплено'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <ShowMore paged={paged} />
    </>
  );
}

// Участник заявки: его оружие — плашками (нажатие выбирает или снимает). Перевозчику — закреплённое за спортсменом
// и уже стоявшее в заявке (раньше его можно было взять из всего справочника; снятое остаётся плашкой до ухода с экрана).
// anyWeapon — администратор: ещё и «＋ Добавить» из справочника
function ParticipantCard({ item, model, onRemove, onWeapons, showErrors, anyWeapon }) {
  const [picking, setPicking] = useState(false);
  const [initialIds] = useState(item.weaponIds);
  const athlete = model.athletes.find((a) => a.id === item.athleteId);
  const linked = athlete?.weapons ?? [];
  const extraIds = anyWeapon ? item.weaponIds : [...new Set([...initialIds, ...item.weaponIds])];
  const extra = model.weapons.filter((w) => extraIds.includes(w.id) && !linked.includes(w));
  const shown = [...linked, ...extra];
  const toggle = (id) => onWeapons(item.weaponIds.includes(id) ? item.weaponIds.filter((w) => w !== id) : [...item.weaponIds, id]);
  const invalid = showErrors && !item.weaponIds.length;
  const noWeapons = !anyWeapon && !shown.length;

  return (
    <div className={invalid ? 'card item-card invalid' : 'card item-card'}>
      <div className="item-head">
        <div className="item-title">{athlete?.fullName ?? item.athleteId}</div>
        <button className="icon-button" onClick={onRemove} aria-label="Убрать из заявки">
          ✕
        </button>
      </div>
      {noWeapons ? (
        <div className={invalid ? 'invalid-text' : 'item-hint'}>
          Оружие не закреплено — обратитесь к администратору или уберите спортсмена из заявки
        </div>
      ) : (
        invalid && <div className="invalid-text">Выберите хотя бы одну единицу оружия</div>
      )}
      <div className="weapon-chips">
        {shown.map((w) => {
          const selected = item.weaponIds.includes(w.id);
          return (
            <button key={w.id} className={selected ? 'weapon-chip selected' : 'weapon-chip'} onClick={() => toggle(w.id)}>
              {selected && '✓ '}
              {w.title} <span className="weapon-chip-number">{w.number}</span>
              {!anyWeapon && extra.includes(w) && <span className="weapon-chip-number"> · не закреплено</span>}
            </button>
          );
        })}
        {anyWeapon && (
          <button className="weapon-chip add" onClick={() => setPicking(true)}>
            ＋ Добавить
          </button>
        )}
      </div>
      {picking && (
        <WeaponPicker
          title={`Оружие для ${athlete?.shortName ?? 'участника'}`}
          weapons={model.weapons.filter((w) => !shown.includes(w))}
          onPick={(w) => {
            onWeapons([...item.weaponIds, w.id]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

// Окно выбора оружия из справочника поверх экрана: поиск и список; нажатие на единицу выбирает её и закрывает окно
export function WeaponPicker({ title, weapons, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const found = fuzzySearch(weapons, query, (w) => `${w.title} ${w.number}`);
  const paged = usePaged(found, ROW_HEIGHT, query);

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="item-head">
          <div className="item-title">{title}</div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="Название или номер — можно с опечатками" />
        {found.length === 0 && <p className="sheet-meta">{query.trim() ? 'Ничего не найдено' : 'Справочник пуст'}</p>}
        {found.length > 0 && (
          <div className="list">
            {paged.visible.map((w) => (
              <button key={w.id} className="list-item choice-row" onClick={() => onPick(w)}>
                <div className="list-text">
                  <div className="item-title">{w.title}</div>
                  <div className="item-hint">{w.number}</div>
                </div>
              </button>
            ))}
          </div>
        )}
        <ShowMore paged={paged} />
      </div>
    </div>
  );
}

// Проверка: всё, что уйдёт в таблицу, с кнопками «Изменить» у каждого блока; транспорт выбирается здесь же,
// а у соревнования «Выезд одним днём» — ещё и обязательная дата перевозки
function ReviewStep({ draft, model, update, edit, showErrors }) {
  const competition = model.competitions.find((c) => c.id === draft.competitionId);
  const lines = weaponLines(draft, model);
  const dates = transportDates(competition, draft.transportDate);
  const oneDay = Boolean(competition?.oneDay && competition.start);
  const toggleTransport = (name) =>
    update({ transport: draft.transport.includes(name) ? draft.transport.filter((t) => t !== name) : [...draft.transport, name] });

  return (
    <>
      <div className="card item-card">
        <div className="item-head">
          <div className="section-label">Соревнование</div>
          <button className="link-button" onClick={() => edit(0)}>
            Изменить
          </button>
        </div>
        <div className="item-title">{competition?.title}</div>
        <div className="item-row">📅 {formatCompetitionDates(competition)}</div>
        {competition?.address && <div className="item-row">📍 {competition.address}</div>}
      </div>

      <div className="card item-card">
        <div className="item-head">
          <div className="section-label">Участники и оружие</div>
          <button className="link-button" onClick={() => edit(1)}>
            Изменить
          </button>
        </div>
        <ul className="sub-list">
          {lines.map((l) => (
            <li key={l}>🎯 {l}</li>
          ))}
        </ul>
      </div>

      <div
        className={
          showErrors && (!draft.transport.length || (oneDay && transportDateProblem(draft, model)))
            ? 'card item-card invalid'
            : 'card item-card'
        }
      >
        <div className="section-label">Транспорт</div>
        {model.transportTypes.length === 0 ? (
          <p className="sheet-error">Справочник «Виды транспорта» пуст — обратитесь к администратору</p>
        ) : (
          <div className="item-tags">
            {model.transportTypes.map((t) => (
              <button
                key={t}
                className={draft.transport.includes(t) ? 'sheet-tab active' : 'sheet-tab'}
                onClick={() => toggleTransport(t)}
              >
                {draft.transport.includes(t) && '✓ '}
                {t}
              </button>
            ))}
          </div>
        )}
        {oneDay ? (
          <TransportDatePicker competition={competition} draft={draft} update={update} showErrors={showErrors} model={model} />
        ) : dates.start ? (
          <>
            <div className="item-row">📅 Сроки перевозки: {formatRange(dates.start, dates.end)}</div>
            <div className="item-hint">За день до начала соревнования и через день после окончания</div>
          </>
        ) : (
          <div className="item-hint">📅 У соревнования не указана дата — сроки перевозки заполнит оформитель</div>
        )}
      </div>
    </>
  );
}

const WEEKDAY = { weekday: 'short', timeZone: 'Europe/Moscow' };
// Подпись дня для выбора: «пт, 12.12»
const dayLabel = (day) => {
  const weekday = new Date(`${day}T12:00:00+03:00`).toLocaleDateString('ru-RU', WEEKDAY);
  return `${weekday}, ${day.slice(8, 10)}.${day.slice(5, 7)}`;
};

// Дата перевозки на соревнование «Выезд одним днём»: плашки по дням периода соревнования (выбор обязателен)
// и кнопка «?» с пояснением, зачем её выбирать
function TransportDatePicker({ competition, draft, update, showErrors, model }) {
  const [explain, setExplain] = useState(false);
  const days = competitionDays(competition);
  const problem = transportDateProblem(draft, model);

  return (
    <>
      <div className="item-head transport-date-head">
        <div className="section-label">Дата перевозки *</div>
        <button
          className={explain ? 'hint-toggle active' : 'hint-toggle'}
          onClick={() => setExplain((v) => !v)}
          aria-label="Почему нужно выбрать дату"
          aria-expanded={explain}
        >
          ?
        </button>
      </div>
      {explain && (
        <div className="item-hint hint-text">
          На это соревнование едут одним днём: перевозка туда и обратно — в один день. Выберите день из периода
          соревнования ({formatCompetitionDates(competition)}) — он будет записан в заявку как начало и окончание сроков
          перевозки. Без даты заявку отправить нельзя.
        </div>
      )}
      <div className="item-tags">
        {days.map((day) => (
          <button
            key={day}
            className={draft.transportDate === day ? 'sheet-tab active' : 'sheet-tab'}
            onClick={() => update({ transportDate: day })}
          >
            {draft.transportDate === day && '✓ '}
            {dayLabel(day)}
          </button>
        ))}
      </div>
      {problem && showErrors && <div className="invalid-text">{problem}</div>}
    </>
  );
}
