'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBoastPosts, getPopularBoastPosts, searchByFts, searchByLike, type BoastPostItem } from '@/lib/api/posts';
import { formatCount } from '@/lib/format';

// 목록으로 돌아올 때 Router Cache(static 세그먼트, 기본 5분)를 타지 않고 항상 리마운트되어
// useEffect가 재실행되도록 강제 — 조회수/좋아요 등 최신 데이터 반영 보장
export const dynamic = 'force-dynamic';

const THUMBNAIL_GRADIENTS = [
  'from-amber-50 to-orange-100',
  'from-stone-100 to-amber-50',
  'from-orange-50 to-rose-100',
  'from-amber-100 to-yellow-50',
  'from-orange-100 to-amber-50',
  'from-yellow-50 to-orange-50',
];

function PostCard({ post }: { post: BoastPostItem }) {
  const gradient = THUMBNAIL_GRADIENTS[post.id % THUMBNAIL_GRADIENTS.length];
  const router = useRouter();

  return (
    <div
      onClick={() => router.push(`/boast/${post.id}`)}
      className="group cursor-pointer relative aspect-[1/1.1] overflow-hidden rounded-[32px] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-2 hover:scale-[1.02]"
    >
      {/* 배경 이미지 */}
      {post.thumbnailUrl ? (
        <img
          src={post.thumbnailUrl}
          alt={post.title}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`} />
      )}

      {/* 하단 그라디언트 오버레이 */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/65" />

      {/* 텍스트 */}
      <div className="absolute inset-0 p-5 flex flex-col justify-end text-white">
        <h3 className="text-[14px] md:text-[15px] font-semibold leading-[1.4] line-clamp-2 mb-2">
          {post.title}
        </h3>
        <div className="flex gap-3 text-[11px] text-white/70">
          <span className="flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            {formatCount(post.likeCount)}
          </span>
          <span className="flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {formatCount(post.commentCount)}
          </span>
          <span className="flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {formatCount(post.view)}
          </span>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse aspect-[1/1.1] bg-black/5 rounded-[32px]" />
  );
}

const MAX_PAGES = 50;
const BLOCK_SIZE = 10;
const PAGE_SIZE = 28;

function Pagination({
  currentPage,
  totalPages,
  isLoading,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
}) {
  const cappedTotal = Math.min(totalPages, MAX_PAGES);
  if (cappedTotal <= 1) return null;

  const blockStart = Math.floor(currentPage / BLOCK_SIZE) * BLOCK_SIZE;
  const blockEnd = Math.min(blockStart + BLOCK_SIZE, cappedTotal);
  const pages = Array.from({ length: blockEnd - blockStart }, (_, i) => blockStart + i);

  return (
    <div className="flex items-center justify-center gap-1.5 mb-20 flex-wrap">
      <button
        onClick={() => onPageChange(blockStart - 1)}
        disabled={blockStart === 0 || isLoading}
        className="px-4 py-2 rounded-full text-[13px] font-medium bg-white border border-black/10 text-charcoal hover:bg-charcoal hover:text-white hover:border-transparent transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
      >
        이전
      </button>
      {pages.map((page) => (
        <button
          key={page}
          onClick={() => onPageChange(page)}
          disabled={isLoading}
          className={`w-10 h-10 rounded-full text-[13px] font-semibold transition-all duration-200 shadow-sm ${
            page === currentPage
              ? 'bg-charcoal text-white border-charcoal'
              : 'bg-white border border-black/10 text-charcoal hover:bg-charcoal hover:text-white hover:border-transparent'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {page + 1}
        </button>
      ))}
      <button
        onClick={() => onPageChange(blockEnd)}
        disabled={blockEnd >= cappedTotal || isLoading}
        className="px-4 py-2 rounded-full text-[13px] font-medium bg-white border border-black/10 text-charcoal hover:bg-charcoal hover:text-white hover:border-transparent transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
      >
        다음
      </button>
    </div>
  );
}

type SearchMode = 'fts' | 'like' | null;
type TabKey = 'all' | 'popular';

