import { apiRequest, BASE_URL, reissueToken } from './client';

// ===== 자랑글 목록 응답 DTO =====
export interface BoastPostItem {
  id: number;
  title: string;
  writer?: string; // 목록 DTO에 미포함 — 렌더링 불필요 필드
  likeCount: number;
  commentCount: number;
  view: number;
  createdAt: string;
  thumbnailUrl: string | null;
}

// ===== 페이지 응답 래퍼 (Spring PageResponse) =====
export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  last: boolean;
}

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

// 자랑글 목록 조회 — GET /api/meow/boast-cat-posts (인증 불필요)
export async function getBoastPosts(page = 0, size = 12) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/boast-cat-posts?page=${page}&size=${size}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error('자랑글 목록을 불러오지 못했습니다.');
  const json: ApiResponse<PageResponse<BoastPostItem>> = await res.json();
  return json.data;
}

// 인기 자랑글 TOP 24 조회 — GET /api/meow/boast-cat-posts/popular (v1, 기본 캐시)
export async function getPopularBoastPosts(): Promise<BoastPostItem[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/boast-cat-posts/popular`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error('인기글을 불러오지 못했습니다.');
  const json: ApiResponse<BoastPostItem[]> = await res.json();
  return json.data;
}


// ===== Presigned URL 응답 =====
export interface PresignedUrlItem {
  presignedUrl: string; // S3에 PUT 요청할 URL
  key: string;          // 게시글 생성 시 전달할 S3 key
}

// Presigned URL 발급 요청 항목 — 파일 크기를 같이 보내야 서버가 10MB/200MB 초과 여부를 검증할 수 있음
export interface PresignedFileRequest {
  contentType: string;
  fileSize: number; // byte
}

// S3 Presigned URL 발급 — POST /api/images/presigned-urls (인증 필요)
export async function getPresignedUrls(files: PresignedFileRequest[]): Promise<PresignedUrlItem[]> {
  const res = await apiRequest<ApiResponse<PresignedUrlItem[]>>('/api/images/presigned-urls', {
    method: 'POST',
    body: JSON.stringify({ files }),
  });
  return res.data;
}

// S3에 이미지 직접 업로드 — PUT presignedUrl
export async function uploadToS3(presignedUrl: string, file: File): Promise<void> {
  const res = await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });
  if (!res.ok) throw new Error('이미지 업로드에 실패했습니다.');
}

// [TEST] 서버 경유(멀티파트) 동영상 업로드 후 자랑글 작성 — POST /api/test/boast-posts/legacy-upload (인증 필요)
// Presigned 방식과의 응답 시간 비교 측정 전용 — local 프로필에서만 동작
export async function legacyUploadBoastPost(
  data: { title: string; content?: string; video: File },
  _retry = true // 401 재시도 여부 (무한 루프 방지)
): Promise<{ id: number }> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const formData = new FormData();
  formData.append('title', data.title);
  formData.append('content', data.content ?? '');
  formData.append('video', data.video);

  const res = await fetch(`${BASE_URL}/api/test/boast-posts/legacy-upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
    credentials: 'include',
  });

  // 401 — 토큰 만료 시 재발급 후 재시도 (apiRequest의 401 처리와 동일한 패턴)
  if (res.status === 401 && _retry) {
    const newToken = await reissueToken();
    if (newToken) {
      return legacyUploadBoastPost(data, false);
    }
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ message: '서버 경유 업로드에 실패했습니다.' }));
    throw new Error(errorData.message ?? '서버 경유 업로드에 실패했습니다.');
  }
  const json: ApiResponse<{ id: number }> = await res.json();
  return json.data;
}

// 자랑글 생성 — POST /api/meow/boast-cat-posts (인증 필요)
export async function createBoastPost(data: {
  title: string;
  content?: string;
  imageKeys?: string[];
  videoKey?: string;
}): Promise<{ id: number }> {
  const res = await apiRequest<ApiResponse<{ id: number }>>('/api/meow/boast-cat-posts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.data;
}

// ===== 자랑글 상세 응답 DTO =====
export interface BoastPostDetail {
  id: number;
  writer: string;
  writerNickname?: string;
  userId: number;
  title: string;
  contents: string;
  imageUrls: string[];
  videoUrl: string | null;
  likeCount: number;
  commentCount: number;
  view: number;
  createdAt: string;
  updatedAt: string;
}

// 자랑글 상세 조회 — GET /api/meow/boast-cat-posts/{id}
export async function getBoastPost(id: number): Promise<BoastPostDetail> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/boast-cat-posts/${id}`
  );
  if (!res.ok) throw new Error('게시글을 불러오지 못했습니다.');
  const json: ApiResponse<BoastPostDetail> = await res.json();
  return json.data;
}

// 자랑글 상세 조회 + 조회수 증가 통합 — GET /api/meow/boast-cat-posts/view/v2/{id} (원자적 UPDATE, 채택)
export async function getBoastPostWithView(id: number): Promise<BoastPostDetail> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/boast-cat-posts/view/v2/${id}`
  );
  if (!res.ok) throw new Error('게시글을 불러오지 못했습니다.');
  const json: ApiResponse<BoastPostDetail> = await res.json();
  return json.data;
}

