import { imageSrcSet } from "@/lib/storage/variants";

/**
 * R2 이미지 한 장. 업로드 때 만들어 둔 여러 크기(#9)를 `srcSet` 으로 넘겨,
 * 폰이 1280px 짜리를 받아 320px 로 줄여 그리는 일을 막는다.
 *
 * `next/image` 를 쓰지 않는 이유: 옵티마이저는 요청마다 우리 Cloud Run CPU 를 태운다.
 * 크기는 이미 업로드 시점에 만들어 뒀고, R2 는 정적 파일을 이그레스 무료로 뱉는다.
 * 사업자가 직접 붙여 넣은 외부 URL 은 규약에 맞지 않으므로 `srcSet` 없이 그대로 나간다.
 */
export function Img({
  src,
  alt,
  sizes,
  className,
  loading,
}: {
  src: string;
  alt: string;
  /** 이 이미지가 화면에서 차지하는 폭. 없으면 브라우저가 뷰포트 전체로 보고 늘 가장 큰 것을 고른다 */
  sizes?: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const { src: url, srcSet } = imageSrcSet(src);
  // eslint-disable-next-line @next/next/no-img-element -- 외부(R2) URL. next/image 옵티마이저를 쓰지 않는 이유는 위 주석
  return <img src={url} srcSet={srcSet} sizes={srcSet ? sizes : undefined} alt={alt} className={className} loading={loading} />;
}
