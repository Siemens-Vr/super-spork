export const isIdentity = category => ['NATIONAL_ID', 'PASSPORT'].includes(category);
export function flattenDocuments(documents) {
  return [...new Map(documents.flatMap(doc => [doc, ...(doc.transcripts || [])]).map(doc => [doc.id, doc])).values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export function previousDocumentIds(documents) {
  const previous = new Set(documents.flatMap(doc => [doc.replacesId, ...(doc.isCurrent === false ? [doc.id] : [])]).filter(Boolean));
  for (const doc of documents) if (doc.qualificationId && previous.has(doc.qualificationId)) previous.add(doc.id);
  return previous;
}
export function uploadBody(form, requirements) {
  const values = Object.fromEntries(form);
  const rule = requirements.categories.find(rule => rule.category === values.category);
  if (!rule) throw new Error('Choose a document category.');
  if (!isIdentity(values.category) && values.institutionQuery?.trim() && !values.institutionId && !values.institutionName?.trim()) throw new Error('Select an institution from the results, or choose “Institution not listed” to enter its name.');
  if (rule.institutionRequired && !values.institutionId && !values.institutionName?.trim()) throw new Error('Choose an institution or enter its name.');
  const file = form.get('file');
  const transcripts = rule.transcriptsRequired ? form.getAll('transcripts').filter(file => file?.size > 0) : [];
  if (!file?.size) throw new Error('Choose the document file to upload.');
  if (rule.transcriptsRequired && !transcripts.length) throw new Error('Attach at least one transcript for this qualification.');
  if (transcripts.length > requirements.maxTranscripts) throw new Error(`Attach at most ${requirements.maxTranscripts} transcripts.`);
  for (const attachment of [file, ...transcripts]) {
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(attachment.type)) throw new Error('Choose PDF, JPEG or PNG files.');
    if (attachment.size > requirements.maxFileBytes) throw new Error(`Each file must be no larger than ${requirements.maxFileBytes / 1048576} MB.`);
  }
  if ([file, ...transcripts].reduce((size, file) => size + file.size, 0) > requirements.maxTotalBytes) throw new Error(`The combined files exceed the ${requirements.maxTotalBytes / 1048576} MB upload limit.`);
  if (!values.confirm) throw new Error('Confirm that the documents belong to you and the details are accurate.');
  const body = new FormData();
  body.append('category', values.category);
  const fields = new Set(['title', 'credentialNumber', 'verificationUrl', ...(rule.requiredFields || []), ...(!isIdentity(values.category) ? [values.institutionId ? 'institutionId' : 'institutionName', 'issuedAt', 'expiresAt'] : [])]);
  for (const field of fields) if (typeof values[field] === 'string' && values[field].trim()) body.append(field, values[field].trim());
  body.append('file', file);
  for (const transcript of transcripts) body.append('transcripts', transcript);
  return body;
}

export function createDocumentStore({ client, onChange = () => {}, onMutation = () => {}, onUnauthorized = () => {} }) {
  const empty = () => ({ ownerId: null, status: 'idle', items: [], summary: null, requirements: null, error: '', notice: '', busy: false, detailId: '', detail: null, history: null, detailStatus: 'idle', detailError: '' });
  let state = empty(), generation = 0, loadVersion = 0, detailVersion = 0;
  const current = (version, ownerId) => version === generation && ownerId === state.ownerId;
  const errorText = error => error.message || 'The request could not be completed. Please try again.';
  const failed = error => { if (error.status === 401) onUnauthorized(); return errorText(error); };
  function remember(doc) {
    state.items = flattenDocuments([...(state.items.filter(item => item.id !== doc.id)), doc]);
    const previous = previousDocumentIds(state.items);
    const currentItems = state.items.filter(item => !previous.has(item.id));
    state.summary = { current: currentItems.length, authenticated: currentItems.filter(item => item.status === 'AUTHENTICATED').length };
  }
  return {
    snapshot: () => state,
    clearMessages() { state.error = ''; state.notice = ''; },
    reset() { generation++; loadVersion++; detailVersion++; state = empty(); },
    async load(ownerId, force = false) {
      if (!ownerId) return;
      if (ownerId !== state.ownerId) { generation++; state = { ...empty(), ownerId }; }
      if (state.busy || (!force && state.status !== 'idle')) return;
      const version = generation, request = ++loadVersion;
      state.status = state.items.length ? 'refreshing' : 'loading';
      state.error = '';
      const results = await Promise.allSettled([client.documentCollection(), client.documentRequirements()]);
      if (!current(version, ownerId) || request !== loadVersion) return;
      const error = results.find(result => result.status === 'rejected');
      if (error) { state.status = state.requirements ? 'ready' : 'error'; state.error = failed(error.reason); }
      else {
        state.items = flattenDocuments(results[0].value.items);
        state.summary = results[0].value.summary;
        state.requirements = results[1].value;
        state.status = 'ready';
      }
      onChange('load');
    },
    async select(id, force = false) {
      if (!id || (!force && state.detailId === id && state.detailStatus !== 'idle')) return;
      const version = generation, ownerId = state.ownerId, request = ++detailVersion;
      state.detailId = id; state.detailStatus = 'loading'; state.detailError = ''; state.detail = null; state.history = null;
      try {
        const [doc, history] = await Promise.all([client.document(id), client.documentHistory(id)]);
        if (!current(version, ownerId) || request !== detailVersion) return;
        state.detail = doc; state.history = history; state.detailStatus = 'ready';
        remember(doc);
      } catch (error) {
        if (!current(version, ownerId) || request !== detailVersion) return;
        state.detailStatus = 'error'; state.detailError = failed(error);
      }
      onChange('detail');
    },
    async upload(form, replacesId) {
      if (state.busy || !state.requirements) return false;
      const version = generation, ownerId = state.ownerId;
      state.error = ''; state.notice = '';
      let body;
      try { body = uploadBody(form, state.requirements); }
      catch (error) { state.error = errorText(error); onChange('upload-state'); return false; }
      state.busy = true; onChange('upload-state');
      try {
        const doc = await client.uploadDocument(body, isIdentity(body.get('category')), replacesId);
        if (!current(version, ownerId)) return false;
        remember(doc);
        state.notice = replacesId ? 'Replacement uploaded. The previous version and review history have been preserved.' : 'Document uploaded successfully. Check its scan and verification statuses below.';
        state.detailId = ''; state.detailStatus = 'idle';
        onMutation();
        return true;
      } catch (error) {
        if (!current(version, ownerId)) return false;
        state.error = error.code === 'NETWORK_ERROR' ? 'The upload could not be confirmed. Refresh My documents before retrying to avoid duplicate submissions.' : failed(error);
        if (error.details?.length) state.error += ` ${error.details.map(detail => detail.message).join(' ')}`;
        return false;
      } finally { if (current(version, ownerId)) { state.busy = false; onChange('upload-state'); } }
    },
    async evidence(id, input) {
      if (state.busy) return false;
      const version = generation, ownerId = state.ownerId;
      state.busy = true; state.error = ''; state.notice = ''; onChange('evidence-state');
      try {
        await client.documentEvidence(id, { note: input.note.trim(), ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}) });
        if (!current(version, ownerId)) return false;
        state.notice = 'Your additional evidence was submitted for review.';
        onMutation();
        try {
          const [doc, history] = await Promise.all([client.document(id), client.documentHistory(id)]);
          if (!current(version, ownerId)) return false;
          state.detail = doc; state.history = history; remember(doc);
        } catch (error) {
          if (!current(version, ownerId)) return false;
          state.error = 'Evidence was submitted, but the review status could not be refreshed. Refresh this document before submitting again.';
          state.detailStatus = 'error'; state.detailError = state.error;
        }
        return true;
      } catch (error) {
        if (!current(version, ownerId)) return false;
        state.error = failed(error);
        return false;
      } finally { if (current(version, ownerId)) { state.busy = false; onChange('evidence-state'); } }
    },
    async download(id) {
      const version = generation, ownerId = state.ownerId;
      state.error = '';
      try {
        const file = await client.downloadDocument(id);
        return current(version, ownerId) ? file : null;
      } catch (error) {
        if (current(version, ownerId)) { state.error = failed(error); onChange('download-error'); }
        return null;
      }
    },
  };
}