// ===== 댓글 응답 DTO =====
export interface CommentItem {
  id: number;
  parentCommentId: number | null;
  contents: string;
  isDeleted: boolean;
  userId: number;
  loginId: string;
  createdAt: string;
  updatedAt: string;
  replies: CommentItem[];
}

// 댓글 목록 조회 — GET /api/meow/boast-cat-posts/{id}/comments (인증 불필요)
export async function getBoastComments(postId: number, page = 0, size = 20) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/boast-cat/${postId}/comments?page=${page}&size=${size}`
  );
  if (!res.ok) throw new Error('댓글을 불러오지 못했습니다.');
  const json: ApiResponse<PageResponse<CommentItem>> = await res.json();
  return json.data;
}

// RegisterCommentResponse — 등록 응답 구조 (GetCommentResponse와 다름)
export interface RegisterCommentResult {
  id: number;
  parentCommentId: number | null;
  content: string;
  userId: number;
  userNickname: string;
  createdAt: string;
}

// 댓글 작성 — POST /api/meow/boast-cat-posts/{id}/comments (인증 필요)
export async function postBoastComment(postId: number, content: string, parentCommentId?: number): Promise<RegisterCommentResult> {
  const res = await apiRequest<ApiResponse<RegisterCommentResult>>(
    `/api/meow/boast-cat/${postId}/comments`,
    { method: 'POST', body: JSON.stringify({ content, parentCommentId: parentCommentId ?? null }) }
  );
  return res.data;
}

// 댓글 삭제 — DELETE /api/meow/comments/{commentId} (인증 필요)
export async function deleteComment(commentId: number): Promise<void> {
  await apiRequest(`/api/meow/comments/${commentId}`, { method: 'DELETE' });
}

// 좋아요 등록 — POST /api/meow/boast-cat-posts/{id}/like (인증 필요)
// 반환값: 현재 좋아요 수
export async function likePost(postId: number): Promise<number> {
  const res = await apiRequest<ApiResponse<number>>(`/api/meow/boast-cat-posts/${postId}/like`, {
    method: 'POST',
  });
  return res.data;
}

// 좋아요 취소 — DELETE /api/meow/boast-cat-posts/{id}/like (인증 필요)
// 반환값: 현재 좋아요 수
export async function unlikePost(postId: number): Promise<number> {
  const res = await apiRequest<ApiResponse<number>>(`/api/meow/boast-cat-posts/${postId}/like`, {
    method: 'DELETE',
  });
  return res.data;
}

// 좋아요 여부 확인 — GET /api/meow/boast-cat-posts/{id}/like/status (인증 필요)
export async function getLikeStatus(postId: number): Promise<boolean> {
  const res = await apiRequest<ApiResponse<boolean>>(`/api/meow/boast-cat-posts/${postId}/like/status`);
  return res.data;
}

// ===== 실종글 목록 응답 DTO =====
export interface LostPostItem {
  id: number;
  title: string;
  writer: string;
  catName: string | null;
  lostLocation: string | null;
  commentCount: number;
  view: number;
  completed: boolean;
  createdAt: string;
  thumbnailUrl: string | null;
}

// ===== 실종글 상세 응답 DTO =====
export interface LostPostDetail {
  id: number;
  title: string;
  content: string;        // boast의 contents와 다름 — content
  writer: string;
  writerNickname?: string;
  userId: number;
  catName: string | null;
  catType: string | null;
  catColor: string | null;
  catAge: number | null;
  catWeight: number | null;
  catGender: string | null;
  lostDate: string | null;
  lostLocation: string | null;
  latitude: number | null;
  longitude: number | null;
  reward: number | null;
  commentCount: number;
  view: number;
  imageUrls: string[];
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

// 실종글 댓글 등록 응답 (boast와 동일 구조)
export interface RegisterLostCommentResult {
  id: number;
  parentCommentId: number | null;
  content: string;
  userId: number;
  userNickname: string;
  createdAt: string;
}

// 실종글 목록 조회 — GET /api/meow/lost-cat-posts?page&size (인증 불필요)
export async function getLostPosts(page = 0, size = 12) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/lost-cat-posts?page=${page}&size=${size}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error('실종글 목록을 불러오지 못했습니다.');
  const json: ApiResponse<PageResponse<LostPostItem>> = await res.json();
  return json.data;
}

// 내 주변 실종글 조회 — GET /api/meow/lost-cat-posts/nearby (인증 불필요)
export async function getNearbyLostPosts(lat: number, lng: number, radius = 5, page = 0, size = 12) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/lost-cat-posts/nearby?lat=${lat}&lng=${lng}&radius=${radius}&page=${page}&size=${size}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error('주변 실종글을 불러오지 못했습니다.');
  const json: ApiResponse<PageResponse<LostPostItem>> = await res.json();
  return json.data;
}

// ST_Distance_Sphere 방식 — 정확한 원형 반경 + 가까운 순 정렬
export async function getNearbyLostPostsST(lat: number, lng: number, radius = 5, page = 0, size = 12) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/lost-cat-posts/nearby/st?lat=${lat}&lng=${lng}&radius=${radius}&page=${page}&size=${size}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error('주변 실종글을 불러오지 못했습니다.');
  const json: ApiResponse<PageResponse<LostPostItem>> = await res.json();
  return json.data;
}

// 실종글 상세 조회 — GET /api/meow/lost-cat-posts/{id} (인증 불필요)
export async function getLostPost(id: number): Promise<LostPostDetail> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/lost-cat-posts/${id}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error('실종글을 불러오지 못했습니다.');
  const json: ApiResponse<LostPostDetail> = await res.json();
  return json.data;
}

// 실종글 조회수 증가 — POST /api/meow/lost-cat-posts/{id}/view (인증 불필요)
export async function incrementLostView(id: number) {
  await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/lost-cat-posts/${id}/view`,
    { method: 'POST' }
  );
}

