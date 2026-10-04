import { supabase } from './supabase'

// 공지사항 — ERP 웹 게시판(board_posts)과 같은 데이터를 읽는다.
// 공지로 치는 기준: 공지 카테고리(board_categories.is_notice_board) 글 또는 is_notice 글.
export interface NoticePost {
  id: string
  title: string
  content: string
  is_notice: boolean
  created_at: string
}

export async function fetchNotices(limit?: number): Promise<NoticePost[]> {
  const { data: cats } = await supabase
    .from('board_categories')
    .select('id')
    .eq('is_notice_board', true)

  const categoryIds = (cats ?? []).map(c => c.id as string)

  let query = supabase
    .from('board_posts')
    .select('id, title, content, is_notice, created_at')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  if (categoryIds.length > 0) {
    query = query.or(`category_id.in.(${categoryIds.join(',')}),is_notice.eq.true`)
  } else {
    query = query.eq('is_notice', true)
  }
  if (limit) query = query.limit(limit)

  const { data, error } = await query
  if (error || !data) return []
  return data as NoticePost[]
}

export function formatNoticeDate(dateStr: string): string {
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
