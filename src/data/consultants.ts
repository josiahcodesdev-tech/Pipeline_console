import { supabase } from './client'
import type { Consultant } from '@/domain/types'
import { unwrap, currentUserId, type ConsultantDraft } from './internal'
import { toConsultant, consultantFields } from './mappers'

export type { ConsultantDraft }

// --------------------------------------------------------- consultants -----

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024
export const MAX_CV_BYTES = 15 * 1024 * 1024

/**
 * Attaches a photo or a CV to a consultant.
 *
 * The path leads with the owner's uid because the storage policies compare
 * that first segment to `auth.uid()` — the shape is what keeps the file
 * private, not a convention.
 *
 * `upsert` is on so replacing a photo overwrites in place rather than leaving
 * the old object orphaned in the bucket. The consultant id in the path is what
 * makes that safe: two consultants never share a file.
 */
async function uploadConsultantFile(
  consultantId: string,
  kind: 'photo' | 'cv',
  file: File,
): Promise<string> {
  const userId = await currentUserId()
  const extension = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const path = `${userId}/${consultantId}/${kind}.${extension?.toLowerCase()}`

  const { error } = await supabase.storage
    .from(CONSULTANT_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: true })

  if (error) throw new Error(`Could not upload the ${kind}: ${error.message}`)
  return path
}

export async function setConsultantPhoto(id: string, file: File): Promise<Consultant> {
  if (!PHOTO_TYPES.includes(file.type)) {
    throw new Error('Use a JPG, PNG, WebP or GIF.')
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('That photo is over 4 MB. Use a smaller one.')
  }
  const path = await uploadConsultantFile(id, 'photo', file)
  const row = unwrap(
    await supabase.from('consultants').update({ photo_path: path }).eq('id', id).select().single(),
  )
  return toConsultant(row)
}

export async function setConsultantCv(id: string, file: File): Promise<Consultant> {
  if (file.size > MAX_CV_BYTES) {
    throw new Error('That CV is over 15 MB. Use a smaller file.')
  }
  const path = await uploadConsultantFile(id, 'cv', file)
  const row = unwrap(
    await supabase
      .from('consultants')
      .update({ cv_path: path, cv_file_name: file.name, cv_size: file.size })
      .eq('id', id)
      .select()
      .single(),
  )
  return toConsultant(row)
}

/**
 * Removes an attached file.
 *
 * The row is cleared first. If the storage delete then fails the file is
 * orphaned, which costs a few kilobytes; doing it the other way round would
 * leave the row pointing at an object that no longer exists, which shows the
 * reader a broken image instead.
 */
export async function clearConsultantFile(
  consultant: Consultant,
  kind: 'photo' | 'cv',
): Promise<Consultant> {
  const path = kind === 'photo' ? consultant.photoPath : consultant.cvPath
  const patch =
    kind === 'photo'
      ? { photo_path: '' }
      : { cv_path: '', cv_file_name: '', cv_size: null }

  const row = unwrap(
    await supabase.from('consultants').update(patch).eq('id', consultant.id).select().single(),
  )
  if (path) await supabase.storage.from(CONSULTANT_BUCKET).remove([path])
  return toConsultant(row)
}

/**
 * A time-limited URL for a stored file.
 *
 * The bucket is private, so there is no permanent address to render — every
 * view has to ask for one, and it stops working shortly afterwards. That is
 * the point: a CV is a named person's document and should not sit behind a
 * URL that works forever for anyone who has ever seen it.
 */
export async function consultantFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CONSULTANT_BUCKET)
    .createSignedUrl(path, 60 * 10)
  if (error || !data?.signedUrl) {
    throw new Error(`Could not open the file: ${error?.message ?? 'no URL returned'}`)
  }
  return data.signedUrl
}

export async function createConsultant(draft: ConsultantDraft): Promise<Consultant> {
  const row = unwrap(
    await supabase
      .from('consultants')
      .insert({ ...consultantFields(draft), user_id: await currentUserId() })
      .select()
      .single(),
  )
  return toConsultant(row)
}

export async function updateConsultant(
  id: string,
  draft: ConsultantDraft,
): Promise<Consultant> {
  const row = unwrap(
    await supabase
      .from('consultants')
      .update(consultantFields(draft))
      .eq('id', id)
      .select()
      .single(),
  )
  return toConsultant(row)
}

export async function deleteConsultant(id: string): Promise<void> {
  const { error } = await supabase.from('consultants').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
