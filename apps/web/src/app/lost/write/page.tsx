'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import NaverLocationPicker from '@/components/common/NaverLocationPicker';
import { getPresignedUrls, uploadToS3, createLostPost } from '@/lib/api/posts';
import { useFlipAnimation } from '@/hooks/useFlipAnimation';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGES = 10;

interface ImageFile {
  file: File;
  previewUrl: string;
  id: string;
}

export default function LostWritePage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  // 공통 필드
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<ImageFile[]>([]);

  // 고양이 정보 필드
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState('');
  const [catColor, setCatColor] = useState('');
  const [catAge, setCatAge] = useState('');
  const [catWeight, setCatWeight] = useState('');
  const [catGender, setCatGender] = useState('');
  const [lostDate, setLostDate] = useState('');
  const [lostLocation, setLostLocation] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  // 제출 상태
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState('');
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  // 이미지 순서 변경 드래그 상태
  const [dragImageId, setDragImageId] = useState<string | null>(null);
  const imageGridRef = useFlipAnimation(images.map((img) => img.id));

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 로그인 확인
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.replace('/login');
    } else {
      setIsLoggedIn(true);
    }
  }, [router]);

  // 언마운트 시 미리보기 URL 해제
  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
  }, [images]);

  // 파일 추가
  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArr = Array.from(files);
    const validFiles = fileArr.filter((f) => ALLOWED_TYPES.includes(f.type));
    if (validFiles.length !== fileArr.length) {
      setError('jpg, png, gif, webp 형식만 업로드할 수 있습니다.');
      return;
    }
    setImages((prev) => {
      const remaining = MAX_IMAGES - prev.length;
      if (remaining <= 0) {
        setError(`이미지는 최대 ${MAX_IMAGES}장까지 업로드 가능합니다.`);
        return prev;
      }
      const toAdd = validFiles.slice(0, remaining).map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
        id: `${Date.now()}-${Math.random()}`,
      }));
      if (validFiles.length > remaining) {
        setError(`이미지는 최대 ${MAX_IMAGES}장까지만 추가할 수 있습니다.`);
      }
      return [...prev, ...toAdd];
    });
    setError('');
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== id);
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

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
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
    if (!lostLocation.trim()) return '실종 위치를 입력해 주세요.';
    if (!content.trim()) return '상세 내용을 입력해 주세요.';
    if (content.trim().length < 2) return '내용은 2자 이상 입력해 주세요.';
    if (content.trim().length > 2000) return '내용은 2000자 이하로 입력해 주세요.';
    if (catAge && (isNaN(Number(catAge)) || Number(catAge) < 0)) return '나이는 0 이상의 숫자를 입력해 주세요.';
    if (catWeight && (isNaN(Number(catWeight)) || Number(catWeight) < 0)) return '몸무게는 0 이상의 숫자를 입력해 주세요.';
    return '';
  };

  // 제출 핸들러
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setIsSubmitting(true);
    setError('');

    try {
      let imageKeys: string[] = [];

      if (images.length > 0) {
        setSubmitStep('이미지 업로드 준비 중...');
        const fileRequests = images.map((img) => ({ contentType: img.file.type, fileSize: img.file.size }));
        const presignedItems = await getPresignedUrls(fileRequests);

        setSubmitStep(`이미지 업로드 중... (0/${images.length})`);
        await Promise.all(
          images.map(async (img, idx) => {
            await uploadToS3(presignedItems[idx].presignedUrl, img.file);
            setSubmitStep(`이미지 업로드 중... (${idx + 1}/${images.length})`);
          })
        );
        imageKeys = presignedItems.map((item) => item.key);
      }

      setSubmitStep('게시글 등록 중...');
      const result = await createLostPost({
        title: title.trim(),
        content: content.trim(),
        catName: catName.trim() || undefined,
        catType: catType.trim() || undefined,
        catColor: catColor.trim() || undefined,
        catAge: catAge ? Number(catAge) : undefined,
        catWeight: catWeight ? Number(catWeight) : undefined,
        catGender: catGender || undefined,
        lostDate: lostDate || undefined,
        lostLocation: lostLocation.trim() || undefined,
        latitude: latitude ?? undefined,
        longitude: longitude ?? undefined,
        imageKeys: imageKeys.length > 0 ? imageKeys : undefined,
      });

      router.push(`/lost/${result.id}`);
    } catch (err) {
      if (err instanceof Error) {
        const data = (err as { data?: { errors?: { field: string; message: string }[] } }).data;
        if (data?.errors?.length) {
          setError(data.errors.map((e) => e.message).join(' / '));
        } else {
          setError(err.message);
        }
      } else {
        setError('게시글 등록에 실패했습니다. 다시 시도해 주세요.');
      }
    } finally {
      setIsSubmitting(false);
      setSubmitStep('');
    }
  };

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
              href="/lost"
              className="flex items-center gap-1.5 text-[13px] opacity-40 hover:opacity-70 transition-opacity no-underline text-charcoal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              실종신고 목록
            </Link>
          </div>
          <h1 className="text-3xl md:text-[40px] font-semibold tracking-[-0.04em]">
            실종 신고하기
          </h1>
          <p className="text-[14px] opacity-50 mt-2">자세한 정보를 입력할수록 찾을 확률이 높아집니다.</p>
        </section>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="max-w-[800px] pb-24">

          {/* 이미지 업로드 */}
          <div className="mb-8">
            <label className="block text-[13px] font-semibold text-charcoal mb-3">
              사진 <span className="font-normal opacity-40">(선택 · 최대 {MAX_IMAGES}장)</span>
            </label>
            {images.length < MAX_IMAGES && (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`w-full h-[160px] rounded-[24px] border-2 border-dashed flex flex-col items-center justify-center gap-3 cursor-pointer transition-all duration-200 ${
                  isDragging
                    ? 'border-brand bg-brand/5 scale-[1.01]'
                    : 'border-black/10 bg-white/50 hover:border-brand/50 hover:bg-white/80'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-medium text-charcoal/60">클릭하거나 사진을 여기에 끌어다 놓으세요</p>
                  <p className="text-[11px] opacity-40 mt-1">jpg, png, gif, webp · 최대 {MAX_IMAGES}장</p>
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
                e.target.value = '';
              }}
            />
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
                    <img src={img.previewUrl} alt="미리보기" className="w-full h-full object-cover" />
                    {i === 0 && (
                      <div className="absolute top-1.5 left-1.5 bg-brand text-white text-[9px] px-1.5 py-0.5 rounded-full font-semibold">썸네일</div>
                    )}
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

          {/* 제목 */}
          <div className="mb-6">
            <label className="block text-[13px] font-semibold text-charcoal mb-3">
              제목 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 강남구 역삼동에서 아이를 잃어버렸어요 (2~100자)"
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
              상세 내용 <span className="text-red-500">*</span> <span className="font-normal opacity-40">(2~2000자)</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="실종 당시 상황, 특징, 연락 방법 등을 자세히 적어주세요."
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

          {/* ===== 고양이 정보 섹션 ===== */}
          <div className="mb-8 bg-white border border-black/[0.06] rounded-[24px] p-6">
            <h3 className="text-[14px] font-semibold mb-5 flex items-center gap-2">
              고양이 정보 <span className="font-normal opacity-40">(선택)</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 이름 */}
              <div>
                <label className="block text-[12px] font-semibold text-charcoal/60 mb-2">이름 <span className="font-normal opacity-40">(선택)</span></label>
                <input
                  type="text"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="예: 구름이"
                  maxLength={50}
                  className="w-full px-4 py-3 bg-[#F8F6F4] border border-transparent rounded-[14px] text-[14px] outline-none focus:border-brand transition-colors placeholder:text-black/25"
                />
              </div>

              {/* 품종 */}
              <div>
                <label className="block text-[12px] font-semibold text-charcoal/60 mb-2">품종</label>
                <input
                  type="text"
                  value={catType}
                  onChange={(e) => setCatType(e.target.value)}
                  placeholder="예: 코리안 숏헤어"
                  maxLength={50}
                  className="w-full px-4 py-3 bg-[#F8F6F4] border border-transparent rounded-[14px] text-[14px] outline-none focus:border-brand transition-colors placeholder:text-black/25"
                />
              </div>

              {/* 색상 */}
              <div>
                <label className="block text-[12px] font-semibold text-charcoal/60 mb-2">색상 / 무늬</label>
                <input
                  type="text"
                  value={catColor}
                  onChange={(e) => setCatColor(e.target.value)}
                  placeholder="예: 브라운 태비"
                  maxLength={50}
                  className="w-full px-4 py-3 bg-[#F8F6F4] border border-transparent rounded-[14px] text-[14px] outline-none focus:border-brand transition-colors placeholder:text-black/25"
                />
              </div>

              {/* 나이 */}
              <div>
                <label className="block text-[12px] font-semibold text-charcoal/60 mb-2">나이 (살)</label>
                <input
                  type="number"
                  value={catAge}
                  onChange={(e) => setCatAge(e.target.value)}
                  placeholder="예: 3"
                  min={0}
                  max={30}
                  className="w-full px-4 py-3 bg-[#F8F6F4] border border-transparent rounded-[14px] text-[14px] outline-none focus:border-brand transition-colors placeholder:text-black/25"
                />
              </div>

              {/* 몸무게 */}
              <div>
                <label className="block text-[12px] font-semibold text-charcoal/60 mb-2">몸무게 (kg)</label>
                <input
                  type="number"
                  value={catWeight}
                  onChange={(e) => setCatWeight(e.target.value)}
                  placeholder="예: 4.5"
                  min={0}
                  step={0.1}
                  className="w-full px-4 py-3 bg-[#F8F6F4] border border-transparent rounded-[14px] text-[14px] outline-none focus:border-brand transition-colors placeholder:text-black/25"
                />
              </div>

              {/* 성별 */}
              <div>
                <label className="block text-[12px] font-semibold text-charcoal/60 mb-2">성별</label>
                <select
                  value={catGender}
                  onChange={(e) => setCatGender(e.target.value)}
                  className="w-full px-4 py-3 bg-[#F8F6F4] border border-transparent rounded-[14px] text-[14px] outline-none focus:border-brand transition-colors"
                >
                  <option value="">선택 안 함</option>
                  <option value="MALE">수컷</option>
                  <option value="FEMALE">암컷</option>
                  <option value="UNKNOWN">모름</option>
                </select>
              </div>

              {/* 실종일자 */}
              <div>
                <label className="block text-[12px] font-semibold text-charcoal/60 mb-2">실종일자</label>
                <input
                  type="date"
                  value={lostDate}
                  onChange={(e) => setLostDate(e.target.value)}
                  className="w-full px-4 py-3 bg-[#F8F6F4] border border-transparent rounded-[14px] text-[14px] outline-none focus:border-brand transition-colors"
                />
              </div>

            </div>

            {/* 실종 위치 — 네이버 지도 선택 */}
            <div className="mt-4">
              <label className="block text-[12px] font-semibold text-charcoal/60 mb-2">
                실종 위치 <span className="text-red-500">*</span>
              </label>
              <NaverLocationPicker
                lostLocation={lostLocation}
                setLostLocation={setLostLocation}
                latitude={latitude}
                setLatitude={setLatitude}
                longitude={longitude}
                setLongitude={setLongitude}
              />
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
              href="/lost"
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
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                  실종 신고 등록
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
