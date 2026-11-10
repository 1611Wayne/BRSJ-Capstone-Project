import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application } from '@/types';
import { teamNotice } from '@/lib/teamNotifications';

// Resolve recipients on the server, never from browser-supplied roles or ids.
// Existing notifications RLS already allows each role to read/mark only its own rows.
export async function persistTeamNotice(db: SupabaseClient, action: string, before: Application | undefined, after: Application, applicationId: number, now: string) {
  const notice = teamNotice(action, before, after);
  if (!notice) return;
  for (let offset = 0; ; offset += 1000) {
    const { data: recipients, error } = await db.from('profiles').select('id').eq('status', 'Active').in('role', ['staff', 'admin']).order('id').range(offset, offset + 999);
    if (error) throw new Error('The change was saved, but Staff/Admin notification recipients could not be loaded: ' + error.message);
    for (const recipient of recipients ?? []) {
      const row = { user_id: recipient.id, application_id: applicationId, event: notice.event, message: notice.message, dedupe_key: notice.key, created_at: now };
      const { error: insertError } = await db.from('notifications').insert(row);
      if (insertError?.code === '23505') {
        // Repeated events replace only the unread notice. Read history stays intact.
        const { error: updateError } = await db.from('notifications').update({ message: notice.message, created_at: now })
          .eq('user_id', recipient.id).eq('dedupe_key', notice.key).is('read_at', null);
        if (updateError) throw new Error('The change was saved, but the team notice could not be updated: ' + updateError.message);
      } else if (insertError) throw new Error('The change was saved, but Staff/Admin were not notified. Ask the backend owner to apply the FT-10 notification event constraint update. ' + insertError.message);
    }
    if ((recipients?.length ?? 0) < 1000) break;
  }
}
