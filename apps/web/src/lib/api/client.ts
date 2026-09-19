const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorCode: string = 'UNKNOWN_ERROR', // 서버 ErrorCode enum 이름
    public readonly data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// 토큰 재발급 — POST /api/auth/token/refresh
// 서버는 바디 없이 응답 헤더 Authorization에 새 액세스 토큰을 담아 반환
export async function reissueToken(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/token/refresh`, {
      method: 'POST',
      credentials: 'include', // httpOnly refresh 쿠키 자동 전송
    });
    if (!res.ok) return null;
    // 새 액세스 토큰은 Authorization 헤더에 있음 ("Bearer <token>")
    const newToken = res.headers.get('Authorization')?.replace('Bearer ', '') ?? null;
    if (newToken) localStorage.setItem('accessToken', newToken);
    return newToken;
  } catch {
    return null;
  }
}

// 인증이 필요한 API 요청 — 401 시 토큰 재발급 후 1회 재시도
export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  _retry = true  // 재시도 여부 (무한 루프 방지)
): Promise<T> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  // 401 — 토큰 만료 시 재발급 후 재시도
  if (response.status === 401 && _retry) {
    const newToken = await reissueToken();
    if (newToken) {
      // 새 토큰으로 동일 요청 재시도 (재시도 플래그 false)
      return apiRequest<T>(endpoint, options, false);
    }
    // 재발급 실패 → 로그아웃 처리
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('loginId');
      localStorage.removeItem('userId');
      localStorage.removeItem('role');
      window.location.href = '/login';
    }
    throw new ApiError('로그인이 필요합니다.', 401, 'UNAUTHORIZED');
  }

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ message: '오류가 발생했습니다.', errorCode: 'UNKNOWN_ERROR' }));
    throw new ApiError(
      errorData.message ?? `HTTP ${response.status} 오류`,
      response.status,
      errorData.errorCode ?? 'UNKNOWN_ERROR', // 서버가 내려주는 ErrorCode enum 이름
      errorData
    );
  }

  if (response.status === 204) return undefined as T;

  return response.json();
}

export { BASE_URL };