// 실종글 상세 조회 + 조회수 증가 통합 — POST /api/meow/lost-cat-posts/v3/{id}/view
export async function getLostPostWithView(id: number): Promise<LostPostDetail> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/lost-cat-posts/v3/${id}/view`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error('실종글을 불러오지 못했습니다.');
  const json: ApiResponse<LostPostDetail> = await res.json();
  return json.data;
}

// 실종글 댓글 목록 조회 — GET /api/meow/lost-cat-posts/{postId}/comments (인증 불필요)
export async function getLostComments(postId: number, page = 0, size = 20) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/lost-cat/${postId}/comments?page=${page}&size=${size}`
  );
  if (!res.ok) throw new Error('댓글을 불러오지 못했습니다.');
  const json: ApiResponse<PageResponse<CommentItem>> = await res.json();
  return json.data;
}

// 실종글 댓글 작성 — POST /api/meow/lost-cat-posts/{postId}/comments (인증 필요)
export async function postLostComment(postId: number, content: string, parentCommentId?: number): Promise<RegisterLostCommentResult> {
  const res = await apiRequest<ApiResponse<RegisterLostCommentResult>>(
    `/api/meow/lost-cat/${postId}/comments`,
    { method: 'POST', body: JSON.stringify({ content, parentCommentId: parentCommentId ?? null }) }
  );
  return res.data;
}

// 자랑글 삭제 — DELETE /api/meow/boast-cat-posts/{id} (인증 필요)
export async function deleteBoastPost(id: number): Promise<void> {
  await apiRequest(`/api/meow/boast-cat-posts/${id}`, { method: 'DELETE' });
}

// 게시글 수정 시 최종 이미지 순서 항목 (기존/신규 이미지를 하나의 순서 리스트로 표현)
export interface ImageItemRequest {
  type: 'EXISTING' | 'NEW';
  value: string; // EXISTING이면 CloudFront URL, NEW면 S3 key
}

// 게시글 수정 시 동영상 상태 (미포함 시 기존 동영상 유지)
export interface VideoItemRequest {
  type: 'EXISTING' | 'NEW' | 'REMOVE';
  value?: string; // EXISTING이면 CloudFront URL, NEW면 S3 key, REMOVE면 생략 가능
}

// 자랑글 수정 — PUT /api/meow/boast-cat-posts/{id} (인증 필요)
export async function updateBoastPost(id: number, data: {
  title?: string;
  content?: string;
  images?: ImageItemRequest[];
  video?: VideoItemRequest;
}): Promise<void> {
  await apiRequest(`/api/meow/boast-cat-posts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// 실종글 삭제 — DELETE /api/meow/lost-cat-posts/{id} (인증 필요)
export async function deleteLostPost(id: number): Promise<void> {
  await apiRequest(`/api/meow/lost-cat-posts/${id}`, { method: 'DELETE' });
}

// 실종글 상태 변경 — PATCH /api/meow/lost-cat-posts/{id}/status (인증 필요)
export async function patchLostPostStatus(id: number, isCompleted: boolean): Promise<void> {
  await apiRequest(`/api/meow/lost-cat-posts/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ isCompleted }),
  });
}

