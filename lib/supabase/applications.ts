import type { AppNotification, Application, ApplicationInput, UploadedDocument } from '@/types';
import { supabaseBrowser } from './browser';

const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);

async function post(body: unknown): Promise<Application> {
  const response = await fetch('/api/applications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'The request could not be saved.');
  return json.application as Application;
}

export async function loadApplicationByReference(reference: string): Promise<Application | undefined> {
  const response = await fetch(`/api/applications?reference=${encodeURIComponent(reference)}`, { cache: 'no-store' });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) return undefined;
  return json.application as Application;
}

// Save or submit an Applicant's or Staff-assisted walk-in request in the database:
// 1. a new request is first saved as a Draft, so it gets its database id and reference number;
// 2. each newly chosen file is uploaded into the private bucket, in that request's own folder (the access rules allow
//    the owner or staff to upload while it is a Draft); files already uploaded keep their path;
// 3. the request is saved again with the file paths, as a draft or submitted.
export async function saveApplicationToSupabase(form: ApplicationInput, reference: string | undefined, draft: boolean, knownDbId?: number): Promise<Application> {
  const fields = { ...form, documents: [] as UploadedDocument[] };
  let record = reference ? undefined : await post({ step: 'create', draft: true, application: fields, documents: [] });
  const ref = reference ?? record!.reference;
  let dbId = knownDbId ?? record?.dbId;
  const needsUpload = form.documents.some(d => !d.path);
  if (needsUpload && dbId === undefined) {
    const app = await loadApplicationByReference(ref);
    dbId = app?.dbId;
    if (dbId === undefined) {
      const list = await loadMyApplications().catch(() => []);
      dbId = list.find(a => a.reference === ref)?.dbId;
    }
    if (dbId === undefined) throw new Error('This request could not be found. Please reload the page.');
  }
  const supabase = supabaseBrowser();
  const documents = [];
  for (const d of form.documents) {
    let path = d.path;
    if (!path) {
      if (!d.url) throw new Error(`Please choose the file for "${d.requirement}" again.`);
      const blob = await (await fetch(d.url)).blob();
      path = `${dbId}/${Date.now()}-${safeFileName(d.name)}`;
      const { error } = await supabase.storage.from('application-documents').upload(path, blob, { contentType: d.type, upsert: false });
      if (error) throw new Error(`"${d.requirement}" could not be uploaded: ${error.message}`);
    }
    documents.push({ requirement: d.requirement, name: d.name, size: d.size, type: d.type, path });
  }
  record = await post({ reference: ref, draft, application: fields, documents });
  return record;
}

// The signed-in Applicant's own requests from the database.
export async function loadMyApplications(): Promise<Application[]> {
  const response = await fetch('/api/applications', { cache: 'no-store' });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(json.error || 'Your requests could not be loaded.'), { status: response.status });
  return json.applications as Application[];
}

// The signed-in person's own notices from the database.
export async function loadMyNotifications(): Promise<AppNotification[]> {
  const response = await fetch('/api/notifications', { cache: 'no-store' });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(json.error || 'Your notifications could not be loaded.'), { status: response.status });
  return json.notifications as AppNotification[];
}
