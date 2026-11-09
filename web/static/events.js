const el = id => document.getElementById(id);
function add(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}
async function refresh() {
  try {
    const home = new URLSearchParams(location.search).get('home') || '';
    const response = await fetch('/api/events?home=' + encodeURIComponent(home));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    el('calls').replaceChildren();
    for (const value of data.calls) {
      const article = add(el('calls'), 'article', '');
      const call = value.call.call || {};
      add(article, 'h3', call.question || call.instruction || value.call.no_options);
      add(article, 'p', value.state === 'open' ? 'Necesita respuesta' : 'Respuesta registrada');
      if (call.context) add(article, 'p', call.context);
      for (const option of call.options || []) add(article, 'p', option.label + (option.detail ? ': ' + option.detail : ''));
      if (value.answer) {
        add(article, 'p', value.answer.text);
        add(article, 'p', 'Aplicación: ' + value.answer.application.state);
      }
    }
    el('presentations').replaceChildren();
    for (const value of Object.values(data.presentations)) {
      const article = add(el('presentations'), 'article', '');
      add(article, 'h3', value.presentation.card_title || value.id);
      add(article, 'p', value.presentation.card_status || '');
      add(article, 'pre', JSON.stringify(value, null, 2));
    }
    el('status').textContent = 'Lectura terminada. Vista parcial de eventos publicados; actualización manual.';
  } catch (error) {
    el('status').textContent = 'No se pudo leer la fuente: ' + error.message;
  }
}
el('refresh').addEventListener('click', refresh);
refresh();