// 실종글 수정 — PATCH /api/meow/lost-cat-posts/{id} (인증 필요)
export async function updateLostPost(id: number, data: {
  title?: string;
  content?: string;
  catName?: string;
  catType?: string;
  catColor?: string;
  catAge?: number;
  catWeight?: number;
  catGender?: string;
  lostDate?: string;
  lostLocation?: string;
  latitude?: number;
  longitude?: number;
  reward?: number;
  completed?: boolean; // 백엔드 Jackson 프로퍼티명이 isCompleted가 아닌 completed (Lombok isXxx 게터 규칙)
  images?: ImageItemRequest[];
}): Promise<void> {
  await apiRequest(`/api/meow/lost-cat-posts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ===== 서버 검색 API =====

// FTS 검색 결과 페이지 응답 (자랑글)
export interface SearchPageResponse {
  content: BoastPostItem[];
  totalPages: number;
  totalElements: number;
  page: number; // 현재 페이지
  size: number;
}

// FTS 검색 결과 페이지 응답 (실종글)
export interface LostSearchPageResponse {
  content: LostPostItem[];
  totalPages: number;
  totalElements: number;
  page: number;
  size: number;
}

// FTS 검색 — GET /api/meow/boast-cat-posts/search?keyword=... (인덱스 활용, 2글자 이상)
export async function searchByFts(keyword: string, page = 0, size = 12): Promise<SearchPageResponse> {
  const params = new URLSearchParams({ keyword, page: String(page), size: String(size) });
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/boast-cat-posts/search?${params}`
  );
  if (!res.ok) throw new Error('FTS 검색에 실패했습니다.');
  const json: ApiResponse<SearchPageResponse> = await res.json();
  return json.data;
}

// FTS 검색 (자연어 모드) — GET /api/meow/boast-cat-posts/search/natural?keyword=... (50% 이상 문서에 등장하는 단어는 자동 무시됨)
export async function searchByNatural(keyword: string, page = 0, size = 12): Promise<SearchPageResponse> {
  const params = new URLSearchParams({ keyword, page: String(page), size: String(size) });
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/boast-cat-posts/search/natural?${params}`
  );
  if (!res.ok) throw new Error('자연어 모드 검색에 실패했습니다.');
  const json: ApiResponse<SearchPageResponse> = await res.json();
  return json.data;
}

// LIKE 검색 — GET /api/meow/boast-cat-posts/search/like?keyword=... (Full Table Scan, 성능 비교용)
export async function searchByLike(keyword: string, page = 0, size = 12): Promise<SearchPageResponse> {
  const params = new URLSearchParams({ keyword, page: String(page), size: String(size) });
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/boast-cat-posts/search/like?${params}`
  );
  if (!res.ok) throw new Error('LIKE 검색에 실패했습니다.');
  const json: ApiResponse<SearchPageResponse> = await res.json();
  return json.data;
}

// 실종글 FTS 검색 — GET /api/meow/lost-cat-posts/search?keyword=...
export async function searchLostByFts(keyword: string, page = 0, size = 12): Promise<LostSearchPageResponse> {
  const params = new URLSearchParams({ keyword, page: String(page), size: String(size) });
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/lost-cat-posts/search?${params}`
  );
  if (!res.ok) throw new Error('FTS 검색에 실패했습니다.');
  const json: ApiResponse<LostSearchPageResponse> = await res.json();
  return json.data;
}

// 실종글 LIKE 검색 — GET /api/meow/lost-cat-posts/search/like?keyword=...
export async function searchLostByLike(keyword: string, page = 0, size = 12): Promise<LostSearchPageResponse> {
  const params = new URLSearchParams({ keyword, page: String(page), size: String(size) });
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/meow/lost-cat-posts/search/like?${params}`
  );
  if (!res.ok) throw new Error('LIKE 검색에 실패했습니다.');
  const json: ApiResponse<LostSearchPageResponse> = await res.json();
  return json.data;
}

// 실종글 작성 — POST /api/meow/lost-cat-posts (인증 필요)
export async function createLostPost(data: {
  title: string;
  content?: string;
  catName?: string;
  catType?: string;
  catColor?: string;
  catAge?: number;
  catWeight?: number;
  catGender?: string;
  lostDate?: string;
  lostLocation?: string;
  latitude?: number;
  longitude?: number;
  reward?: number;
  imageKeys?: string[];
}): Promise<{ id: number }> {
  const res = await apiRequest<ApiResponse<{ id: number }>>('/api/meow/lost-cat-posts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.data;
}
