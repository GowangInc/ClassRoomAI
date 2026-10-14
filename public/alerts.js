export function mountAlertPanel(container, { api, runId, onReview = () => {}, onError = () => {} }) {
  const root = document.createElement('section');
  root.className = 'panel teacher-alert-panel';
  const heading = document.createElement('div');
  heading.className = 'between row';
  const title = document.createElement('h2');
  title.textContent = 'Teacher alerts';
  const counts = document.createElement('div');
  counts.className = 'row alert-counts';
  const count = document.createElement('span');
  count.className = 'badge';
  const urgentCount = document.createElement('span');
  urgentCount.className = 'badge alert-urgent-count';
  counts.append(count, urgentCount);
  heading.append(title, counts);
  const monitoring = document.createElement('p');
  monitoring.className = 'notice';
  monitoring.setAttribute('role', 'status');
  const list = document.createElement('div');
  list.className = 'stack';
  const empty = document.createElement('p');
  empty.className = 'empty alert-empty';
  empty.textContent = 'No open teacher alerts in the checked work. This is not a safety guarantee.';
  list.append(empty);
  root.append(heading, monitoring, list);
  container.append(root);
  const nodes = new Map();
  const acknowledged = new Set();
  let destroyed = false;
  function updateCounts() {
    const open = Array.from(nodes.values()).filter(entry => entry.open);
    const urgent = open.filter(entry => entry.current.severity === 'urgent').length;
    count.textContent = `${open.length} open`;
    urgentCount.textContent = `${urgent} urgent`;
    urgentCount.className = urgent ? 'badge alert-urgent-count' : 'badge';
    empty.hidden = open.length > 0;
  }

  function makeAlert(alert) {
    const card = document.createElement('article');
    card.className = 'card teacher-alert-card';
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
    const context = document.createElement('p');
    context.className = 'hint alert-source';
    const evidenceNodes = new Map();
    const actions = document.createElement('div');
    actions.className = 'actions';
    const review = document.createElement('button');
    review.type = 'button';
    review.textContent = 'Review student';
    const acknowledge = document.createElement('button');
    acknowledge.type = 'button';
    acknowledge.textContent = 'Acknowledge';
    let current = alert, acknowledging = false;
    review.addEventListener('click', () => onReview(current.participantId, current.evidence?.[0]?.sourceId));
    acknowledge.addEventListener('click', async () => {
      if (acknowledge.disabled) return;
      acknowledging = true;
      acknowledge.disabled = true;
      try {
        await api(`/api/runs/${encodeURIComponent(runId)}/alerts/${encodeURIComponent(current.id)}/acknowledge`, {}, 'POST');
        acknowledged.add(current.id);
        card.remove();
        nodes.delete(current.id);
        updateCounts();
      } catch (error) {
        acknowledging = false;
        acknowledge.disabled = false;
        onError(error);
      }
    });
    actions.append(review, acknowledge);
    card.append(head, category, reason, context, evidence, actions);
    return {
      card,
      get current() { return current; },
      open: true,
      markClosed() {
        this.open = false;
        context.textContent = 'No longer open in the current snapshot; this source stays available until focus leaves.';
        acknowledge.disabled = true;
      },
      update(value) {
        this.open = true;
        current = value;
        card.dataset.severity = value.severity;
        student.textContent = value.studentName;
        severity.textContent = value.severity === 'urgent' ? 'Urgent' : 'Attention';
        severity.className = `badge ${value.severity === 'urgent' ? 'alert-urgent-count' : 'alert-attention'}`;
        category.textContent = ({ 'support-needed': 'Support needed', 'off-task': 'Off task', inappropriate: 'Inappropriate content', danger: 'Safety concern' })[value.category] || value.category;
        reason.textContent = value.reason;
        context.textContent = `AI advisory · Review the cited evidence${value.createdAt ? ' · Recorded ' + new Date(value.createdAt).toLocaleString() : ''}`;
        const keep = new Set();
        for (const [index, item] of (Array.isArray(value.evidence) ? value.evidence : []).entries()) {
          const key = `${item.sourceId}:${index}`;
          keep.add(key);
          let entry = evidenceNodes.get(key);
          if (!entry) {
            const quote = document.createElement('li');
            const text = document.createElement('p');
            const source = document.createElement('p');
            source.className = 'hint alert-source';
            const reviewSource = document.createElement('button');
            reviewSource.type = 'button';
            reviewSource.className = 'small review-source';
            reviewSource.textContent = 'Review exact source';
            reviewSource.addEventListener('click', () => onReview(current.participantId, entry.value.sourceId));
            quote.append(text, source, reviewSource);
            entry = { quote, text, source, value: item };
            evidenceNodes.set(key, entry);
            evidence.append(quote);
          }
          entry.value = item;
          entry.text.textContent = `“${item.quote}”`;
          entry.source.textContent = `Source: ${item.sourceId}`;
        }
        for (const [key, entry] of evidenceNodes) if (!keep.has(key) && !entry.quote.contains(document.activeElement)) {
          entry.quote.remove();
          evidenceNodes.delete(key);
        }
        acknowledge.disabled = acknowledging || Boolean(value.acknowledgedAt);
      },
    };
  }

  function update(alerts, monitor) {
    if (destroyed) return;
    const status = monitor && typeof monitor === 'object' ? monitor.status : undefined;
    const message = monitor && typeof monitor === 'object' && typeof monitor.message === 'string' ? monitor.message : '';
    const activeCount = Array.isArray(alerts) ? alerts.filter(alert => alert && !alert.acknowledgedAt && !acknowledged.has(alert.id)).length : 0;
    monitoring.textContent = message || (status === 'current'
      ? activeCount ? 'Monitoring is current. Review these AI advisory alerts against their exact sources.' : 'Monitoring is current; no AI alerts are recorded in the checked work.'
      : status === 'pending' ? 'Task monitoring is pending. Existing alerts remain available for review.'
        : status === 'unavailable' ? 'Task monitoring is unavailable. Existing alerts remain available for review.'
          : 'Task monitoring has not been assessed.');
    monitoring.dataset.status = ['current', 'pending', 'unavailable', 'not-assessed'].includes(status) ? status : 'not-assessed';
    const active = Array.isArray(alerts) ? alerts.filter(alert => alert && typeof alert.id === 'string' && !alert.acknowledgedAt && !acknowledged.has(alert.id)) : [];
    const focused = list.contains(document.activeElement);
    const keep = new Set();
    for (const [index, alert] of active.entries()) {
      keep.add(alert.id);
      let entry = nodes.get(alert.id);
      if (!entry) {
        entry = makeAlert(alert);
        nodes.set(alert.id, entry);
      }
      entry.update(alert);
      const reference = Array.from(list.children).filter(node => node !== empty)[index];
      if (entry.card.parentNode !== list) list.insertBefore(entry.card, reference || null);
      else if (!focused && reference !== entry.card) list.insertBefore(entry.card, reference || null);
    }
    for (const [id, entry] of nodes) if (!keep.has(id)) {
      if (entry.card.contains(document.activeElement)) entry.markClosed();
      else { entry.card.remove(); nodes.delete(id); }
    }
    updateCounts();
    if (!active.length) empty.textContent = status === 'current'
      ? 'No open teacher alerts in the checked work. This is not a safety guarantee.'
      : status === 'pending' ? 'Assessment pending. No open alerts recorded so far.'
        : status === 'unavailable' ? 'Monitoring unavailable. An empty alert list does not mean the work has been checked.'
          : 'No open alerts recorded. Student work has not yet been assessed.';
  }

  function destroy() {
    destroyed = true;
    nodes.clear();
    root.remove();
  }
  return { update, destroy };
}