export default function BoastPage() {
  const [tab, setTab] = useState<TabKey>('all');
  const [popularPosts, setPopularPosts] = useState<BoastPostItem[]>([]);
  const [isPopularLoading, setIsPopularLoading] = useState(false);
  const [popularError, setPopularError] = useState('');

  const [posts, setPosts] = useState<BoastPostItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [totalElements, setTotalElements] = useState(0);

  const [searchInput, setSearchInput] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<BoastPostItem[]>([]);
  const [searchTotalElements, setSearchTotalElements] = useState(0);
  const [searchCurrentPage, setSearchCurrentPage] = useState(0);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchElapsed, setSearchElapsed] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getBoastPosts(0, PAGE_SIZE);
        setPosts(data.content);
        setTotalPages(data.totalPages);
        setTotalElements(data.totalElements);
        setCurrentPage(0);
      } catch (e) {
        setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handlePageChange = useCallback(async (page: number) => {
    if (isLoading) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setIsLoading(true);
    try {
      const data = await getBoastPosts(page, PAGE_SIZE);
      setPosts(data.content);
      setTotalPages(data.totalPages);
      setTotalElements(data.totalElements);
      setCurrentPage(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const handleSearch = useCallback(async (mode: 'fts' | 'like') => {
    const keyword = searchInput.trim();
    if (!keyword) return;
    if (keyword.length < 2) {
      setSearchError('검색어는 2글자 이상 입력해주세요.');
      return;
    }
    setSearchMode(mode);
    setSearchKeyword(keyword);
    setIsSearching(true);
    setSearchError('');
    setSearchElapsed(null);
    const start = performance.now();
    try {
      const fn = mode === 'fts' ? searchByFts : searchByLike;
      const data = await fn(keyword, 0, PAGE_SIZE);
      setSearchResults(data.content);
      setSearchTotalElements(data.totalElements);
      setSearchCurrentPage(0);
      setSearchTotalPages(data.totalPages);
      setSearchElapsed(Math.round(performance.now() - start));
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : '검색 중 오류가 발생했습니다.');
    } finally {
      setIsSearching(false);
    }
  }, [searchInput]);

  const handleSearchPageChange = useCallback(async (page: number) => {
    if (!searchMode || isSearching) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setIsSearching(true);
    const fn = searchMode === 'fts' ? searchByFts : searchByLike;
    const start = performance.now();
    try {
      const data = await fn(searchKeyword, page, PAGE_SIZE);
      setSearchResults(data.content);
      setSearchTotalPages(data.totalPages);
      setSearchTotalElements(data.totalElements);
      setSearchCurrentPage(page);
      setSearchElapsed(Math.round(performance.now() - start));
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : '검색 중 오류가 발생했습니다.');
    } finally {
      setIsSearching(false);
    }
  }, [searchMode, searchKeyword, isSearching]);

  const handleClearSearch = useCallback(() => {
    setSearchMode(null);
    setSearchInput('');
    setSearchKeyword('');
    setSearchResults([]);
    setSearchError('');
    setSearchElapsed(null);
    setSearchCurrentPage(0);
    setSearchTotalPages(1);
  }, []);

  const handleTabChange = useCallback(async (newTab: TabKey) => {
    setTab(newTab);
    if (newTab === 'popular' && popularPosts.length === 0) {
      setIsPopularLoading(true);
      setPopularError('');
      try {
        const data = await getPopularBoastPosts();
        setPopularPosts(data);
      } catch (e) {
        setPopularError(e instanceof Error ? e.message : '오류가 발생했습니다.');
      } finally {
        setIsPopularLoading(false);
      }
    }
  }, [popularPosts.length]);

  const isSearchActive = searchMode !== null;
  const displayPosts = isSearchActive ? searchResults : tab === 'popular' ? popularPosts : posts;
  const displayLoading = isSearchActive ? isSearching : tab === 'popular' ? isPopularLoading : isLoading;
  const displayError = isSearchActive ? searchError : tab === 'popular' ? popularError : error;

  return (
    <div
      className="min-h-screen bg-white"
    >

      <div className="max-w-[1440px] mx-auto px-5 md:px-10">

        {/* ===== 브라우즈 헤더 ===== */}
        <section className="pt-6 md:pt-10 pb-8 md:pb-10">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between mb-5">
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center flex-wrap">

              {/* 검색 입력 필드 */}
              <div className="flex items-center gap-3 bg-white border border-black/5 px-6 py-3 rounded-full min-w-[260px] focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-brand/10 transition-all duration-200">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30 flex-shrink-0">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearch('fts'); }}
                  placeholder="제목 또는 내용 검색"
                  className="border-none outline-none w-full text-[14px] bg-transparent placeholder:text-black/30"
                />
                {searchInput && (
                  <button onClick={handleClearSearch} className="opacity-30 hover:opacity-60 transition-opacity flex-shrink-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>

              {/* 검색 버튼 (BOOLEAN MODE) */}
              <button
                onClick={() => handleSearch('fts')}
                disabled={isSearching}
                className={`flex items-center gap-2 px-4 py-3 rounded-full text-[13px] font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed border
                  ${searchMode === 'fts'
                    ? 'bg-charcoal text-white border-charcoal shadow-md'
                    : 'bg-white text-charcoal border-black/10 hover:bg-black/5'}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                {isSearching && searchMode === 'fts' ? '검색 중...' : '검색'}
              </button>

            </div>

            {/* 자랑하기 버튼 */}
            <Link
              href="/boast/write"
              className="flex items-center gap-2 px-5 py-3 bg-charcoal text-white rounded-full text-[13px] font-semibold no-underline hover:bg-gray-800 transition-colors duration-300 self-start sm:self-auto"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              자랑하기
            </Link>
          </div>

          {/* 검색 상태 / 탭 + 게시글 수 */}
          {!isLoading && (
            <div className="flex flex-col gap-1">
              {isSearchActive ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold bg-charcoal/10 text-charcoal">
                    검색결과
                  </span>
                  <p className="text-[13px] opacity-50">
                    &ldquo;{searchKeyword}&rdquo; 검색결과 {searchTotalElements.toLocaleString()}개
                  </p>
                  <button onClick={handleClearSearch} className="text-[12px] opacity-40 hover:opacity-70 underline transition-opacity">
                    초기화
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 mt-3">
                  <button
                    onClick={() => handleTabChange('all')}
                    className={`px-5 py-2 rounded-full text-[13px] font-semibold transition-colors ${tab === 'all' ? 'bg-charcoal text-white' : 'bg-white border border-black/10 text-charcoal hover:bg-black/5'}`}
                  >
                    전체
                  </button>
                  <button
                    onClick={() => handleTabChange('popular')}
                    className={`px-5 py-2 rounded-full text-[13px] font-semibold transition-colors ${tab === 'popular' ? 'bg-charcoal text-white' : 'bg-white border border-black/10 text-charcoal hover:bg-black/5'}`}
                  >
                    인기글
                  </button>
                </div>
              )}
              {searchError && <p className="text-[13px] text-rose-500">{searchError}</p>}
            </div>
          )}
        </section>

        {/* ===== 구분선 ===== */}
        <div className="w-full h-[1px] bg-black/5 mb-8" />

        {/* ===== 게시글 그리드 ===== */}
        {displayError && !isSearchActive ? (
          <div className="py-20 text-center">
            <p className="text-red-500 mb-4">{displayError}</p>
            <button onClick={() => window.location.reload()} className="px-6 py-3 bg-charcoal text-white rounded-full text-sm font-medium">
              다시 시도
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6 md:gap-8 mb-10">
              {displayLoading
                ? Array.from({ length: PAGE_SIZE }).map((_, i) => <SkeletonCard key={i} />)
                : displayPosts.length === 0
                ? (
                  <div className="col-span-full py-20 text-center opacity-50">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-4 opacity-40">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <p className="text-[15px]">{isSearchActive ? '검색 결과가 없습니다.' : '게시글이 없습니다.'}</p>
                  </div>
                )
                : displayPosts.map((post) => <PostCard key={post.id} post={post} />)
              }
            </div>

            {/* 페이지네이션 — 인기글 탭에서는 미표시 */}
            {isSearchActive ? (
              <Pagination
                currentPage={searchCurrentPage}
                totalPages={searchTotalPages}
                isLoading={isSearching}
                onPageChange={handleSearchPageChange}
              />
            ) : tab === 'all' ? (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                isLoading={isLoading}
                onPageChange={handlePageChange}
              />
            ) : null}
          </>
        )}

      </div>

    </div>
  );
}
