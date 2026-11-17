// Ignore results from older queries, detached forms, or a previous signed-in user.
export function createInstitutionLookup({ search, onResult, delay = 300, schedule = setTimeout, cancel = clearTimeout }) {
  let version = 0, timer;
  function clear() { version++; cancel(timer); }
  return {
    clear,
    query(value) {
      clear();
      const query = value.trim(), request = version;
      if (query.length < 2) { onResult({ status: 'idle', items: [] }); return; }
      onResult({ status: 'loading', items: [] });
      timer = schedule(async () => {
        try {
          const items = await search(query);
          if (request === version) onResult({ status: 'ready', items });
        } catch (error) {
          if (request === version) onResult({ status: 'error', items: [], error });
        }
      }, delay);
    },
  };
}

export function initializeInstitutionSearch({ client, ownerId, onUnauthorized }) {
  const fields = new WeakMap();
  function field(input) {
    if (fields.has(input)) return fields.get(input);
    const wrapper = input.closest('[data-institution-field]');
    const list = wrapper.querySelector('[role="listbox"]');
    const status = wrapper.querySelector('[role="status"]');
    const selected = wrapper.querySelector('[name="institutionId"]');
    const owner = ownerId();
    let items = [], active = -1;
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }
    function highlight(index) {
      active = index;
      [...list.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
      input.setAttribute('aria-activedescendant', list.children[index].id);
      list.children[index].scrollIntoView({ block: 'nearest' });
    }
    const lookup = createInstitutionLookup({
      search: query => client.institutions(query),
      onResult(result) {
        if (!input.isConnected || owner !== ownerId() || input.dataset.manual === 'true') return;
        close(); list.replaceChildren(); items = result.items;
        status.textContent = result.status === 'loading' ? 'Searching institutions…' : result.status === 'error' ? 'Unable to search. Type again to retry, or enter the institution manually.' : result.status === 'ready' ? (items.length ? `${items.length} matches. Use arrow keys to choose. Keep typing to narrow results.` : 'No matching institutions. Try another name or enter it manually.') : 'Type at least 2 characters to search.';
        if (result.error?.status === 401) onUnauthorized();
        items.forEach((institution, index) => {
          const option = document.createElement('button');
          option.type = 'button'; option.tabIndex = -1;
          option.id = `${list.id}-option-${index}`;
          option.dataset.institutionOption = String(index);
          option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
          option.textContent = `${institution.name}${institution.country ? ` · ${institution.country}` : ''}`;
          list.append(option);
        });
        if (items.length) { list.hidden = false; input.setAttribute('aria-expanded', 'true'); }
      },
    });
    function choose(index) {
      const institution = items[index];
      if (!institution) return;
      lookup.clear(); selected.value = institution.id; input.value = institution.name;
      input.setCustomValidity(''); status.textContent = 'Institution selected.'; close(); input.focus();
    }
    const state = {
      close() { lookup.clear(); close(); },
      search() {
        if (input.dataset.manual === 'true') return;
        selected.value = '';
        input.setCustomValidity(input.value.trim() ? 'Select a matching institution, or choose Institution not listed.' : '');
        lookup.query(input.value);
      },
      focus() { if (input.dataset.manual !== 'true' && !selected.value) lookup.query(input.value); },
      choose,
      toggle() {
        lookup.clear(); close(); selected.value = ''; input.setCustomValidity('');
        const manual = input.dataset.manual !== 'true';
        input.dataset.manual = String(manual); input.name = manual ? 'institutionName' : 'institutionQuery';
        input.maxLength = manual ? 200 : 150;
        wrapper.querySelector('[data-institution-toggle]').textContent = manual ? 'Search listed institutions' : 'Institution not listed? Enter it manually';
        wrapper.querySelector('[data-institution-help]').textContent = manual ? 'Enter the full institution name.' : 'Type at least 2 characters, then select your institution.';
        status.textContent = '';
        input.focus();
        if (!manual) state.search();
      },
      key(event) {
        if (input.dataset.manual === 'true') return;
        if (event.key === 'Escape' && !list.hidden) { event.preventDefault(); event.stopPropagation(); state.close(); }
        if (list.hidden || !items.length) return;
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          highlight(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (active + (event.key === 'ArrowDown' ? 1 : active < 0 ? 0 : -1) + items.length) % items.length);
        }
        if (event.key === 'Enter' && active >= 0) { event.preventDefault(); choose(active); }
      },
    };
    fields.set(input, state); return state;
  }
  document.addEventListener('input', event => { if (event.target.matches('[data-institution-input]')) field(event.target).search(); });
  document.addEventListener('focusin', event => { if (event.target.matches('[data-institution-input]')) field(event.target).focus(); });
  document.addEventListener('focusout', event => {
    if (event.target.matches('[data-institution-input]') && !event.target.closest('[data-institution-field]').contains(event.relatedTarget)) field(event.target).close();
  });
  document.addEventListener('keydown', event => { if (event.target.matches('[data-institution-input]')) field(event.target).key(event); });
  document.addEventListener('mousedown', event => { if (event.target.closest('[data-institution-option]')) event.preventDefault(); });
  document.addEventListener('click', event => {
    const control = event.target.closest('[data-institution-option], [data-institution-toggle]');
    if (!control) return;
    const input = control.closest('[data-institution-field]').querySelector('[data-institution-input]');
    if (input.disabled || input.closest('fieldset:disabled')) return;
    if (control.hasAttribute('data-institution-toggle')) field(input).toggle();
    else field(input).choose(Number(control.dataset.institutionOption));
  });
}
