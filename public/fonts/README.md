# 손글씨 웹폰트

Nanum Pen Script Regular — Sandoll Communication / NHN. [Google Fonts 공식 원본](https://github.com/google/fonts/tree/main/ofl/nanumpenscript)의 전체 글꼴을 자체 호스팅합니다. 라이선스는 함께 제공하는 원문 그대로의 [SIL OFL 1.1](OFL.txt)입니다. CSS 별칭 `WitnessHandwriting`은 글꼴 내부 이름을 바꾸지 않습니다.

| 파일 | 크기 | SHA-256 |
| --- | ---: | --- |
| [원본 TTF](https://raw.githubusercontent.com/google/fonts/main/ofl/nanumpenscript/NanumPenScript-Regular.ttf) | 3,201,664 bytes | `6f0d1ab29c7894010dc88831fb7a0a51edb79136e450344183de5b1a8b52bd43` |
| `handwriting.woff2` | 749,972 bytes | `cb91ab1323cdcfc6b8be723709368dfbe6aed727da8afb42522a1b2dab416e61` |
| `OFL.txt` | 4,534 bytes | `eeacf16032901d0ed0456876ec77b8f0fda6b3fecec7d972f8543eb602e6c30f` |

**포맷 압축만 적용하여 76.58% 줄였습니다.** 서브셋, 글리프 최적화, 이름 변경, 문자 삭제, 타임스탬프 수정은 하지 않았습니다. fontTools 4.67.0 / Brotli 1.2.0을 개발용으로만 사용하고 모든 선택적 글리프 변환을 껐습니다. WOFF 메타데이터도 추가하지 않았습니다. [OFL 공식 FAQ 2.2–2.2.2](https://openfontlicense.org/ofl-faq/)의 압축 포맷 변환 조건에 따라 원래 내부 이름과 저작권 정보를 유지합니다.

재디코드 검증에서 13,751개 글리프의 순서, 11,742개 유니코드 매핑, 전체 이름·저작권 테이블이 같았습니다. `glyf`, `loca`, `hmtx`를 포함한 16개 테이블은 바이트 단위로 동일합니다. [W3C WOFF2 규격](https://www.w3.org/TR/WOFF2/#CompressedDataFormat)에 필요한 빈 `DSIG` 제거, `head.flags` 비트 11 설정, SFNT 체크섬·컨테이너 재구성만 예외입니다. 글리프 형태와 메타데이터는 보존됩니다. 상세 결과는 [verification.json](verification.json)에 있습니다.

재현: 저장소 루트에서 `python scripts/compress-font.py --input ../font-source/NanumPenScript-Regular.ttf`. 원본은 배포 폴더 밖의 `../font-source/`에 보존했습니다. 개발 도구 설치와 별도 경로 옵션은 스크립트 앞부분에 기록했습니다. 설치 패키지는 [공식 PyPI fonttools](https://pypi.org/project/fonttools/), [Brotli](https://pypi.org/project/Brotli/)에서 받았으며 서비스 실행에는 필요하지 않습니다.
