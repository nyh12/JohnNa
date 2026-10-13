# S&R Pasabuy PH — 필리핀 S&R 대리구매 쇼핑몰

S&R Membership Shopping 회원권이 없는 고객이 S&R 상품을 주문하면 운영자가 대신 사서 배송해 주는
**대리구매(pasabuy) 쇼핑몰**입니다. S&R 온라인 스토어의 상품을 자동으로 가져와 상품 목록을 만들고,
마진을 붙인 가격으로 판매합니다.

## 주요 기능

**고객용 (영어 UI)**
- 카테고리 / 검색 / 정렬 / 페이지 나누기가 있는 상품 목록, 상품 상세
- 장바구니 (서명된 쿠키). 결제할 때 항상 최신 가격으로 다시 계산
- 주문서: 이름, 필리핀 휴대폰 번호 검증, 배송 지역, 주소, 결제수단(GCash / 계좌이체 / COD)
- 주문 완료 페이지에 입금 안내 표시, 주문번호 + 휴대폰 번호로 주문 조회

**관리자용 (`/admin`, Basic 인증)**
- 대시보드: 상품 수, 입금 대기 / 구매 대기 주문, 매출, 동기화 기록, **Sync now** 버튼
- 주문 관리: 상태 변경(입금대기 → 결제완료 → S&R 구매완료 → 배송중 → 배송완료 / 취소), 내부 메모, 주문별 예상 원가·마진
- **장보기 리스트**: 결제완료 주문의 상품을 품목별로 합산 → S&R에 가서 그대로 사면 됨
- 상품 관리: 숨기기, 상품별 가격 직접 지정
- 설정: 마진율(%), 개당 수수료, 가격 반올림 단위, 배송비, 무료배송 기준, 최소 주문금액, 입금 안내문, 배송 지역, 공지 배너

**자동 상품 수집**
- 서버 시작 시(DB가 비어 있으면) + `SYNC_INTERVAL_HOURS`마다 자동 실행, `npm run sync`로 수동 실행
- S&R에서 사라진 상품은 지우지 않고 "판매중지" 처리 (기존 주문 기록 보존)
- 수집이 일부만 성공한 경우(기존 상품의 절반 미만 발견) 판매중지 처리를 건너뛰어, 상품이 한꺼번에 내려가는 사고를 막음

## 판매가 계산

```
판매가 = ⌈ (S&R 가격 × (1 + 마진율%) + 개당 수수료) / 반올림단위 ⌉ × 반올림단위
```
예: S&R ₱1,199, 마진 15%, 반올림 ₱5 → ₱1,380. 관리자 화면에서 상품별 가격을 직접 지정할 수도 있습니다.

## 실행 방법

Node.js 22.5 이상이 필요합니다 (내장 `node:sqlite` 사용 — DB 따로 설치할 필요 없음).

```bash
npm install
cp .env.example .env      # ADMIN_PASSWORD, SESSION_SECRET 설정
npm start                 # http://localhost:3000 , 관리자: /admin
npm test
```

기본값은 `SCRAPER_ADAPTER=mock`(샘플 상품 24개)이라 바로 화면을 확인할 수 있습니다.

## 실제 S&R 상품 연결하기

S&R 온라인 스토어 구조에 맞는 수집기(어댑터)를 고릅니다.

| 어댑터 | 방식 | 언제 사용 |
|---|---|---|
| `sitemap` | `robots.txt`/`sitemap.xml`에서 상품 URL을 모은 뒤, 각 상품 페이지의 schema.org **JSON-LD** (없으면 OpenGraph 메타태그)에서 이름·가격·이미지·재고·카테고리 추출 | 대부분의 쇼핑몰 플랫폼(Magento, WooCommerce, Shopify 등)에서 동작하는 범용 방식 |
| `shopify` | `/products.json` 공개 API로 250개씩 빠르게 수집 | 스토어가 Shopify 기반일 때 |
| `mock` | 샘플 데이터 | 개발/데모 |

1. `.env`에서 `SCRAPER_ADAPTER=sitemap`, `SNR_MAX_PRODUCTS=20`으로 두고 `npm run sync` 실행
2. 로그의 `found N product URLs`가 0이면 `SNR_SITEMAP_URL` 또는 `SNR_PRODUCT_URL_PATTERN`을 S&R 사이트 URL 구조에 맞게 조정
3. 잘 되면 `SNR_MAX_PRODUCTS=0`으로 전체 수집

> 이 코드를 만든 개발 환경에서는 snrshopping.com 접속이 막혀 있어서 실제 사이트 구조는 확인하지 못했습니다.
> 두 어댑터는 표준 형식(sitemap, JSON-LD, Shopify API)을 기준으로 작성하고 테스트로 검증했지만,
> S&R 사이트가 상품 정보를 JavaScript로만 그리거나 로그인해야 가격을 보여준다면
> `src/scraper/`에 전용 어댑터를 하나 추가해야 합니다. `fetchProducts()`가 아래 형태의 객체를 yield 하면 됩니다.
>
> ```js
> { sourceId, url, name, brand, category, description, image, price, currency, inStock }
> ```

## 운영 시 유의사항

- **S&R 이용약관과 robots.txt를 먼저 확인하세요.** 자동 수집이 금지되어 있다면 S&R의 허락을 받거나 상품을 직접 등록하는 방식이 안전합니다. 기본 요청 간격(1.5초)과 동기화 주기(12시간)는 서버 부담을 줄이도록 보수적으로 잡았습니다.
- 상품 이미지는 S&R 서버의 이미지 URL을 그대로 사용합니다. 상표·이미지 사용 범위도 확인하세요. 사이트 하단에 "S&R과 무관한 독립 대리구매 서비스"라는 문구가 들어가 있습니다.
- 필리핀에서 사업으로 운영한다면 DTI 사업자 등록, BIR 등록(세금) 등이 필요할 수 있습니다.
- S&R 가격은 자주 바뀝니다. 실제로 사기 전에 매장 가격·재고를 확인하고, 가격 차이·품절 처리 정책을 "How it works" 페이지에 적어 두는 것을 권장합니다.
- 실제로 배포할 때는 HTTPS(리버스 프록시나 호스팅 서비스) 뒤에서 실행하고, `data/` 폴더(SQLite DB)를 정기적으로 백업하세요.

## 구조

```
src/
  server.js          Express 앱, 자동 동기화 스케줄러
  config.js          환경변수
  db.js              SQLite 스키마, 설정 기본값
  pricing.js         판매가 / 배송비 계산
  cart.js            장바구니
  sync.js            상품 동기화 (upsert, 판매중지 처리)
  scraper/           수집 어댑터 (sitemap, shopify, mock) + JSON-LD 파서
  routes/shop.js     고객용 페이지
  routes/admin.js    관리자 페이지
views/               EJS 템플릿
public/style.css
scripts/sync.js      수동 동기화 CLI
test/                node:test 테스트
```
