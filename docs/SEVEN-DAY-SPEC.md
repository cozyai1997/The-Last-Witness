# 마지막 목격자 4.0 — 승인된 7일 설계와 연결 계약

2026-10-17. 사용자 승인: 전체 구현, GPT 이미지 생성/매핑, 직접 플레이/밸런스 검사, GitHub 커밋과 Vercel 배포.

## 규칙
- 2~6인, 7일. 최종 고발은 DAY7 수사/검토 후 인물 1명. 도구12종/시간대12개는 실제 사건 정답과 교차 증거이며 모두 최종 인물을 입증하는 연결 증거이며 별도 고발 입력은 아니다.
- 공개 인물12, 장소12. 모든 참가자는 역할과 별도로 서로 다른 캐릭터를 무작위 배정받는다. C의 캐릭터가 진범. 배정/미배정 여부는 비공개. 기존 사건은 규칙3으로 계속 진행한다.
- 역할팩은 기존2~6 그대로. S는 독립 역할. D역할만 공개, C/A는 동료를 안다. D/W/C/A는 본인 캐릭터를 안다.
- S는 본인 캐릭터 후보3명으로 시작(범인이 반드시 그 안에 있다는 보장 없음). 개인행동 memory2회로 3→2→1을 얻고 본인 정체를 비공개 확인. memory는 봉쇄 불가. 본인정체 추정은 수정 가능한 메모, 공식 인증/면죄부가 아니다.
- C와 S는 초기 관찰/접근 조건 일부가 비슷하되 고정된 두 특성의 일치로 진범 정보를 유출하지 않는다. 구별하는 진술/증거 경로를 둔다.
- S report는 DAY1~6 본인 개인행동 중 1회. 캐릭터+이유를 봉인, 수정/철회/정답응답 없음. 자기/미배정 캐릭터도 동일 접수. DAY6 본인 턴 마감.
- S 실패는 D의 최종 인물==실제 S인물일 때(제보 정오 무관). 그 외 정확한 제보면 개인승리, 오제보/미제보면 생존·목표미달. DAY1~4 정확 제보는 선제추적. C와 S 동시승리 가능, S는 D에게 협력 의무 없는 중립.
- 개인행동→D공식수사1회→답변/검토→확인. DAY1~6 확인 후 다음날, DAY7 확인 후 final. 채팅은 전 단계.
- D는 question/search/audit/pass, unresolved/rejected questions can be reasked. 기본 search는 부분 원본 기록, 정답 직접 조회가 아니다. kit1은 진술 참거짓만 확정, 현재답변 review-audit는 추가 수사 없이 같은 kit 소비.
- 공식답변 거짓 C/A공유2, Cseal2/Aseal1, Sguard1. 공식 증거 불변. 봉인/유보는 진실 삭제가 아니며 재시도 경로 유지. C/A공유 답변유보1, 그 외 아는 참/거짓 답변. D/W/S는 관찰자료로 아는 참만, 모르면 미진술.
- 초기 D는 인물/현장힌트1개씩. W는 부분 기억(완전한 별도좌표 무상확정 금지). 모든 원본을 읽기만 해도 즉시 C/S가 갈라지는 구조를 피하고 심문/검증 선택을 살린다.
- 이미지/스토리/응답은 미확인 정답, S본인 정체, 타인 배정을 미리 노출하지 않는다. 닉네임 기반 공개 프로필. 결과에만 전체 배정/진상/제보/복기 공개.

## 엔진/화면 계약
- 새 엔진 `lib/seven-engine.cjs` UMD browser global `WitnessSevenEngine`; 공유 공개 데이터/판정은 `public/seven-data.js` global `WitnessSevenData`. Node engine requires that public data file. 실제 비밀은 생성된 state에만 존재한다.
- 기존 `party-engine.cjs`는 v3 보존. 서비스/연습에서 rulesVersion4를 명시해 Seven을 호출하고 act/turnOwner/privateView도 버전별 라우팅한다. 과거 테스트는 보존한다.
- Seven exports makeGame(names,options), act(state,event), turnOwner(state), publicView(state), privateView(state,id), candidates(view), plus public catalog. freeze immutable state. IDs players u0.., people s0..s11, places p0..p11.
- State phases: reveal,secret,investigate,answer,discussion,final,finished. rulesVersion4, maxRounds7, round, players, detectiveId, turnIndex,kits,liesUsed,pending,review,facts,statements,notes,questionHistory,winner,accusation. private/raw fields never in public view.
- Public catalog exports SUSPECTS[{id,name,gender,hand,work,access,...}], PLACES[{id,name,zone,entry,camera,...}], TOOLS[{id,name}], TIMES[{id,name}], CATEGORIES[{id,label,values,group}], RECORDS[{id,label,...}], ROLES,ROLE_PACKS, MAX_ROUNDS7, candidates(view), claimText(category,value), record labels. Agent engine must document exact final fields for UI.
- Events reuse ROLE_SEEN, SECRET_ACTION{kind:memory/report/guard/seal/suggest/pass,category?,suspectId?,text?}, QUESTION{targetId,category,proposedValue}, SEARCH{recordId}, AUDIT{statementId}, ANSWER{value:null|valueIndex}, REVIEW_AUDIT, ROUND_CONFIRM, ACCUSE{suspectId}, ADD_NOTE{text}. Actor added by server, client cannot choose actor/role/identity.
- privateView includes public fields+self{id,name,role,clues,shared,sabotageLeft,guardLeft,identity:{known,characterId?(only earned),candidates,memory,memoryLeft},sealedReport?(Sonly)}. Crime only caseSecret and partnerIds, remainingLies. No role ownership/character ownership on public players (except Drole).
- Finished reveal includes secretNPC{suspectId,placeId,toolId,timeId}, players[{id,name,role,characterId,...}], suspectResult{status:win/loss/survived,...}, replay{version:2,source:recorded,complete:true,events:[...]}.
- seven UI factory `WitnessSevenUI.create({data,esc,icon,send,openModal,closeModal,story,privateState,...})` may be simplified by UI owner; UI owns online-app integration. All mutate actions route same authenticated request adapter, no parallel frontend auth store.
- practice creates v4 using full `seven-practice-engine.js` generated from server engine, bots only use privateView. Practice API0. Existing v3 tests continue through explicit legacy default; default user-visible new online/practice start is v4.

## 材料/QA
- Preserve existing8portraits, add4 (IDs s8..11). Generate twelve-place atlas, twelve-tool atlas, anonymous identity scene. Save originals in .IMG and web assets public/images with exact atlas mapping, prompts/manifests/hashes.
- Rule screen six sections goal/components/setup/play/end/victory; include S tutorial, seven-day dates. Preserve BGM/typewriter/chat/mobile/account-resume/restart/replay.
- Tests: all2..6 roles+distinctchars/randomvariation,7round+earlyaccusationblocked, Smemoryprivacy3→2→1, reportdeadline/once/reconnect/oracle, Slosspriority/alloutcomes, lies/guard/seal/protectedfacts/alternate queries, samefinishedreplay, hostileinputsafe.
- Validate legacy suite, new suite, real local/prod HTTP six seats+resume, browser humanS and humanD/C, 390px mobile rendering, forced-information/AI-policy balance audit without claiming human winrates.
