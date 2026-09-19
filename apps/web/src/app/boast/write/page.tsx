'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getPresignedUrls, uploadToS3, createBoastPost, legacyUploadBoastPost } from '@/lib/api/posts';
import { useFlipAnimation } from '@/hooks/useFlipAnimation';

// 허용 이미지 형식
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

// 허용 동영상 형식
const ALLOWED_VIDEO_TYPE = 'video/mp4';
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB

// 선택된 이미지 파일 정보
interface ImageFile {
  file: File;
  previewUrl: string; // 로컬 미리보기 URL (URL.createObjectURL)
  id: string;         // 고유 식별자
}

// 선택된 동영상 파일 정보
interface VideoFile {
  file: File;
  previewUrl: string;
}

export default function BoastWritePage() {
  const router = useRouter();

  // 로그인 여부 확인
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  // 폼 상태
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<ImageFile[]>([]);
  const [video, setVideo] = useState<VideoFile | null>(null);

  // 제출 상태
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState('');
  const [error, setError] = useState('');

  // [TEST] 서버 경유(멀티파트) 업로드 상태 — Presigned 방식과의 비교 측정 전용
  const [isLegacyUploading, setIsLegacyUploading] = useState(false);
  const [legacyResult, setLegacyResult] = useState('');

  // 드래그 앤 드롭 상태
  const [isDragging, setIsDragging] = useState(false);
  // 이미지 순서 변경 드래그 상태
  const [dragImageId, setDragImageId] = useState<string | null>(null);
  const imageGridRef = useFlipAnimation(images.map((img) => img.id));

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // 로그인 상태 확인 — 미로그인 시 로그인 페이지로
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.replace('/login');
    } else {
      setIsLoggedIn(true);
    }
  }, [router]);

  // 컴포넌트 언마운트 시 미리보기 URL 해제 (메모리 누수 방지)
  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
  }, [images]);

  useEffect(() => {
    return () => {
      if (video) URL.revokeObjectURL(video.previewUrl);
    };
  }, [video]);

  // 파일 추가 처리
  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArr = Array.from(files);

    // 이미지 형식 필터
    const validFiles = fileArr.filter((f) => ALLOWED_TYPES.includes(f.type));
    if (validFiles.length !== fileArr.length) {
      setError('jpg, png, gif, webp 형식만 업로드할 수 있습니다.');
      return;
    }

    // 이미지 크기 필터 (10MB)
    const sizedFiles = validFiles.filter((f) => f.size <= MAX_IMAGE_BYTES);
    if (sizedFiles.length !== validFiles.length) {
      setError('이미지는 장당 최대 10MB까지 업로드 가능합니다.');
      return;
    }

    setImages((prev) => {
      const remaining = MAX_IMAGES - prev.length;
      if (remaining <= 0) {
        setError(`이미지는 최대 ${MAX_IMAGES}장까지 업로드 가능합니다.`);
        return prev;
      }
      const toAdd = sizedFiles.slice(0, remaining).map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
        id: `${Date.now()}-${Math.random()}`,
      }));
      if (sizedFiles.length > remaining) {
        setError(`이미지는 최대 ${MAX_IMAGES}장까지만 추가할 수 있습니다.`);
      }
      return [...prev, ...toAdd];
    });
    setError('');
  }, []);

  // 동영상 추가 처리 (최대 1개, mp4, 200MB)
  const addVideo = useCallback((file: File) => {
    if (file.type !== ALLOWED_VIDEO_TYPE) {
      setError('mp4 형식만 업로드할 수 있습니다.');
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError('동영상은 최대 200MB까지 업로드 가능합니다.');
      return;
    }
    setVideo((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file) };
    });
    setError('');
  }, []);

  const removeVideo = useCallback(() => {
    setVideo((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  // 이미지 순서 변경 (드래그 앤 드롭으로 위치 교체)
  const reorderImages = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setImages((prev) => {
      const sourceIdx = prev.findIndex((img) => img.id === sourceId);
      const targetIdx = prev.findIndex((img) => img.id === targetId);
      if (sourceIdx === -1 || targetIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  }, []);

  // 이미지 제거
  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  // 드래그 앤 드롭 핸들러
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  // 유효성 검사
  const validate = (): string => {
    if (!title.trim()) return '제목을 입력해 주세요.';
    if (title.trim().length < 2) return '제목은 2자 이상 입력해 주세요.';
    if (title.trim().length > 100) return '제목은 100자 이하로 입력해 주세요.';
    if (content.length > 2000) return '내용은 2000자 이하로 입력해 주세요.';
    return '';
  };

  // 제출 핸들러
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      let imageKeys: string[] = [];
      let videoKey: string | undefined;

      const totalFiles = images.length + (video ? 1 : 0);

      // 이미지/동영상이 있으면 S3 업로드 플로우 진행
      if (totalFiles > 0) {
        // 1단계: Presigned URL 발급 (이미지 + 동영상을 한 번에 요청)
        setSubmitStep('업로드 준비 중...');
        const fileRequests = [
          ...images.map((img) => ({ contentType: img.file.type, fileSize: img.file.size })),
          ...(video ? [{ contentType: video.file.type, fileSize: video.file.size }] : []),
        ];
        const presignedItems = await getPresignedUrls(fileRequests);

        // 2단계: S3에 직접 업로드
        setSubmitStep(`업로드 중... (0/${totalFiles})`);
        let uploaded = 0;
        await Promise.all(
          images.map(async (img, idx) => {
            await uploadToS3(presignedItems[idx].presignedUrl, img.file);
            uploaded += 1;
            setSubmitStep(`업로드 중... (${uploaded}/${totalFiles})`);
          })
        );
        if (video) {
          const videoPresigned = presignedItems[images.length];
          await uploadToS3(videoPresigned.presignedUrl, video.file);
          uploaded += 1;
          setSubmitStep(`업로드 중... (${uploaded}/${totalFiles})`);
          videoKey = videoPresigned.key;
        }

        imageKeys = presignedItems.slice(0, images.length).map((item) => item.key);
      }

      // 3단계: 게시글 생성
      setSubmitStep('게시글 등록 중...');
      const result = await createBoastPost({
        title: title.trim(),
        content: content.trim(), // 빈 문자열도 전송 — DB NOT NULL 제약 대응
        imageKeys: imageKeys.length > 0 ? imageKeys : undefined,
        videoKey,
      });

      // 성공 → 상세 페이지로 이동
      router.push(`/boast/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '게시글 등록에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setIsSubmitting(false);
      setSubmitStep('');
    }
  };

  // [TEST] 서버 경유(멀티파트) 업로드 — 동영상을 서버가 직접 받아 S3로 재전송 후 자랑글 작성
  // Presigned 방식(handleSubmit)과의 응답 시간 비교 측정 전용, local 프로필에서만 동작
  const handleLegacyUpload = async () => {
    if (!video) {
      setLegacyResult('동영상을 먼저 선택해 주세요.');
      return;
    }
    const validationError = validate();
    if (validationError) {
      setLegacyResult(validationError);
      return;
    }

    setIsLegacyUploading(true);
    setLegacyResult('');
    const startedAt = performance.now();

    try {
      const result = await legacyUploadBoastPost({
        title: title.trim(),
        content: content.trim(),
        video: video.file,
      });
      const elapsedMs = Math.round(performance.now() - startedAt);
      setLegacyResult(`서버 경유 업로드 완료 (${elapsedMs}ms) — postId: ${result.id}`);
    } catch (err) {
      setLegacyResult(err instanceof Error ? err.message : '서버 경유 업로드에 실패했습니다.');
    } finally {
      setIsLegacyUploading(false);
    }
  };

  // 로그인 확인 중
  if (isLoggedIn === null) return null;

  return (
    <div
      className="min-h-screen bg-white"
    >

      <div className="max-w-[1440px] mx-auto px-5 md:px-10">

        {/* 페이지 타이틀 */}
        <section className="pt-10 md:pt-[60px] pb-8">
          <div className="flex items-center gap-3 mb-2">
            <Link
              href="/boast"
              className="flex items-center gap-1.5 text-[13px] opacity-40 hover:opacity-70 transition-opacity no-underline text-charcoal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              일상 자랑하기
            </Link>
          </div>
          <h1 className="text-3xl md:text-[40px] font-semibold tracking-[-0.04em]">
            우리 아이 자랑하기
          </h1>
        </section>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="max-w-[800px] pb-24">

          {/* 이미지 업로드 영역 */}
          <div className="mb-8">
            <label className="block text-[13px] font-semibold text-charcoal mb-3">
              사진 <span className="font-normal opacity-40">(선택 · 최대 {MAX_IMAGES}장)</span>
            </label>

            {/* 드래그 앤 드롭 존 */}
            {images.length < MAX_IMAGES && (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  w-full h-[160px] rounded-[24px] border-2 border-dashed
                  flex flex-col items-center justify-center gap-3
                  cursor-pointer transition-all duration-200
                  ${isDragging
                    ? 'border-brand bg-brand/5 scale-[1.01]'
                    : 'border-black/10 bg-white/50 hover:border-brand/50 hover:bg-white/80'
                  }
                `}
              >
                <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E8833A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-medium text-charcoal/60">
                    클릭하거나 사진을 여기에 끌어다 놓으세요
                  </p>
                  <p className="text-[11px] opacity-40 mt-1">
                    jpg, png, gif, webp · 최대 {MAX_IMAGES}장
                  </p>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_TYPES.join(',')}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = ''; // 같은 파일 재선택 허용
              }}
            />

            {/* 이미지 미리보기 그리드 */}
            {images.length > 0 && (
              <div ref={imageGridRef} className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mt-3">
                {images.map((img, i) => (
                  <div
                    key={img.id}
                    data-flip-id={img.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setDragImage(e.currentTarget, e.currentTarget.offsetWidth / 2, e.currentTarget.offsetHeight / 2);
                      setDragImageId(img.id);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragImageId) reorderImages(dragImageId, img.id);
                      setDragImageId(null);
                    }}
                    onDragEnd={() => setDragImageId(null)}
                    className={`relative aspect-square rounded-[16px] overflow-hidden group cursor-grab active:cursor-grabbing ${dragImageId === img.id ? 'opacity-40' : ''}`}
                  >
                    <img
                      src={img.previewUrl}
                      alt="미리보기"
                      className="w-full h-full object-cover"
                    />
                    {/* 썸네일 뱃지 */}
                    {i === 0 && (
                      <div className="absolute top-1.5 left-1.5 bg-brand text-white text-[9px] px-1.5 py-0.5 rounded-full font-semibold">썸네일</div>
                    )}
                    {/* 제거 버튼 */}
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}

                {/* 추가 버튼 (10장 미만일 때) */}
                {images.length < MAX_IMAGES && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square rounded-[16px] border-2 border-dashed border-black/10 flex items-center justify-center hover:border-brand/50 hover:bg-brand/5 transition-all duration-200"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-30">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 동영상 업로드 영역 */}
          <div className="mb-8">
            <label className="block text-[13px] font-semibold text-charcoal mb-3">
              동영상 <span className="font-normal opacity-40">(선택 · mp4, 최대 200MB, 1개)</span>
            </label>

            {!video ? (
              <div
                onClick={() => videoInputRef.current?.click()}
                className="w-full h-[120px] rounded-[24px] border-2 border-dashed border-black/10 bg-white/50 hover:border-brand/50 hover:bg-white/80 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-200"
              >
                <p className="text-[14px] font-medium text-charcoal/60">클릭해서 동영상을 추가하세요</p>
                <p className="text-[11px] opacity-40">mp4 · 최대 200MB</p>
              </div>
            ) : (
              <div className="relative rounded-[16px] overflow-hidden w-full max-w-[320px]">
                <video src={video.previewUrl} controls className="w-full aspect-video bg-black" />
                <button
                  type="button"
                  onClick={removeVideo}
                  className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-red-500"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}

            <input
              ref={videoInputRef}
              type="file"
              accept={ALLOWED_VIDEO_TYPE}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) addVideo(e.target.files[0]);
                e.target.value = '';
              }}
            />

            {/* [TEST] 서버 경유(멀티파트) 업로드 — Presigned 방식과의 응답 시간 비교 측정 전용, local 프로필 */}
            {video && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleLegacyUpload}
                  disabled={isLegacyUploading}
                  className="px-4 py-2 rounded-full text-[12px] font-semibold border border-black/10 text-charcoal/70 hover:bg-black/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLegacyUploading ? '멀티파트 업로드 중...' : '[TEST] 멀티파트 파일로 업로드'}
                </button>
                {legacyResult && (
                  <span className="text-[11px] opacity-60">{legacyResult}</span>
                )}
              </div>
            )}
          </div>

          {/* 제목 */}
          <div className="mb-6">
            <label className="block text-[13px] font-semibold text-charcoal mb-3">
              제목 <span className="text-brand">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="우리 아이를 자랑해 주세요! (2~100자)"
              maxLength={100}
              className="w-full px-6 py-4 bg-white border border-black/[0.06] rounded-[20px] text-[15px] outline-none focus:border-brand transition-colors placeholder:text-black/25"
            />
            <div className="flex justify-end mt-2">
              <span className={`text-[11px] ${title.length >= 90 ? 'text-brand' : 'opacity-30'}`}>
                {title.length} / 100
              </span>
            </div>
          </div>

          {/* 내용 */}
          <div className="mb-8">
            <label className="block text-[13px] font-semibold text-charcoal mb-3">
              내용 <span className="font-normal opacity-40">(선택 · 최대 2000자)</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="우리 아이에 대한 이야기를 들려주세요 :)"
              maxLength={2000}
              rows={8}
              className="w-full px-6 py-4 bg-white border border-black/[0.06] rounded-[20px] text-[15px] outline-none focus:border-brand transition-colors placeholder:text-black/25 resize-none leading-relaxed"
            />
            <div className="flex justify-end mt-2">
              <span className={`text-[11px] ${content.length >= 1900 ? 'text-brand' : 'opacity-30'}`}>
                {content.length} / 2000
              </span>
            </div>
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="mb-6 px-5 py-4 bg-red-50 border border-red-100 rounded-[16px] flex items-start gap-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-[13px] text-red-600">{error}</p>
            </div>
          )}

          {/* 제출 버튼 */}
          <div className="flex items-center gap-4">
            <Link
              href="/boast"
              className="px-8 py-4 bg-white border border-black/[0.06] rounded-full text-[14px] font-medium text-charcoal no-underline hover:bg-black/5 transition-colors"
            >
              취소
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 sm:flex-none flex items-center justify-center gap-3 px-10 py-4 bg-charcoal text-white rounded-full text-[14px] font-semibold hover:bg-gray-800 transition-colors duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {submitStep || '등록 중...'}
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  자랑글 등록하기
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
