'use strict';
/*
 * 중간고사 스터디 플래너
 * - 상태는 localStorage에 저장된다.
 * - 스케줄은 replan(start)가 start일부터 마지막 시험일까지 하루씩 그리디로 다시 계산한다.
 *   완료한 항목은 그 날짜에 고정(pinned)되고, 나머지는 모두 다시 배치된다.
 */
(() => {
  // ---------------------------------------------------------------- 상수
  const STORAGE_KEY = 'studyPlanner.v2';
  const UNDO_KEY = 'studyPlanner.v2.undo';
  const OLD_KEY = 'studyPlanner.v1';
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
    { id: 'db',    name: '데이터베이스',             short: 'DB',       exam: '2026-10-22' },
    { id: 'hum',   name: '인문학으로 바라본 과학생활', short: '인문학',   exam: '2026-10-22' },
  ];
  const SUBJ = Object.fromEntries(SUBJECTS.map(s => [s.id, s]));
  const LAST_EXAM = SUBJECTS.reduce((m, s) => (s.exam > m ? s.exam : m), '');

  // [제목, 약칭, 공개 주차] — 영상은 해당 주차 월요일에 열린다
  const DM_LECTURES = [
    ['1장. 수의 표현과 연산 (1/3)', '1장(1/3)', 1],
    ['1장. 수의 표현과 연산 (2/3)', '1장(2/3)', 2],
    ['1장. 수의 표현과 연산 (3/3)', '1장(3/3)', 2],
    ['2장. 집합', '2장', 3],
    ['3장. 논리와 명제 (1/2)', '3장(1/2)', 4],
    ['3장. 논리와 명제 (2/2)', '3장(2/2)', 4],
    ['4장. 관계 (1)', '4장(1)', 5],
    ['4장. 관계 (2)', '4장(2)', 5],
    ['5장. 함수 (1)', '5장(1)', 6],
    ['5장. 함수 (2)', '5장(2)', 6],
    ['6장. 증명', '6장', 7],
  ];
  const DB_LECTURES = ['CH1-A', 'CH1-B', 'CH2-A', 'CH3-A', 'CH3-B', 'CH3-C', 'CH3-D', 'CH3-E', 'CH3-F',
    'CH6-A', 'CH6-B', 'CH6-C', 'CH5-A', 'Normalization_A']; // 주차당 2개

  const KIND_LABEL = { video: '영상강의', offline: '현장 복습', custom: '추가 학습' };
  const VIDEO_LEN = 1.5;             // 온라인 영상 1개 재생시간(h)
  const VIDEO_MULS = [1.5, 1.75, 2, 2.25, 2.5];
  const TYPE_ORDER = { carry: 0, skim: 1, cum: 2, task: 3, practice: 4, final: 5 };

  const DEFAULT_SETTINGS = {
    hours: { 0: 7, 1: 9, 2: 9, 3: 7, 4: 8, 5: 4, 6: 8 }, // 일~토
    videoMul: 'auto',  // 영상 재생시간 대비 공부시간 배율. auto = 시험 전까지 다 들어가는 가장 큰 배율
    offlineH: 1,
    skimH: 1 / 6,      // 1일 뒤 훑어보기 (항목당 10분)
    spacedH: 1 / 12,   // 3·7일 뒤 재복습 (영상강의·추가 학습 항목당 5분)
    gaps: [1, 3, 7],   // 학습 후 복습하는 날 (일)
    cumH: 0.5,
    cycle: 7,
    examPenalty: 1.5,
    classDays: { dm: 1, linux: 1, sat: 3, db: 4, hum: 4 }, // 0=일 … 6=토
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
  const h = n => {
    const m = Math.round(n * 60);
    if (m > 0 && m < 60) return `${m}분`;
    return m % 15 === 0 ? `${+(m / 60).toFixed(2)}h` : `${Math.floor(m / 60)}h ${m % 60}분`;
  };
  const round5m = n => Math.max(1, Math.round(n * 12)) / 12; // 5분 단위
  const roundQ = n => Math.round(n * 4) / 4;

  // ---------------------------------------------------------------- 상태
  let state;
  const ui = { selected: null, resetOpen: false };

  function buildTasks() {
    const T = [];
    const push = (subj, stream, seq, o) => T.push({
      id: `${subj}-${stream}${seq}`, subj, stream, seq, week: null, hours: null, done: false, doneOn: null, ...o,
    });
    DM_LECTURES.forEach(([title, short, w], i) => push('dm', 'v', i + 1, { kind: 'video', week: w, title: `${w}주차 영상강의 · ${title}`, short }));
    for (const s of ['linux', 'sat', 'hum']) {
      for (let w = 1; w <= 7; w++) {
        push(s, 'v', w, { kind: 'video', week: w, title: `${w}주차 영상강의`, short: `${w}주차 영상` });
        push(s, 'o', w, { kind: 'offline', week: w, title: `${w}주차 현장강의 복습·정리`, short: `${w}주차 현장` });
      }
    }
    DB_LECTURES.forEach((c, i) => { const w = Math.floor(i / 2) + 1; push('db', 'v', i + 1, { kind: 'video', week: w, title: `${w}주차 영상강의 · ${c}`, short: c }); });
    for (let w = 1; w <= 7; w++) {
      push('db', 'o', w, { kind: 'offline', week: w, title: `${w}주차 현장강의 복습·정리`, short: `${w}주차 현장` });
    }
    return T;
  }

  function freshState() {
    const today = realToday();
    return {
      version: 2,
      rev: 4,
      settings: structuredClone(DEFAULT_SETTINGS),
      tasks: buildTasks(),
      schedule: {},
      carryPool: [],
      events: [],
      memos: {},
      log: [],
      unplaced: [],
      mulUsed: 2,
      currentDay: minKey(maxKey(today, PLAN_START), LAST_EXAM),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.version === 2 && Array.isArray(s.tasks)) {
          s.settings = { ...structuredClone(DEFAULT_SETTINGS), ...s.settings };
          s.settings.classDays = { ...DEFAULT_SETTINGS.classDays, ...s.settings.classDays };
          return s;
        }
      }
    } catch (e) { /* 저장소 사용 불가 → 새 상태 */ }
    return null;
  }
  // v1 기록에서 완료 체크·개인 일정·메모만 가져온다 (과목 구성과 시간 단위가 바뀌어 스케줄은 새로 계산)
  function migrateV1() {
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
      if (!old || !Array.isArray(old.tasks)) return null;
      const s = freshState();
      const doneIds = new Set(old.tasks.filter(t => t.done).map(t => t.id));
      s.tasks.forEach(t => { if (doneIds.has(t.id)) { t.done = true; t.doneOn = null; } });
      s.events = (old.events || []).map(e => ({ id: e.id, date: e.date, time: e.time || '', text: e.text, mins: Math.round((Number(e.hours) || 0) * 60), done: !!e.done }));
      s.memos = old.memos || {};
      return s;
    } catch (e) { return null; }
  }
  // touch=false: 사용자가 바꾼 것이 없는 저장(첫 실행 등). 다른 기기의 기록을 덮어쓰지 않도록 시각을 남기지 않는다.
  function save(touch = true) {
    if (touch) state.savedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
    if (touch) cloud.schedule();
  }

  // ---------------------------------------------------------------- 기기 간 동기화
  // claude.ai에 올린 페이지에서는 로그인한 사람마다 비공개 문서 하나(data/users/<id>/planner)에 전체 상태를 저장한다.
  // 그 밖의 환경(파일로 직접 열기 등)에서는 이 브라우저의 localStorage만 쓴다.
  const cloud = {
    ref: null,
    status: 'local',   // local | connecting | synced | saving | error
    timer: null,
    writing: false,
    again: false,
    setStatus(st) {
      this.status = st;
      const el = document.getElementById('syncText');
      if (!el) return;
      const txt = {
        local: '이 브라우저에만 저장',
        connecting: '동기화 연결 중…',
        synced: '모든 기기 동기화됨',
        saving: '저장 중…',
        error: '동기화 실패 · 이 브라우저에 저장됨',
      }[st];
      el.textContent = txt;
      el.dataset.state = st;
    },
    schedule() {
      if (!this.ref) return;
      clearTimeout(this.timer);
      this.setStatus('saving');
      this.timer = setTimeout(() => this.flush(), 700);
    },
    async flush() {
      if (!this.ref) return;
      if (this.writing) { this.again = true; return; }
      this.writing = true;
      try {
        await this.ref.set({ savedAt: state.savedAt || 0, state: JSON.stringify(state) });
        this.setStatus('synced');
      } catch (e) {
        this.setStatus('error');
        if (e && (e.code === 'invalid_argument' || e.code === 'revoked' || e.code === 'not_granted')) this.ref = null;
      } finally {
        this.writing = false;
        if (this.again) { this.again = false; this.flush(); }
      }
    },
    adopt(data) {
      let remote;
      try { remote = JSON.parse(data.state); } catch (e) { return false; }
      if (!remote || remote.version !== 2 || !Array.isArray(remote.tasks)) return false;
      state = remote;
      state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...state.settings };
      state.settings.classDays = { ...DEFAULT_SETTINGS.classDays, ...state.settings.classDays };
      if (normalize()) { replan(state.currentDay); save(); } else save(false);
      ui.selected = clampBoard(ui.selected || state.currentDay);
      renderSettings();
      renderAll();
      return true;
    },
    async connect() {
      if (!window.claude || typeof window.claude.use !== 'function') return;
      this.setStatus('connecting');
      try {
        const [user, db] = await Promise.all([window.claude.use('user'), window.claude.use('db')]);
        const id = user ? await user.id() : null;
        if (!db || !id) { this.setStatus('local'); return; }
        const ref = db.doc(`data/users/${id}/planner`);
        const snap = await ref.get();
        this.ref = ref;
        const data = snap.exists ? snap.data() : null;
        if (data && (data.savedAt || 0) > (state.savedAt || 0)) {
          this.adopt(data);
          this.setStatus('synced');
          toast('다른 기기에서 저장한 기록을 불러왔습니다.');
        } else {
          await this.flush();
        }
        // 다른 기기에서 저장하면 실시간으로 반영
        ref.onSnapshot(sn => {
          if (!sn.exists || sn.metadata.hasPendingWrites) return;
          const d = sn.data();
          if ((d.savedAt || 0) > (state.savedAt || 0) && this.status !== 'saving') {
            if (this.adopt(d)) toast('다른 기기의 변경 내용을 반영했습니다.');
          }
        }, () => this.setStatus('error'));
      } catch (e) {
        this.ref = null;
        this.setStatus('error');
      }
    },
  };
  // 예전에 저장된 기록을 현재 강의 구성(주차·제목)에 맞춘다. 바뀐 것이 있으면 true
  function normalize() {
    const fresh = Object.fromEntries(buildTasks().map(t => [t.id, t]));
    let changed = false;
    state.tasks.forEach(t => {
      const f = fresh[t.id];
      if (!f) return;
      if (t.week !== f.week || t.title !== f.title) { t.week = f.week; t.title = f.title; changed = true; }
    });
    if ((state.rev || 0) < 3) { state.rev = 3; changed = true; }
    if (state.rev < 4) { // 간격 복습(1·3·7일) 도입: 복습 시간을 분 단위 기본값으로
      state.rev = 4;
      if (state.settings.skimH === 0.25) state.settings.skimH = DEFAULT_SETTINGS.skimH;
      changed = true;
    }
    return changed;
  }
  let uidN = 0;
  const uid = p => `${p}${Date.now().toString(36)}${(uidN++).toString(36)}`;

  // ---------------------------------------------------------------- 도메인 헬퍼
  const taskById = id => state.tasks.find(t => t.id === id);
  const hoursOf = t => t.hours ?? ({ video: VIDEO_LEN * state.mulUsed, offline: state.settings.offlineH }[t.kind] ?? 1);
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
  const eventHours = d => state.events.filter(e => e.date === d).reduce((a, e) => a + (Number(e.mins) || 0), 0) / 60;
  function capOf(d) {
    const st = state.settings;
    const base = Number(st.hours[weekday(d)]) || 0;
    return Math.max(0, base - eventHours(d) - st.examPenalty * examsOn(d).length);
  }
  const itemsOf = d => state.schedule[d] || [];
  // 개인 일정 시간 표시: 15:00~15:30
  function eventRange(e) {
    const mins = Number(e.mins) || 0;
    if (!e.time) return mins ? `${mins}분` : '종일';
    if (!mins) return e.time;
    const [hh, mm] = e.time.split(':').map(Number);
    const end = hh * 60 + mm + mins;
    const endTxt = `${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
    return `${e.time}~${endTxt}${end >= 1440 ? '(+1)' : ''}`;
  }
  const minsText = m => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);
  const sumHours = arr => arr.reduce((a, it) => a + it.hours, 0);

  // 수업 요일이 지정된 과목: 영상강의를 수업 전날까지 끝내도록 마감일 계산
  function computeDues(start) {
    const dues = {};
    for (const s of SUBJECTS) {
      if (classDate(s.id, 1) === null) continue;
      const vids = state.tasks.filter(t => t.subj === s.id && t.kind === 'video' && !t.done).sort((a, b) => a.seq - b.seq);
      if (!vids.length) continue;
      // 앞으로 있을 수업의 영상강의: 수업 전날까지 (월요일 수업처럼 공개일이 수업일이면 공개 당일)
      for (const v of vids) {
        if (!v.week) continue;
        const c = classDate(s.id, v.week);
        if (c && c > start && c < s.exam) dues[v.id] = maxKey(addDays(c, -1), weekMon(v.week));
      }
    }
    return dues;
  }

  // ---------------------------------------------------------------- 스케줄 재계산 (핵심)
  // 영상 배율이 'auto'면 2.5배부터 낮춰 가며 시험 전까지 모두 배정되는 가장 큰 배율을 고른다
  function replan(start) {
    const pref = state.settings.videoMul;
    if (pref !== 'auto') { state.mulUsed = Number(pref) || 2; replanCore(start); return; }
    const snap = JSON.stringify({ schedule: state.schedule, carryPool: state.carryPool });
    for (const m of [...VIDEO_MULS].reverse()) {
      const o = JSON.parse(snap);
      state.schedule = o.schedule;
      state.carryPool = o.carryPool;
      state.mulUsed = m;
      replanCore(start);
      if (!state.unplaced.length && !state.lateOnEve) return;
    }
  }

  function replanCore(start) {
    const st = state.settings;
    // 1) start 이후: 완료 항목만 남기고 비움
    for (const k of Object.keys(state.schedule)) {
      if (k >= start) {
        state.schedule[k] = state.schedule[k].filter(it => it.done || it.pinned);
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
    const kept = new Set(); // 당겨와서 오늘에 고정된 과제
    for (const [k, arr] of Object.entries(state.schedule)) if (k >= start) arr.forEach(it => { if (it.type === 'task') kept.add(it.taskId); });
    [...state.tasks].sort((a, b) => a.seq - b.seq).forEach(t => {
      if (t.done || kept.has(t.id)) return;
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
      if (t.kind === 'offline' && t.week) { // 같은 주차 영상강의를 먼저 들은 뒤 현장 복습
        const vq = streams[`${t.subj}|v`];
        if (vq && vq.length && vq[0].week <= t.week) return false;
      }
      return true;
    };

    let lateOnEve = 0; // 시험 전날로 밀린 강의·복습 수 (총정리 시간을 잠식)
    // 과목별 진도 페이스: 시험 전날까지 가용시간에 비례해 고르게 나눠 배치한다
    const initRem = {}, placedH = {}, capToEve = {};
    SUBJECTS.forEach(s => {
      initRem[s.id] = remainingOf(s.id);
      placedH[s.id] = 0;
      capToEve[s.id] = Math.max(capUntil(s.id, start, addDays(s.exam, -1)), 1);
    });
    // 지난 날에서 이월된 과제 표시용
    const carriedFrom = {};
    for (const [d, arr] of Object.entries(state.schedule)) {
      if (d >= start) continue;
      arr.forEach(it => { if (it.type === 'task' && it.carried && !(carriedFrom[it.taskId] > d)) carriedFrom[it.taskId] = d; });
    }

    // 날짜별로 공부한 항목 (간격 복습 대상): 지난 날은 완료한 것, 앞으로는 배치한 것
    const learnedOn = {};
    for (const [k, arr] of Object.entries(state.schedule)) {
      if (k >= start) continue;
      arr.forEach(it => {
        if (it.type !== 'task' || !it.done) return;
        const t = taskById(it.taskId);
        if (t) ((learnedOn[k] ||= {})[it.subj] ||= []).push(t);
      });
    }
    const gaps = [...new Set((st.gaps || []).map(Number).filter(g => g >= 1 && g <= 30))].sort((a, b) => a - b);

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
        // (b) 간격 복습: 공부한 날로부터 1일(훑어보기)·3일·7일 뒤 다시 보기
        for (const gap of gaps) {
          const src = learnedOn[addDays(d, -gap)] || {};
          const per = gap === 1 ? st.skimH : st.spacedH;
          if (per <= 0) continue;
          for (const s of Object.keys(src)) {
            // 현장강의 복습은 그 자체가 복습이라 1일 뒤 훑어보기만 한다
            const list = gap === 1 ? src[s] : src[s].filter(t => t.kind !== 'offline');
            if (!allowed(s) || !list.length) continue;
            add({
              id: gap === 1 ? `skim-${s}-${d}` : `rev${gap}-${s}-${d}`, type: 'skim', gap, subj: s,
              title: gap === 1 ? '어제 공부한 내용 훑어보기' : `${gap}일 전 공부한 내용 재복습`,
              detail: `${fmtShort(addDays(d, -gap))} 학습 · ${list.map(t => t.short).join(', ')}`,
              hours: Math.min(0.75, round5m(list.length * per)),
            });
          }
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
      // 과목을 번갈아 배치: 1차로 과목당 1개씩, 시간이 남으면 과목당 최대 2개까지 (시험 전날은 제한 없음)
      const limits = eve.length ? [Infinity] : [1, 2];
      for (const limit of limits) for (;;) {
        const cands = [];
        for (const [key, q] of Object.entries(streams)) {
          const subj = key.split('|')[0];
          if (!pool.includes(subj) || !q.length || !ready(q[0], d)) continue;
          if ((today[subj]?.length || 0) >= limit) continue;
          const t = q[0];
          const due = dues[t.id];
          let score;
          if (eve.length) {
            score = 1000 - SUBJECTS.findIndex(s => s.id === subj);
          } else {
            // 오늘까지 끝냈어야 할 양 - 지금까지 배치한 양 = 페이스보다 밀린 시간(h). 많이 밀린 과목부터
            const frac = Math.min(1, capUntil(subj, start, addDays(d, 1)) / capToEve[subj]);
            score = frac * initRem[subj] - placedH[subj];
            if (due) score += due <= d ? 3 : 1 / Math.max(diffDays(d, due), 1); // 수업 전 마감이 가까우면 가산
            if (t.kind === 'video') score += 0.01; // 같은 과목이면 영상강의 먼저
          }
          score -= (t.week || 0) * 1e-4;
          cands.push({ key, t, score });
        }
        cands.sort((a, b) => b.score - a.score);
        const pick = cands.find(c => hoursOf(c.t) <= cap - used + 0.25 + 1e-9);
        if (!pick) break;
        const t = pick.t;
        if (eve.length) lateOnEve++;
        add({ id: `t-${t.id}`, type: 'task', taskId: t.id, subj: t.subj, kind: t.kind, title: t.title, hours: hoursOf(t), due: dues[t.id] || null, from: carriedFrom[t.id] || null });
        streams[pick.key].shift();
        placedH[t.subj] += hoursOf(t);
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
      learnedOn[d] = today;
    }

    // 4) 시험 전까지 배정하지 못한 항목
    state.lateOnEve = lateOnEve;
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

  // 다음 날 이후의 과제를 오늘(플랜일)로 당겨오고, 그 뒤 일정은 다시 계산한다.
  // 오늘 이미 있던 항목은 그대로 두기 위해 모두 고정(pinned)한다.
  function pullToToday(date, id, done = false) {
    const cur = state.currentDay;
    if (date <= cur || cur > LAST_EXAM) return false;
    const arr = state.schedule[date] || [];
    const i = arr.findIndex(x => x.id === id);
    if (i < 0 || arr[i].type !== 'task') return false;
    const [it] = arr.splice(i, 1);
    if (!arr.length) delete state.schedule[date];
    const todayItems = (state.schedule[cur] ||= []);
    todayItems.forEach(x => { x.pinned = true; });
    todayItems.push({ ...it, date: cur, pinned: true, done, pulledFrom: date, from: null, due: null });
    if (done) {
      const t = taskById(it.taskId);
      if (t) { t.done = true; t.doneOn = cur; }
    }
    replan(cur);
    state.log.unshift({ at: Date.now(), msg: `${SUBJ[it.subj].short} ‘${it.title}’ ${fmtShort(date)} → ${fmt(cur)}로 당김 · 이후 일정 재계산` });
    state.log = state.log.slice(0, 20);
    save();
    renderAll();
    toast(`${fmtShort(date)} 과제를 오늘로 당기고 이후 일정을 다시 계산했습니다.`);
    return true;
  }
  // 오늘 이후 가장 가까운 날의 첫 과제
  function nextPullable() {
    for (let d = addDays(state.currentDay, 1); d <= LAST_EXAM; d = addDays(d, 1)) {
      const it = itemsOf(d).find(x => x.type === 'task' && !x.done);
      if (it) return { date: d, it };
    }
    return null;
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
    if ($('mulHint')) $('mulHint').textContent = `현재 적용: ${state.mulUsed}배 · 영상강의 1개 ${h(VIDEO_LEN * state.mulUsed)}`;
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
      case 'skim': return [it.gap > 1 ? `${it.gap}일 복습` : '훑어보기', 'review'];
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
              : it.from ? `<span class="pill carry">${fmtShort(it.from)}에서 이월</span>`
              : it.pulledFrom ? `<span class="pill review">${fmtShort(it.pulledFrom)}에서 당김</span>` : '';
            const pull = it.type === 'task' && !it.done && d > cur && cur <= LAST_EXAM
              ? `<button type="button" class="mini-btn" data-pull="${esc(it.id)}" data-date="${d}">오늘 하기</button>` : '';
            return `<div class="item${it.done ? ' done' : ''}${it.carried ? ' carried' : ''}">
              <input type="checkbox" id="${esc(cid)}" data-date="${d}" data-id="${esc(it.id)}" ${it.done ? 'checked' : ''} ${closed ? 'disabled' : ''}>
              <label class="item-body" for="${esc(cid)}">
                <span class="item-title">${esc(it.title)}</span>
                ${it.detail ? `<span class="item-detail">${esc(it.detail)}</span>` : ''}
                ${it.due && !it.done && !closed ? `<span class="item-detail">수업 전 마감 ${fmt(it.due)}</span>` : ''}
              </label>
              <span class="item-side">${pull}${status}${late ? '<span class="pill late">마감 지남</span>' : ''}<span class="pill ${cls}">${lab}</span><span class="hrs">${h(it.hours)}</span></span>
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
        <span class="ev-time">${esc(eventRange(e))}</span>
        <span class="ev-text">${esc(e.text)}</span>
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
    const n = cur <= LAST_EXAM && curItems.length && !left.length ? nextPullable() : null;
    const pb = $('pullBtn');
    pb.hidden = !n;
    if (n) pb.textContent = `내일 과제 당겨오기 (${fmtShort(n.date)} ${SUBJ[n.it.subj].short})`;
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
        `<span class="chip"><i class="dot" style="--c:${color(s.id)}"></i>${esc(s.short)}<b>${+bySubj[s.id].toFixed(1)}</b></span>`).join('');
      const doneN = items.filter(i => i.done).length;
      const carriedN = items.filter(i => i.carried).length;
      const foot = [];
      if (items.length && d <= cur) foot.push(`<span class="${doneN === items.length ? 'ok' : ''}">✓ ${doneN}/${items.length}</span>`);
      if (carriedN) foot.push(`<span class="miss">이월 ${carriedN}</span>`);
      const evN = state.events.filter(e => e.date === d).length;
      if (evN) foot.push(`<span>일정 ${evN}</span>`);
      const pct = cap ? Math.min(100, used / cap * 100) : 0;
      cells.push(`<button type="button" class="${cls.join(' ')}" data-day="${d}" aria-label="${fmt(d)} ${h(used)} 배정">
        <span class="cell-top"><span class="cell-date">${fmtShort(d)}</span><span class="cell-cap">${d <= LAST_EXAM ? `${+used.toFixed(1)}/${+cap.toFixed(1)}h` : ''}</span></span>
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
    $('classGrid').innerHTML = SUBJECTS.map(s => `<label>${esc(s.name)}<select id="cd-${s.id}">${opts(st.classDays[s.id])}</select></label>`).join('');
    $('sMul').innerHTML = `<option value="auto">자동 (시험 전까지 들어가는 최대 배율)</option>` +
      VIDEO_MULS.map(m => `<option value="${m}">${m}배 · 영상 1개 ${h(VIDEO_LEN * m)}</option>`).join('');
    $('sMul').value = String(st.videoMul);
    $('mulHint').textContent = `현재 적용: ${state.mulUsed}배 · 영상강의 1개 ${h(VIDEO_LEN * state.mulUsed)}`;
    $('sOffline').value = st.offlineH;
    $('sSkim').value = Math.round(st.skimH * 60);
    $('sSpaced').value = Math.round(st.spacedH * 60);
    $('sGaps').value = (st.gaps || []).join(', ');
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
      // 미리 끝낸 다음 날 과제 → 오늘 한 것으로 옮기고 이후 일정 재계산
      if (cb.checked && it.type === 'task' && cb.dataset.date > state.currentDay && state.currentDay <= LAST_EXAM) {
        pullToToday(cb.dataset.date, it.id, true);
        return;
      }
      it.done = cb.checked;
      if (it.type === 'task') {
        const t = taskById(it.taskId);
        if (t) { t.done = cb.checked; t.doneOn = cb.checked ? cb.dataset.date : null; }
      }
      save();
      renderAll();
    });

    $('checklist').addEventListener('click', e => {
      const b = e.target.closest('[data-pull]');
      if (!b) return;
      pullToToday(b.dataset.date, b.dataset.pull);
    });
    $('pullBtn').addEventListener('click', () => {
      const n = nextPullable();
      if (n) pullToToday(n.date, n.it.id);
    });

    $('eventForm').addEventListener('submit', e => {
      e.preventDefault();
      const text = $('evText').value.trim();
      if (!text) return;
      const timeRaw = $('evTime').value.trim();
      let time = '';
      if (timeRaw) {
        const m = /^(\d{1,2}):?(\d{2})$/.exec(timeRaw);
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
          toast('시간은 00:00 ~ 23:59 형식으로 입력하세요. 예) 15:00');
          $('evTime').focus();
          return;
        }
        time = `${pad(Number(m[1]))}:${m[2]}`;
      }
      const mins = Math.max(0, Math.round(Number($('evMins').value) || 0));
      const ev = { id: uid('e'), date: ui.selected, time, text, mins, done: false };
      state.events.push(ev);
      $('evText').value = ''; $('evMins').value = ''; $('evTime').value = '';
      if (mins > 0 && ui.selected >= state.currentDay) {
        replanFromToday(`${fmt(ui.selected)} 개인 일정 ${eventRange(ev)} 추가(공부 −${minsText(mins)})`);
        toast(`${eventRange(ev)} 일정을 반영해 공부시간 ${minsText(mins)}을 빼고 다시 계산했습니다.`);
      } else { save(); renderAll(); }
    });
    // 시간 입력: 숫자만 받아 HH:MM 으로 자동 정리
    $('evTime').addEventListener('input', e => {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
      e.target.value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
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
      if (ev && Number(ev.mins) > 0 && ev.date >= state.currentDay) replanFromToday(`${fmt(ev.date)} 개인 일정 삭제`);
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
      st.videoMul = $('sMul').value === 'auto' ? 'auto' : Number($('sMul').value);
      st.offlineH = num('sOffline', 0.25, 4, st.offlineH);
      st.skimH = num('sSkim', 0, 60, st.skimH * 60) / 60;
      st.spacedH = num('sSpaced', 0, 60, st.spacedH * 60) / 60;
      const g = $('sGaps').value.split(/[^0-9]+/).map(Number).filter(x => x >= 1 && x <= 30);
      st.gaps = [...new Set(g)].sort((a, b) => a - b);
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
    state = migrateV1() || freshState();
    replan(state.currentDay);
    save(false);
  } else if (normalize()) {
    replan(state.currentDay);
    save(false);
  }
  ui.selected = clampBoard(state.currentDay);
  bind();
  renderSettings();
  renderAll();
  tick();
  setInterval(tick, 1000);
  cloud.setStatus('local');
  cloud.connect();
})();
