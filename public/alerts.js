export function mountAlertPanel(container, { api, runId, onReview = () => {}, onError = () => {} }) {
  const root = document.createElement('section');
  root.className = 'panel teacher-alert-panel';
  const heading = document.createElement('div');
  heading.className = 'between row';
  const title = document.createElement('h2');
  title.textContent = 'Safeguarding alerts';
  const count = document.createElement('span');
  count.className = 'badge';
  heading.append(title, count);
  const monitoring = document.createElement('p');
  monitoring.className = 'notice';
  monitoring.setAttribute('role', 'status');
  const list = document.createElement('div');
  list.className = 'stack';
  root.append(heading, monitoring, list);
  container.append(root);
  const nodes = new Map();
  const acknowledged = new Set();
  let destroyed = false;

  function makeAlert(alert) {
    const card = document.createElement('article');
    card.className = 'card';
    const head = document.createElement('div');
    head.className = 'between row';
    const student = document.createElement('h3');
    const severity = document.createElement('span');
    severity.className = 'badge';
    head.append(student, severity);
    const category = document.createElement('p');
    category.className = 'message-label';
    const reason = document.createElement('p');
    const evidence = document.createElement('ul');
    const actions = document.createElement('div');
    actions.className = 'actions';
    const review = document.createElement('button');
    review.type = 'button';
    review.textContent = 'Review student';
    const acknowledge = document.createElement('button');
    acknowledge.type = 'button';
    acknowledge.textContent = 'Acknowledge';
    let current = alert;
    review.addEventListener('click', () => onReview(current.participantId, current.evidence?.[0]?.sourceId));
    acknowledge.addEventListener('click', async () => {
      if (acknowledge.disabled) return;
      acknowledge.disabled = true;
      try {
        await api(`/api/runs/${encodeURIComponent(runId)}/alerts/${encodeURIComponent(current.id)}/acknowledge`, {}, 'POST');
        acknowledged.add(current.id);
        card.remove();
        nodes.delete(current.id);
        count.textContent = `${nodes.size} open`;
      } catch (error) {
        acknowledge.disabled = false;
        onError(error);
      }
    });
    actions.append(review, acknowledge);
    card.append(head, category, reason, evidence, actions);
    return {
      card,
      update(value) {
        current = value;
        student.textContent = value.studentName;
        severity.textContent = value.severity === 'urgent' ? 'Urgent' : 'Attention';
        category.textContent = value.category;
        reason.textContent = value.reason;
        evidence.replaceChildren(...(Array.isArray(value.evidence) ? value.evidence : []).map(item => {
          const quote = document.createElement('li');
          quote.textContent = `“${item.quote}”`;
          return quote;
        }));
        acknowledge.disabled = Boolean(value.acknowledgedAt);
      },
    };
  }

  function update(alerts, monitor) {
    if (destroyed) return;
    const status = monitor && typeof monitor === 'object' ? monitor.status : undefined;
    const message = monitor && typeof monitor === 'object' && typeof monitor.message === 'string' ? monitor.message : '';
    monitoring.textContent = message || (status === 'current'
      ? 'Monitoring is current; no AI alerts are recorded in the checked work.'
      : status === 'pending' ? 'Task monitoring is pending.'
        : status === 'unavailable' ? 'Task monitoring is unavailable.'
          : 'Task monitoring has not been assessed.');
    monitoring.dataset.status = ['current', 'pending', 'unavailable', 'not-assessed'].includes(status) ? status : 'not-assessed';
    const active = Array.isArray(alerts) ? alerts.filter(alert => alert && typeof alert.id === 'string' && !alert.acknowledgedAt && !acknowledged.has(alert.id)) : [];
    count.textContent = `${active.length} open`;
    const keep = new Set();
    for (const alert of active) {
      keep.add(alert.id);
      let entry = nodes.get(alert.id);
      if (!entry) {
        entry = makeAlert(alert);
        nodes.set(alert.id, entry);
      }
      entry.update(alert);
      if (entry.card.parentNode !== list) list.append(entry.card);
    }
    for (const [id, entry] of nodes) if (!keep.has(id)) {
      entry.card.remove();
      nodes.delete(id);
    }
  }

  function destroy() {
    destroyed = true;
    nodes.clear();
    root.remove();
  }
  return { update, destroy };
}
