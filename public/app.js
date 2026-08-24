const API = '/api/tasks';

const els = {
  composer: document.getElementById('composer'),
  title: document.getElementById('title'),
  description: document.getElementById('description'),
  submit: document.querySelector('.composer__submit'),
  banner: document.getElementById('banner'),
  filters: document.getElementById('filters'),
  list: document.getElementById('tasks'),
  empty: document.getElementById('empty'),
  count: document.getElementById('count'),
};

let filter = 'all';
let tasks = [];

/** Calls the API and unwraps the { data } / { error } envvelope. */
async function api(method, path = '', body) {
  const res = await fetch(`${API}${path}`, {
    method,
    ...(body && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });

  if (res.status === 204) return null;

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = payload?.error?.details?.[0];
    throw new Error(
      detail
        ? `${detail.field} ${detail.message}`
        : (payload?.error?.message ?? `Request failed (${res.status})`),
    );
  }
  return payload;
}

function showError(message) {
  els.banner.textContent = message;
  els.banner.hidden = false;
}

function clearError() {
  els.banner.hidden = true;
}

const EMPTY_TEXT = {
  all: 'No tasks yet. Add one above.',
  open: 'Nothing open — all caught up.',
  done: 'Nothing completed yet.',
};

function visibleTasks() {
  if (filter === 'open') return tasks.filter((t) => !t.completed);
  if (filter === 'done') return tasks.filter((t) => t.completed);
  return tasks;
}

function formatTime(iso) {
  const date = new Date(iso);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderTask(task) {
  const li = document.createElement('li');
  li.className = `task${task.completed ? ' task--done' : ''}`;
  li.dataset.id = task.id;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task__check';
  checkbox.checked = task.completed;
  checkbox.setAttribute(
    'aria-label',
    `Mark "${task.title}" as ${task.completed ? 'open' : 'done'}`,
  );
  checkbox.addEventListener('change', () => toggle(task, li));

  const body = document.createElement('div');
  body.className = 'task__body';

  const title = document.createElement('div');
  title.className = 'task__title';
  title.textContent = task.title; // textContent, so titles can't inject markup
  body.append(title);

  if (task.description) {
    const description = document.createElement('div');
    description.className = 'task__description';
    description.textContent = task.description;
    body.append(description);
  }

  const time = document.createElement('div');
  time.className = 'task__time';
  time.textContent = `Added ${formatTime(task.createdAt)}`;
  body.append(time);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'task__delete';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Delete "${task.title}"`);
  remove.addEventListener('click', () => destroy(task, li));

  li.append(checkbox, body, remove);
  return li;
}

function render() {
  const visible = visibleTasks();

  els.list.replaceChildren(...visible.map(renderTask));

  els.empty.textContent = EMPTY_TEXT[filter];
  els.empty.hidden = visible.length > 0;

  const open = tasks.filter((t) => !t.completed).length;
  els.count.textContent =
    tasks.length === 0 ? '' : `${open} open · ${tasks.length} total`;
}

async function load() {
  try {
    const { data } = await api('GET');
    tasks = data;
    clearError();
    render();
  } catch (err) {
    showError(`Could not load tasks: ${err.message}`);
  }
}

async function toggle(task, li) {
  li.classList.add('is-busy');
  try {
    const { data } = await api('PATCH', `/${task.id}`, { completed: !task.completed });
    tasks = tasks.map((t) => (t.id === data.id ? data : t));
    clearError();
    render();
  } catch (err) {
    showError(err.message);
    li.classList.remove('is-busy');
    render(); // roll the checkbox back to server truth
  }
}

async function destroy(task, li) {
  li.classList.add('is-busy');
  try {
    await api('DELETE', `/${task.id}`);
    tasks = tasks.filter((t) => t.id !== task.id);
    clearError();
    render();
  } catch (err) {
    showError(err.message);
    li.classList.remove('is-busy');
  }
}

els.composer.addEventListener('submit', async (event) => {
  event.preventDefault();

  const title = els.title.value.trim();
  if (!title) return;
  const description = els.description.value.trim();

  els.submit.disabled = true;
  try {
    const { data } = await api('POST', '', {
      title,
      ...(description && { description }),
    });
    tasks = [data, ...tasks];
    els.composer.reset();
    clearError();
    render();
  } catch (err) {
    showError(err.message);
  } finally {
    els.submit.disabled = false;
    els.title.focus();
  }
});

els.filters.addEventListener('click', (event) => {
  const button = event.target.closest('.filters__btn');
  if (!button) return;

  filter = button.dataset.filter;
  for (const btn of els.filters.querySelectorAll('.filters__btn')) {
    const active = btn === button;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
  render();
});

load();
