'use strict';
/*
 * 중간고사 스터디 플래너
 * - 상태는 localStorage에 저장된다.
 * - 스케줄은 replan(start)가 start일부터 마지막 시험일까지 하루씩 그리디로 다시 계산한다.
 *   완료한 항목은 그 날짜에 고정(pinned)되고, 나머지는 모두 다시 배치된다.
 */
(() => {
  // ---------------------------------------------------------------- 상수
  const STORAGE_KEY = 'studyPlanner.v1';
  const UNDO_KEY = 'studyPlanner.v1.undo';
  const PLAN_START = '2026-09-28';   // 계획 시작일
  const WEEK1_MON = '2026-08-31';    // 1주차 월요일 (9/1 개강 기준)
  const DDAY = '2026-10-19';         // D-Day
  const BOARD_START = '2026-09-28';  // 달력 첫 칸 (월)
  const BOARD_END = '2026-10-25';    // 달력 마지막 칸 (일)
  const WD = ['일', '월', '화', '수', '목', '금', '토'];

  const SUBJECTS = [
    { id: 'dm',    name: '이산수학',                 short: '이산수학', exam: '2026-10-19' },
    { id: 'linux', name: '리눅스시스템',             short: '리눅스',   exam: '2026-10-19' },
    { id: 'sat',   name: '위성정보 이해와 처리',     short: '위성정보', exam: '2026-10-21' },
    { id: 'sec',   name: '융합보안 프리캡스톤 디자인', short: '융합보안', exam: '2026-10-21' },
    { id: 'db',    name: '데이터베이스',             short: 'DB',       exam: '2026-10-22' },
    { id: 'hum',   name: '인문학으로 바라본 과학생활', short: '인문학',   exam: '2026-10-22' },
  ];
  const SUBJ = Object.fromEntries(SUBJECTS.map(s => [s.id, s]));
  const LAST_EXAM = SUBJECTS.reduce((m, s) => (s.exam > m ? s.exam : m), '');
  const WEEKLY_VIDEO = new Set(['linux', 'sat', 'hum']); // 영상강의가 주차별로 1개씩인 과목

  const DM_LECTURES = [
    ['1장. 수의 표현과 연산 (1/3)', '1장(1/3)'],
    ['1장. 수의 표현과 연산 (2/3)', '1장(2/3)'],
    ['1장. 수의 표현과 연산 (3/3)', '1장(3/3)'],
    ['2장. 집합', '2장'],
    ['3장. 논리와 명제 (1/2)', '3장(1/2)'],
    ['3장. 논리와 명제 (2/2)', '3장(2/2)'],
    ['4장. 관계 (1)', '4장(1)'],
    ['4장. 관계 (2)', '4장(2)'],
    ['5장. 함수 (1)', '5장(1)'],
    ['5장. 함수 (2)', '5장(2)'],
    ['6장. 증명', '6장'],
  ];
  const DB_LECTURES = ['CH1-A', 'CH1-B', 'CH2-A', 'CH3-A', 'CH3-B', 'CH3-C', 'CH3-D', 'CH3-E', 'CH3-F',
    'CH6-A', 'CH6-B', 'CH6-C', 'CH5-A', 'Normalization_A'];

  const KIND_LABEL = { video: '영상강의', offline: '현장 복습', project: '실습·발표', custom: '추가 학습' };
  const TYPE_ORDER = { carry: 0, skim: 1, cum: 2, task: 3, practice: 4, final: 5 };

  const DEFAULT_SETTINGS = {
    hours: { 0: 7, 1: 9, 2: 9, 3: 7, 4: 8, 5: 4, 6: 8 }, // 일~토
    videoH: 1.5,
    offlineH: 1,
    skimH: 0.25,
    cumH: 0.5,
    cycle: 7,
    examPenalty: 1.5,
    classDays: { dm: null, linux: null, sat: null, sec: null, db: null, hum: null },
  };

  // ---------------------------------------------------------------- 날짜 유틸 (YYYY-MM-DD 문자열, UTC 계산)
  const pad = n => String(n).padStart(2, '0');
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const utcKey = t => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  const localKey = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const addDays = (k, n) => { const t = parseKey(k); t.setUTCDate(t.getUTCDate() + n); return utcKey(t); };
  const weekday = k => parseKey(k).getUTCDay();
  const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
  const realToday = () => localKey(new Date());
  const maxKey = (a, b) => (a > b ? a : b);
  const minKey = (a, b) => (a < b ? a : b);
  const fmt = k => { const t = parseKey(k); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}(${WD[t.getUTCDay()]})`; };
  const fmtShort = k => { const t = parseKey(k); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`; };
  const weekMon = w => addDays(WEEK1_MON, 7 * (w - 1));
  const h = n => `${+n.toFixed(2)}h`;
  const roundQ = n => Math.round(n * 4) / 4;

  // ---------------------------------------------------------------- 상태
  let state;
  const ui = { selected: null, resetOpen: false };

  function buildTasks() {
    const T = [];
    const push = (subj, stream, seq, o) => T.push({
      id: `${subj}-${stream}${seq}`, subj, stream, seq, week: null, hours: null, done: false, doneOn: null, ...o,
    });
    DM_LECTURES.forEach(([title, short], i) => push('dm', 'v', i + 1, { kind: 'video', title: `영상강의 · ${title}`, short }));
    for (const s of ['linux', 'sat', 'hum']) {
      for (let w = 1; w <= 7; w++) {
        push(s, 'v', w, { kind: 'video', week: w, title: `${w}주차 영상강의`, short: `${w}주차 영상` });
        push(s, 'o', w, { kind: 'offline', week: w, title: `${w}주차 현장강의 복습·정리`, short: `${w}주차 현장` });
      }
    }
    DB_LECTURES.forEach((c, i) => push('db', 'v', i + 1, { kind: 'video', title: `영상강의 · ${c}`, short: c }));
    for (let w = 1; w <= 7; w++) {
      push('db', 'o', w, { kind: 'offline', week: w, title: `${w}주차 현장강의 복습·정리`, short: `${w}주차 현장` });
    }
    push('sec', 'p', 1, { kind: 'project', title: '실습 내용·결과물 정리', short: '실습 정리', hours: 1.5 });
    push('sec', 'p', 2, { kind: 'project', title: '발표 자료·예상 질문 정리', short: '발표 준비', hours: 1.5 });
    return T;
  }

  function freshState() {
    const today = realToday();
    return {
      version: 1,
      settings: structuredClone(DEFAULT_SETTINGS),
      tasks: buildTasks(),
      schedule: {},
      carryPool: [],
      events: [],
      memos: {},
      log: [],
      unplaced: [],
      currentDay: minKey(maxKey(today, PLAN_START), LAST_EXAM),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.version === 1 && Array.isArray(s.tasks)) {
          s.settings = { ...structuredClone(DEFAULT_SETTINGS), ...s.settings };
          s.settings.classDays = { ...DEFAULT_SETTINGS.classDays, ...s.settings.classDays };
          return s;
        }
      }
    } catch (e) { /* 저장소 사용 불가 → 새 상태 */ }
    return null;
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
  }
  let uidN = 0;
  const uid = p => `${p}${Date.now().toString(36)}${(uidN++).toString(36)}`;

  // ---------------------------------------------------------------- 도메인 헬퍼
  const taskById = id => state.tasks.find(t => t.id === id);
  const hoursOf = t => t.hours ?? ({ video: state.settings.videoH, offline: state.settings.offlineH }[t.kind] ?? 1);
  function classDate(subj, w) {
    const cd = state.settings.classDays[subj];
    if (cd === null || cd === undefined || cd === '') return null;
    return addDays(weekMon(w), (Number(cd) + 6) % 7); // 월=0 오프셋
  }
  function availOf(t) {
    if (t.week) {
      if (t.kind === 'video') return weekMon(t.week);
      if (t.kind === 'offline') return classDate(t.subj, t.week) || weekMon(t.week);
    }
    return '0000-00-00';
  }
  const examsOn = d => SUBJECTS.filter(s => s.exam === d);
  const eveSubjects = d => SUBJECTS.filter(s => s.exam === addDays(d, 1)).map(s => s.id);
  const eventHours = d => state.events.filter(e => e.date === d).reduce((a, e) => a + (Number(e.hours) || 0), 0);
  function capOf(d) {
    const st = state.settings;
    const base = Number(st.hours[weekday(d)]) || 0;
    return Math.max(0, base - eventHours(d) - st.examPenalty * examsOn(d).length);
  }
  const itemsOf = d => state.schedule[d] || [];
  const sumHours = arr => arr.reduce((a, it) => a + it.hours, 0);

  // 수업 요일이 지정된 과목: 영상강의를 수업 전날까지 끝내도록 마감일 계산
  function computeDues(start) {
    const dues = {};
    for (const s of SUBJECTS) {
      if (classDate(s.id, 1) === null) continue;
      const vids = state.tasks.filter(t => t.subj === s.id && t.kind === 'video' && !t.done).sort((a, b) => a.seq - b.seq);
      if (!vids.length) continue;
      if (WEEKLY_VIDEO.has(s.id)) {
        for (const v of vids) {
          const c = classDate(s.id, v.week);
          if (c > start && c < s.exam) dues[v.id] = addDays(c, -1);
        }
      } else {
        // 주차 매핑이 없는 강의 묶음 → 남은 수업일에 맞춰 균등하게 선행
        const classes = [];
        for (let w = 1; w <= 8; w++) { const c = classDate(s.id, w); if (c > start && c < s.exam) classes.push(c); }
        const K = classes.length, N = vids.length;
        if (!K) continue;
        vids.forEach((v, j) => { dues[v.id] = addDays(classes[Math.ceil((j + 1) * K / N) - 1], -1); });
      }
    }
    return dues;
  }

  // ---------------------------------------------------------------- 스케줄 재계산 (핵심)
  function replan(start) {
    const st = state.settings;
    // 1) start 이후: 완료 항목만 남기고 비움
    for (const k of Object.keys(state.schedule)) {
      if (k >= start) {
        state.schedule[k] = state.schedule[k].filter(it => it.done);
        if (!state.schedule[k].length) delete state.schedule[k];
      }
    }
    // 2) 이월 대기열 정리
    const doneIds = new Set();
    Object.values(state.schedule).forEach(arr => arr.forEach(it => { if (it.done) doneIds.add(it.id); }));
    state.carryPool = state.carryPool.filter(c => !doneIds.has(c.id) && SUBJ[c.subj].exam > start);
    const carryQ = state.carryPool.slice();

    // 3) 미완료 기본 과제 → 과목·스트림별 큐 (주차 순서 유지)
    const streams = {};
    [...state.tasks].sort((a, b) => a.seq - b.seq).forEach(t => {
      if (t.done) return;
      (streams[`${t.subj}|${t.stream}`] ||= []).push(t);
    });
    const dues = computeDues(start);
    const learned = {};
    SUBJECTS.forEach(s => { learned[s.id] = state.tasks.filter(t => t.subj === s.id && t.done).sort((a, b) => a.seq - b.seq); });

    // 가용시간 사전 계산
    const capMap = {}, eveMap = {};
    for (let d = start; d <= LAST_EXAM; d = addDays(d, 1)) { capMap[d] = capOf(d); eveMap[d] = eveSubjects(d); }
    const capUntil = (subj, from, to) => {
      let sum = 0;
      for (let d = from; d < to && d <= LAST_EXAM; d = addDays(d, 1)) {
        const e = eveMap[d];
        if (!e.length || e.includes(subj)) sum += capMap[d];
      }
      return sum;
    };
    const remainingOf = subj => Object.entries(streams)
      .filter(([k]) => k.startsWith(`${subj}|`))
      .reduce((a, [, q]) => a + q.reduce((b, t) => b + hoursOf(t), 0), 0);
    const ready = (t, d) => {
      if (availOf(t) > d) return false;
      if (t.kind === 'offline' && t.week && WEEKLY_VIDEO.has(t.subj)) { // 같은 주차 영상강의 먼저
        const vq = streams[`${t.subj}|v`];
        if (vq && vq.length && vq[0].week <= t.week) return false;
      }
      return true;
    };

    // 지난 날에서 이월된 과제 표시용
    const carriedFrom = {};
    for (const [d, arr] of Object.entries(state.schedule)) {
      if (d >= start) continue;
      arr.forEach(it => { if (it.type === 'task' && it.carried && !(carriedFrom[it.taskId] > d)) carriedFrom[it.taskId] = d; });
    }

    // 전날 학습한 항목 (누적식 훑어보기 대상)
    let prev = {};
    itemsOf(addDays(start, -1)).forEach(it => {
      if (it.type === 'task' && it.done) (prev[it.subj] ||= []).push(taskById(it.taskId));
    });

    for (let d = start; d <= LAST_EXAM; d = addDays(d, 1)) {
      const items = state.schedule[d] ? state.schedule[d] : [];
      const today = {};
      items.forEach(it => { if (it.type === 'task') (today[it.subj] ||= []).push(taskById(it.taskId)); });
      let used = sumHours(items);
      const cap = capMap[d];
      const eve = eveMap[d];
      const alive = s => SUBJ[s].exam > d;
      const allowed = s => alive(s) && (!eve.length || eve.includes(s));
      const add = it => {
        if (items.some(x => x.id === it.id)) return false;
        items.push({ done: false, ...it, date: d });
        used += it.hours;
        return true;
      };

      // (a) 이월된 복습 항목
      for (let i = 0; i < carryQ.length; i++) {
        const c = carryQ[i];
        if (!allowed(c.subj)) continue;
        add({ id: c.id, type: 'carry', subj: c.subj, title: c.title, detail: c.detail, hours: c.hours, from: c.from });
        carryQ.splice(i--, 1);
      }

      if (!eve.length) {
        // (b) 누적식 진도: 전날 공부한 내용 훑어보기
        for (const s of Object.keys(prev)) {
          if (!allowed(s) || !prev[s].length || st.skimH <= 0) continue;
          const list = prev[s];
          add({
            id: `skim-${s}-${d}`, type: 'skim', subj: s,
            title: '어제 공부한 내용 훑어보기',
            detail: list.map(t => t.short).join(', '),
            hours: Math.min(0.75, roundQ(list.length * st.skimH)),
          });
        }
        // (c) N일 주기 누적 복습
        if (st.cycle > 0 && st.cumH > 0 && (diffDays(PLAN_START, d) + 1) % st.cycle === 0) {
          for (const s of SUBJECTS) {
            const L = learned[s.id];
            if (!allowed(s.id) || !L.length) continue;
            add({
              id: `cum-${s.id}-${d}`, type: 'cum', subj: s.id,
              title: `${st.cycle}일 누적 복습 (${L.length}개 항목)`,
              detail: L.length > 1 ? `${L[0].short} ~ ${L[L.length - 1].short}` : L[0].short,
              hours: st.cumH,
            });
          }
        }
      }

      // (d) 새 진도 배치: 시험 임박도·마감(수업 전날)·과목 분산을 점수로 그리디 선택
      const pool = eve.length ? eve : SUBJECTS.map(s => s.id).filter(alive);
      for (;;) {
        const cands = [];
        for (const [key, q] of Object.entries(streams)) {
          const subj = key.split('|')[0];
          if (!pool.includes(subj) || !q.length || !ready(q[0], d)) continue;
          const t = q[0];
          const due = dues[t.id];
          let score;
          if (eve.length) {
            score = 1000 - SUBJECTS.findIndex(s => s.id === subj);
          } else if (due && due <= d) {
            score = 500 + remainingOf(subj);
          } else {
            const examEve = addDays(SUBJ[subj].exam, -1);
            score = remainingOf(subj) / Math.max(capUntil(subj, d, examEve), 1);
            if (due) {
              const need = q.filter(x => dues[x.id] && dues[x.id] <= due).reduce((a, x) => a + hoursOf(x), 0);
              score = Math.max(score, 1.5 * need / Math.max(capUntil(subj, d, addDays(due, 1)), 1));
            }
            score /= 1 + 0.9 * (today[subj]?.length || 0);
          }
          score -= (t.week || 0) * 1e-4;
          cands.push({ key, t, score });
        }
        cands.sort((a, b) => b.score - a.score);
        const pick = cands.find(c => hoursOf(c.t) <= cap - used + 0.25 + 1e-9);
        if (!pick) break;
        const t = pick.t;
        add({ id: `t-${t.id}`, type: 'task', taskId: t.id, subj: t.subj, kind: t.kind, title: t.title, hours: hoursOf(t), due: dues[t.id] || null, from: carriedFrom[t.id] || null });
        streams[pick.key].shift();
        (today[t.subj] ||= []).push(t);
        learned[t.subj].push(t);
        learned[t.subj].sort((a, b) => a.seq - b.seq);
      }

      // (e) 남는 시간
      let rest = roundQ(cap - used);
      if (eve.length) {
        // 시험 전날: 해당 과목 올인 총정리
        const per = Math.floor(rest / eve.length / 0.5) * 0.5;
        if (per >= 0.5) {
          for (const s of eve) {
            const L = learned[s];
            add({
              id: `final-${s}-${d}`, type: 'final', subj: s,
              title: '시험 전날 총정리 (전 범위)',
              detail: L.length ? `${L[0].short} ~ ${L[L.length - 1].short} · 핵심 개념·누적 복습 노트·오답 점검` : '전 범위 핵심 개념 점검',
              hours: per,
            });
          }
        }
      } else if (rest >= 1) {
        // 여유 시간: 시험이 가까운 과목부터 문제풀이 (과목당 최대 2h)
        const subs = SUBJECTS.filter(s => allowed(s.id) && learned[s.id].length).sort((a, b) => a.exam.localeCompare(b.exam));
        for (const s of subs) {
          const hh = Math.min(2, Math.floor(rest * 2) / 2);
          if (hh < 1) break;
          add({ id: `prac-${s.id}-${d}`, type: 'practice', subj: s.id, title: '문제풀이 · 취약 부분 보강', detail: '누적 복습 노트 기반 연습문제', hours: hh });
          rest -= hh;
        }
      }

      if (items.length) state.schedule[d] = items; else delete state.schedule[d];
      prev = today;
    }

    // 4) 시험 전까지 배정하지 못한 항목
    state.unplaced = [];
    for (const q of Object.values(streams)) q.forEach(t => state.unplaced.push({ subj: t.subj, title: t.title }));
    state.carryPool = state.carryPool.filter(c => !carryQ.includes(c));
  }

  // ---------------------------------------------------------------- 하루 마감 + 재배치
  function closeDayAndReplan() {
    const day = state.currentDay;
    if (day > LAST_EXAM) { toast('시험 기간이 끝나 재배치할 일정이 없습니다.'); return; }
    try { localStorage.setItem(UNDO_KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
    ui.undo = JSON.stringify(state);

    const next = maxKey(addDays(day, 1), realToday());
    let count = 0, hours = 0;
    for (let d = day; d < next; d = addDays(d, 1)) {
      for (const it of itemsOf(d)) {
        if (it.done) continue;
        const alive = SUBJ[it.subj] && SUBJ[it.subj].exam > next;
        if (it.type === 'task' || it.type === 'skim' || it.type === 'cum' || it.type === 'carry') {
          it.carried = alive; it.missed = !alive;
          if (alive) { count++; hours += it.hours; }
          if (alive && it.type !== 'task') {
            state.carryPool.push({
              id: uid('c'), subj: it.subj,
              title: it.type === 'carry' ? it.title : `${it.title} (${fmtShort(d)} 이월)`,
              detail: it.detail, hours: it.hours, from: d,
            });
          }
        } else {
          it.missed = true;
        }
      }
    }
    state.currentDay = minKey(next, addDays(LAST_EXAM, 1));
    replan(state.currentDay);

    const msg = count
      ? `${fmt(day)} 마감 · 미완료 ${count}개(${h(hours)}) 이월 → ${fmt(state.currentDay)}부터 재계산`
      : `${fmt(day)} 마감 · 모두 완료 → ${fmt(state.currentDay)}부터 재계산`;
    state.log.unshift({ at: Date.now(), msg: state.unplaced.length ? `${msg} (시험 전 미배정 ${state.unplaced.length}개)` : msg });
    state.log = state.log.slice(0, 20);
    ui.selected = clampBoard(state.currentDay);
    save();
    renderAll();
    toast(msg);
  }

  function undo() {
    let snap = ui.undo;
    if (!snap) { try { snap = localStorage.getItem(UNDO_KEY); } catch (e) { snap = null; } }
    if (!snap) return;
    state = JSON.parse(snap);
    ui.undo = null;
    try { localStorage.removeItem(UNDO_KEY); } catch (e) { /* 무시 */ }
    ui.selected = clampBoard(state.currentDay);
    save();
    renderAll();
    toast('마지막 재배치를 되돌렸습니다.');
  }
  const hasUndo = () => { if (ui.undo) return true; try { return !!localStorage.getItem(UNDO_KEY); } catch (e) { return false; } };

  function replanFromToday(reason) {
    replan(state.currentDay);
    if (reason) {
      state.log.unshift({ at: Date.now(), msg: `${reason} → ${fmt(state.currentDay)}부터 재계산` });
      state.log = state.log.slice(0, 20);
    }
    save();
    renderAll();
  }

  // ---------------------------------------------------------------- 렌더링
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const color = s => `var(--c-${SUBJ[s] ? s : 'etc'})`;
  const clampBoard = d => minKey(maxKey(d, BOARD_START), BOARD_END);

  function renderAll() {
    renderKpis();
    renderAlerts();
    renderDay();
    renderBoard();
    renderMemo();
    renderProgress();
    renderLog();
  }

  function renderKpis() {
    const total = state.tasks.reduce((a, t) => a + hoursOf(t), 0);
    const done = state.tasks.filter(t => t.done).reduce((a, t) => a + hoursOf(t), 0);
    const pct = total ? Math.round(done / total * 100) : 0;
    const cur = state.currentDay;
    const items = itemsOf(cur);
    const dCount = items.filter(i => i.done).length;
    const dHours = sumHours(items.filter(i => i.done));
    const today = realToday();
    const next = SUBJECTS.filter(s => s.exam >= today).sort((a, b) => a.exam.localeCompare(b.exam));
    const nextDate = next.length ? next[0].exam : null;
    const nextSubs = next.filter(s => s.exam === nextDate).map(s => s.short).join(' · ');
    const planned = Object.entries(state.schedule).filter(([d]) => d >= cur).reduce((a, [, arr]) => a + sumHours(arr.filter(i => !i.done)), 0);

    $('kpis').innerHTML = `
      <div class="kpi">
        <span class="kpi-label">전체 진도 (강의·복습 과제)</span>
        <span class="kpi-value">${pct}<small>%</small></span>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <span class="kpi-sub">${h(done)} / ${h(total)} 완료</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">오늘 플랜 ${cur <= LAST_EXAM ? fmt(cur) : ''}</span>
        <span class="kpi-value">${dCount}<small> / ${items.length}개</small></span>
        <div class="bar"><i style="width:${items.length ? dCount / items.length * 100 : 0}%"></i></div>
        <span class="kpi-sub">${h(dHours)} / ${h(sumHours(items))} 완료</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">남은 학습량</span>
        <span class="kpi-value">${+(total - done).toFixed(1)}<small>h</small></span>
        <span class="kpi-sub">복습·총정리 포함 배정 ${h(planned)}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">다음 시험</span>
        <span class="kpi-value">${nextDate ? fmt(nextDate) : '종료'}</span>
        <span class="kpi-sub">${nextDate ? esc(nextSubs) : '모든 시험이 끝났습니다'}</span>
      </div>`;
  }

  function renderAlerts() {
    const out = [];
    const today = realToday();
    if (state.currentDay <= LAST_EXAM && today > state.currentDay) {
      out.push(`<div class="alert warn"><span><b>${fmt(state.currentDay)} 일과가 아직 마감되지 않았습니다.</b> 오늘은 ${fmt(today)}입니다. ‘미완료 과목 스케줄 재배치’를 누르면 남은 항목을 오늘부터 다시 배치합니다.</span></div>`);
    }
    if (state.unplaced.length) {
      const by = {};
      state.unplaced.forEach(u => { (by[u.subj] ||= []).push(u.title); });
      const txt = Object.entries(by).map(([s, arr]) => `${SUBJ[s].short} ${arr.length}개`).join(', ');
      out.push(`<div class="alert bad"><span><b>시험 전까지 배정하지 못한 항목:</b> ${esc(txt)}. 설정에서 가용시간을 늘리거나 학습 단위 시간을 줄여 보세요.</span></div>`);
    }
    $('alerts').innerHTML = out.join('');
  }

  function typeLabel(it) {
    switch (it.type) {
      case 'task': return [KIND_LABEL[it.kind] || '학습', ''];
      case 'skim': return ['훑어보기', 'review'];
      case 'cum': return ['누적 복습', 'review'];
      case 'carry': return ['복습', 'review'];
      case 'practice': return ['문제풀이', ''];
      case 'final': return ['D-1 총정리', 'final'];
      default: return ['', ''];
    }
  }

  function renderDay() {
    const d = ui.selected;
    const cur = state.currentDay;
    const items = [...itemsOf(d)];
    const closed = d < cur;
    $('dayTitle').textContent = `${fmt(d)}`;
    const stEl = $('dayState');
    stEl.className = 'day-state';
    if (d === cur) { stEl.textContent = '오늘 플랜'; stEl.classList.add('today'); }
    else if (closed) { stEl.textContent = d < PLAN_START ? '계획 이전' : '마감됨'; stEl.classList.add('closed'); }
    else stEl.textContent = `${diffDays(cur, d)}일 뒤 예정`;
    $('prevDay').disabled = d <= BOARD_START;
    $('nextDay').disabled = d >= BOARD_END;
    $('gotoToday').hidden = d === clampBoard(cur);

    // 배너
    const b = [];
    const ex = examsOn(d);
    if (ex.length) b.push(`<div class="banner exam"><span class="tag">시험</span>${ex.map(s => esc(s.name)).join(' · ')}</div>`);
    const eve = eveSubjects(d);
    if (eve.length) b.push(`<div class="banner eve"><span class="tag">D-1</span>시험 전날: ${eve.map(s => esc(SUBJ[s].name)).join(' · ')}만 공부합니다.</div>`);
    if (d > LAST_EXAM) b.push(`<div class="banner info">모든 시험이 끝났습니다. 수고했어요!</div>`);
    $('dayBanner').innerHTML = b.join('');

    // 가용시간 막대
    const cap = capOf(d);
    const base = Number(state.settings.hours[weekday(d)]) || 0;
    const used = sumHours(items);
    const doneH = sumHours(items.filter(i => i.done));
    const ev = eventHours(d);
    const bySubj = {};
    items.forEach(it => { bySubj[it.subj] = (bySubj[it.subj] || 0) + it.hours; });
    const denom = Math.max(cap, used, 0.01);
    const segs = SUBJECTS.filter(s => bySubj[s.id]).map(s => `<i style="width:${bySubj[s.id] / denom * 100}%;background:${color(s.id)}" title="${esc(s.short)} ${h(bySubj[s.id])}"></i>`).join('');
    const notes = [];
    if (ev) notes.push(`개인 일정 −${h(ev)}`);
    if (ex.length) notes.push(`시험 −${h(state.settings.examPenalty * ex.length)}`);
    $('dayMeter').innerHTML = items.length || cap ? `
      <div class="meter-row">
        <span>배정 <b>${h(used)}</b> / 가용 <b>${h(cap)}</b>${notes.length ? ` <span class="hint">(${WD[weekday(d)]} ${h(base)} ${notes.join(' ')})</span>` : ''}</span>
        <span>완료 <b>${h(doneH)}</b></span>
      </div>
      <div class="stack">${segs}</div>` : '';

    // 체크리스트
    if (!items.length) {
      $('checklist').innerHTML = `<p class="empty">${d > LAST_EXAM ? '배정된 학습이 없습니다.' : d < PLAN_START ? '9/28부터 계획이 시작됩니다.' : '배정된 학습이 없습니다.'}</p>`;
    } else {
      const groups = {};
      items.forEach(it => { (groups[it.subj] ||= []).push(it); });
      const order = SUBJECTS.map(s => s.id).filter(s => groups[s]);
      $('checklist').innerHTML = order.map(s => {
        const arr = groups[s].sort((a, b) => (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) || 0);
        const gDone = arr.filter(i => i.done).length;
        return `<div class="group" style="--c:${color(s)}">
          <div class="group-head"><span class="dot"></span>${esc(SUBJ[s].name)}
            <span class="gh-meta">${gDone}/${arr.length} · ${h(sumHours(arr))}</span></div>
          ${arr.map(it => {
            const [lab, cls] = typeLabel(it);
            const late = it.due && !it.done && it.due < d;
            const cid = `chk-${d}-${it.id}`;
            const status = it.carried ? '<span class="pill carry">다음 날로 이월됨</span>'
              : it.missed ? '<span class="pill late">미완료</span>'
              : it.from ? `<span class="pill carry">${fmtShort(it.from)}에서 이월</span>` : '';
            return `<div class="item${it.done ? ' done' : ''}${it.carried ? ' carried' : ''}">
              <input type="checkbox" id="${esc(cid)}" data-date="${d}" data-id="${esc(it.id)}" ${it.done ? 'checked' : ''} ${closed ? 'disabled' : ''}>
              <label class="item-body" for="${esc(cid)}">
                <span class="item-title">${esc(it.title)}</span>
                ${it.detail ? `<span class="item-detail">${esc(it.detail)}</span>` : ''}
                ${it.due && !it.done && !closed ? `<span class="item-detail">수업 전 마감 ${fmt(it.due)}</span>` : ''}
              </label>
              <span class="item-side">${status}${late ? '<span class="pill late">마감 지남</span>' : ''}<span class="pill ${cls}">${lab}</span><span class="hrs">${h(it.hours)}</span></span>
            </div>`;
          }).join('')}
        </div>`;
      }).join('');
    }

    // 개인 일정
    const evs = state.events.filter(e => e.date === d).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    $('eventList').innerHTML = evs.length ? evs.map(e => `
      <li class="${e.done ? 'done' : ''}">
        <input type="checkbox" data-ev="${esc(e.id)}" ${e.done ? 'checked' : ''} aria-label="완료">
        <span class="ev-time">${e.time ? esc(e.time) : '종일'}</span>
        <span class="ev-text">${esc(e.text)}</span>
        <span class="hrs ev-hrs">${Number(e.hours) ? `−${h(Number(e.hours))}` : ''}</span>
        <button type="button" class="x-btn" data-evdel="${esc(e.id)}" aria-label="삭제">×</button>
      </li>`).join('') : '<li class="hint">등록된 개인 일정이 없습니다.</li>';

    // 마감 바
    const curItems = itemsOf(cur);
    const left = curItems.filter(i => !i.done);
    const info = $('closeInfo');
    const btn = $('rescheduleBtn');
    if (cur > LAST_EXAM) {
      info.innerHTML = '시험 기간이 끝났습니다.';
      btn.disabled = true;
    } else {
      btn.disabled = false;
      info.innerHTML = left.length
        ? `<b>${fmt(cur)}</b> 미완료 <b>${left.length}개 (${h(sumHours(left))})</b>. 하루를 마치고 누르면 다음 날로 이월하고 요일별 가용시간·시험 전날 올인 규칙에 맞춰 ${fmt(LAST_EXAM)}까지 다시 계산합니다.`
        : `<b>${fmt(cur)}</b> 항목을 모두 끝냈습니다. 누르면 하루를 마감하고 다음 날부터 다시 계산합니다.`;
    }
    $('undoBtn').hidden = !hasUndo();
  }

  function renderBoard() {
    const legend = SUBJECTS.map(s => `<span><i class="dot" style="--c:${color(s.id)}"></i>${esc(s.short)}</span>`).join('');
    $('legend').innerHTML = legend;
    const heads = ['월', '화', '수', '목', '금', '토', '일'].map(w => `<div class="wd-head${w === '일' ? ' sun' : ''}">${w}</div>`).join('');
    const cells = [];
    const cur = state.currentDay;
    for (let d = BOARD_START; d <= BOARD_END; d = addDays(d, 1)) {
      const items = itemsOf(d);
      const cap = capOf(d);
      const used = sumHours(items);
      const bySubj = {};
      items.forEach(it => { bySubj[it.subj] = (bySubj[it.subj] || 0) + it.hours; });
      const ex = examsOn(d);
      const eve = eveSubjects(d);
      const cls = ['cell'];
      if (d < cur) cls.push('closed');
      if (d === cur) cls.push('today');
      if (d === ui.selected) cls.push('selected');
      if (eve.length) cls.push('eve');
      else if (ex.length) cls.push('examday');
      if (d > LAST_EXAM) cls.push('off');
      const tags = [];
      if (ex.length) tags.push(`<span class="cell-tag exam">시험 ${ex.map(s => esc(s.short)).join('·')}</span>`);
      if (eve.length) tags.push(`<span class="cell-tag eve">D-1 ${eve.map(s => esc(SUBJ[s].short)).join('·')} 올인</span>`);
      const chips = SUBJECTS.filter(s => bySubj[s.id]).map(s =>
        `<span class="chip"><i class="dot" style="--c:${color(s.id)}"></i>${esc(s.short)}<b>${+bySubj[s.id].toFixed(2)}</b></span>`).join('');
      const doneN = items.filter(i => i.done).length;
      const carriedN = items.filter(i => i.carried).length;
      const foot = [];
      if (items.length && d <= cur) foot.push(`<span class="${doneN === items.length ? 'ok' : ''}">✓ ${doneN}/${items.length}</span>`);
      if (carriedN) foot.push(`<span class="miss">이월 ${carriedN}</span>`);
      const evN = state.events.filter(e => e.date === d).length;
      if (evN) foot.push(`<span>일정 ${evN}</span>`);
      const pct = cap ? Math.min(100, used / cap * 100) : 0;
      cells.push(`<button type="button" class="${cls.join(' ')}" data-day="${d}" aria-label="${fmt(d)} ${h(used)} 배정">
        <span class="cell-top"><span class="cell-date">${fmtShort(d)}</span><span class="cell-cap">${d <= LAST_EXAM ? `${+used.toFixed(2)}/${+cap.toFixed(2)}h` : ''}</span></span>
        ${tags.join('')}
        ${d <= LAST_EXAM ? `<span class="cell-bar"><i class="${pct >= 90 ? 'full' : ''}" style="width:${pct}%"></i></span>` : ''}
        <span class="chips">${chips}</span>
        ${foot.length ? `<span class="cell-foot">${foot.join('')}</span>` : ''}
      </button>`);
    }
    $('board').innerHTML = heads + cells.join('');
  }

  function renderMemo() {
    $('memoDate').textContent = fmt(ui.selected);
    const ta = $('memo');
    if (document.activeElement !== ta) ta.value = state.memos[ui.selected] || '';
  }

  function renderProgress() {
    const scheduledOn = {};
    for (const [d, arr] of Object.entries(state.schedule)) {
      if (d < state.currentDay) continue;
      arr.forEach(it => { if (it.type === 'task' && !it.done && (!scheduledOn[it.taskId] || d < scheduledOn[it.taskId])) scheduledOn[it.taskId] = d; });
    }
    const open = new Set([...document.querySelectorAll('.subj[open]')].map(el => el.dataset.subj));
    const today = realToday();
    $('progress').innerHTML = SUBJECTS.map(s => {
      const ts = state.tasks.filter(t => t.subj === s.id).sort((a, b) => (a.stream.localeCompare(b.stream)) || a.seq - b.seq);
      const total = ts.reduce((a, t) => a + hoursOf(t), 0);
      const done = ts.filter(t => t.done).reduce((a, t) => a + hoursOf(t), 0);
      const pct = total ? done / total * 100 : 0;
      const dd = diffDays(today, s.exam);
      return `<details class="subj" data-subj="${s.id}" style="--c:${color(s.id)}" ${open.has(s.id) ? 'open' : ''}>
        <summary>
          <span class="dot"></span>
          <span class="subj-name">${esc(s.name)}</span>
          <span class="subj-exam">${fmtShort(s.exam)} · ${dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : '종료'}</span>
          <span class="subj-bar"><span class="bar"><i style="width:${pct}%"></i></span><span>${ts.filter(t => t.done).length}/${ts.length}</span></span>
        </summary>
        <ul class="subj-tasks">
          ${ts.map(t => {
            const when = t.done ? (t.doneOn ? fmtShort(t.doneOn) : '완료') : scheduledOn[t.id] ? `→ ${fmtShort(scheduledOn[t.id])}` : '미배정';
            const cid = `pt-${t.id}`;
            return `<li class="${t.done ? 'done' : ''}">
              <input type="checkbox" id="${esc(cid)}" data-task="${esc(t.id)}" ${t.done ? 'checked' : ''}>
              <label class="t-title" for="${esc(cid)}">${esc(t.title)}</label>
              <span class="t-when${!t.done && !scheduledOn[t.id] ? ' none' : ''}">${h(hoursOf(t))} ${when}${t.kind === 'custom' ? ` <button type="button" class="x-btn" data-taskdel="${esc(t.id)}" aria-label="삭제">×</button>` : ''}</span>
            </li>`;
          }).join('')}
        </ul>
      </details>`;
    }).join('');
  }

  function renderLog() {
    $('log').innerHTML = state.log.length
      ? state.log.map(l => { const t = new Date(l.at); return `<li><time>${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())}</time>${esc(l.msg)}</li>`; }).join('')
      : '<li class="hint">아직 재배치 기록이 없습니다.</li>';
  }

  function renderSettings() {
    const st = state.settings;
    const order = [1, 2, 3, 4, 5, 6, 0];
    $('wdGrid').innerHTML = order.map(w => `<label>${WD[w]}<input type="number" id="wd${w}" min="0" max="14" step="0.5" value="${st.hours[w]}"></label>`).join('');
    const opts = v => `<option value="">미지정</option>` + [1, 2, 3, 4, 5].map(w => `<option value="${w}" ${String(v) === String(w) ? 'selected' : ''}>${WD[w]}요일</option>`).join('');
    $('classGrid').innerHTML = SUBJECTS.filter(s => s.id !== 'sec').map(s => `<label>${esc(s.name)}<select id="cd-${s.id}">${opts(st.classDays[s.id])}</select></label>`).join('');
    $('sVideo').value = st.videoH;
    $('sOffline').value = st.offlineH;
    $('sSkim').value = st.skimH;
    $('sCum').value = st.cumH;
    $('sCycle').value = st.cycle;
    $('sPenalty').value = st.examPenalty;
    $('cfSubj').innerHTML = SUBJECTS.map(s => `<option value="${s.id}">${esc(s.short)}</option>`).join('');
  }

  // ---------------------------------------------------------------- 헤더 시계 · D-Day
  let lastRealDay = realToday();
  function tick() {
    const now = new Date();
    $('nowText').textContent = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} (${WD[now.getDay()]}) ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const today = localKey(now);
    const n = diffDays(today, DDAY);
    $('ddayNum').textContent = n > 0 ? `D-${n}` : n === 0 ? 'D-DAY' : `D+${-n}`;
    const [y, m, d] = DDAY.split('-').map(Number);
    let ms = new Date(y, m - 1, d, 0, 0, 0) - now;
    if (ms > 0) {
      const dd = Math.floor(ms / 86400000); ms -= dd * 86400000;
      const hh = Math.floor(ms / 3600000); ms -= hh * 3600000;
      const mm = Math.floor(ms / 60000); ms -= mm * 60000;
      const ss = Math.floor(ms / 1000);
      $('ddayCount').textContent = `${dd}일 ${pad(hh)}:${pad(mm)}:${pad(ss)} 남음`;
    } else {
      $('ddayCount').textContent = n === 0 ? '시험 당일, 화이팅!' : '중간고사 진행/종료';
    }
    if (today !== lastRealDay) { lastRealDay = today; renderAll(); }
  }

  // ---------------------------------------------------------------- 토스트
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  // ---------------------------------------------------------------- 이벤트
  function bind() {
    $('prevDay').addEventListener('click', () => { ui.selected = clampBoard(addDays(ui.selected, -1)); renderDay(); renderBoard(); renderMemo(); });
    $('nextDay').addEventListener('click', () => { ui.selected = clampBoard(addDays(ui.selected, 1)); renderDay(); renderBoard(); renderMemo(); });
    $('gotoToday').addEventListener('click', () => { ui.selected = clampBoard(state.currentDay); renderDay(); renderBoard(); renderMemo(); });

    $('board').addEventListener('click', e => {
      const cell = e.target.closest('[data-day]');
      if (!cell) return;
      ui.selected = cell.dataset.day;
      renderDay(); renderBoard(); renderMemo();
    });

    $('checklist').addEventListener('change', e => {
      const cb = e.target.closest('input[data-id]');
      if (!cb) return;
      const it = itemsOf(cb.dataset.date).find(x => x.id === cb.dataset.id);
      if (!it) return;
      it.done = cb.checked;
      if (it.type === 'task') {
        const t = taskById(it.taskId);
        if (t) { t.done = cb.checked; t.doneOn = cb.checked ? cb.dataset.date : null; }
      }
      save();
      renderAll();
    });

    $('eventForm').addEventListener('submit', e => {
      e.preventDefault();
      const text = $('evText').value.trim();
      if (!text) return;
      const hours = Math.max(0, Number($('evHours').value) || 0);
      state.events.push({ id: uid('e'), date: ui.selected, time: $('evTime').value, text, hours, done: false });
      $('evText').value = ''; $('evHours').value = ''; $('evTime').value = '';
      if (hours > 0 && ui.selected >= state.currentDay) {
        replanFromToday(`${fmt(ui.selected)} 개인 일정 추가(−${h(hours)})`);
        toast(`개인 일정 ${h(hours)}을 반영해 스케줄을 다시 계산했습니다.`);
      } else { save(); renderAll(); }
    });
    $('eventList').addEventListener('change', e => {
      const cb = e.target.closest('input[data-ev]');
      if (!cb) return;
      const ev = state.events.find(x => x.id === cb.dataset.ev);
      if (ev) { ev.done = cb.checked; save(); renderDay(); }
    });
    $('eventList').addEventListener('click', e => {
      const b = e.target.closest('[data-evdel]');
      if (!b) return;
      const ev = state.events.find(x => x.id === b.dataset.evdel);
      state.events = state.events.filter(x => x.id !== b.dataset.evdel);
      if (ev && Number(ev.hours) > 0 && ev.date >= state.currentDay) replanFromToday(`${fmt(ev.date)} 개인 일정 삭제`);
      else { save(); renderAll(); }
    });

    let memoTimer;
    $('memo').addEventListener('input', e => {
      const v = e.target.value;
      const d = ui.selected;
      clearTimeout(memoTimer);
      memoTimer = setTimeout(() => { if (v) state.memos[d] = v; else delete state.memos[d]; save(); }, 300);
    });

    $('progress').addEventListener('change', e => {
      const cb = e.target.closest('input[data-task]');
      if (!cb) return;
      const t = taskById(cb.dataset.task);
      if (!t) return;
      t.done = cb.checked;
      t.doneOn = null;
      if (!cb.checked) {
        // 체크리스트에서 완료했던 항목을 되돌리면 그 날짜에서 빼고 다시 배치
        for (const [d, arr] of Object.entries(state.schedule)) {
          if (d >= state.currentDay) arr.forEach(it => { if (it.taskId === t.id) it.done = false; });
        }
      }
      replanFromToday(`${SUBJ[t.subj].short} ‘${t.short || t.title}’ ${cb.checked ? '완료 처리' : '완료 취소'}`);
    });
    $('progress').addEventListener('click', e => {
      const b = e.target.closest('[data-taskdel]');
      if (!b) return;
      e.preventDefault();
      const t = taskById(b.dataset.taskdel);
      state.tasks = state.tasks.filter(x => x.id !== b.dataset.taskdel);
      for (const arr of Object.values(state.schedule)) {
        for (let i = arr.length - 1; i >= 0; i--) if (arr[i].taskId === b.dataset.taskdel && !arr[i].carried) arr.splice(i, 1);
      }
      replanFromToday(t ? `${SUBJ[t.subj].short} ‘${t.short}’ 삭제` : null);
    });

    $('customForm').addEventListener('submit', e => {
      e.preventDefault();
      const subj = $('cfSubj').value;
      const title = $('cfTitle').value.trim();
      const hours = Math.max(0.25, Number($('cfHours').value) || 1);
      if (!title || !SUBJ[subj]) return;
      const seq = 1 + state.tasks.filter(t => t.subj === subj && t.stream === 'x').reduce((m, t) => Math.max(m, t.seq), 0);
      state.tasks.push({ id: `${subj}-x${seq}`, subj, stream: 'x', seq, week: null, kind: 'custom', title: `추가 학습 · ${title}`, short: title, hours, done: false, doneOn: null });
      $('cfTitle').value = '';
      replanFromToday(`${SUBJ[subj].short} ‘${title}’ 추가`);
      toast(`${SUBJ[subj].short}에 ‘${title}’을 추가하고 다시 계산했습니다.`);
    });

    $('settingsForm').addEventListener('submit', e => {
      e.preventDefault();
      const st = state.settings;
      const num = (id, lo, hi, dflt) => { const v = Number($(id).value); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; };
      for (let w = 0; w < 7; w++) st.hours[w] = num(`wd${w}`, 0, 14, st.hours[w]);
      SUBJECTS.forEach(s => { const el = $(`cd-${s.id}`); if (el) st.classDays[s.id] = el.value === '' ? null : Number(el.value); });
      st.videoH = num('sVideo', 0.25, 4, st.videoH);
      st.offlineH = num('sOffline', 0.25, 4, st.offlineH);
      st.skimH = num('sSkim', 0, 1, st.skimH);
      st.cumH = num('sCum', 0, 3, st.cumH);
      st.cycle = Math.round(num('sCycle', 0, 14, st.cycle));
      st.examPenalty = num('sPenalty', 0, 6, st.examPenalty);
      renderSettings();
      replanFromToday('설정 변경');
      toast('설정을 저장하고 스케줄을 다시 계산했습니다.');
    });
    $('resetBtn').addEventListener('click', () => { $('resetConfirm').hidden = false; });
    $('resetNo').addEventListener('click', () => { $('resetConfirm').hidden = true; });
    $('resetYes').addEventListener('click', () => {
      state = freshState();
      replan(state.currentDay);
      ui.undo = null;
      try { localStorage.removeItem(UNDO_KEY); } catch (e) { /* 무시 */ }
      ui.selected = clampBoard(state.currentDay);
      $('resetConfirm').hidden = true;
      save();
      renderSettings();
      renderAll();
      toast('초기 계획으로 되돌렸습니다.');
    });

    $('rescheduleBtn').addEventListener('click', closeDayAndReplan);
    $('undoBtn').addEventListener('click', undo);
  }

  // ---------------------------------------------------------------- 시작
  state = load();
  if (!state) {
    state = freshState();
    replan(state.currentDay);
    save();
  }
  ui.selected = clampBoard(state.currentDay);
  bind();
  renderSettings();
  renderAll();
  tick();
  setInterval(tick, 1000);
})();
