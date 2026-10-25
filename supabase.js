// ==========================================
// [ECLIPSE Guild Management System]
// Supabase REST API 통신 공통 모듈 (supabase.js)
// ==========================================

const SUPABASE_CONFIG = {
  url: "https://yakvjsnzqgycdbasbnfe.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlha3Zqc256cWd5Y2RiYXNibmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNTg4NTQsImV4cCI6MjEwNzYzNDg1NH0.TBheUmh9Z4RPCI-UXyb3yDSfjlYNShpzX7tZLm-4Qgw"
};

/**
 * 현재 접속 중인 길드 고유 ID(guild_id) 반환 공통 함수
 * localStorage에 값이 없거나 'null', 'undefined' 문자열인 경우 안전하게 'default' 반환
 * @returns {string}
 */
function getCurrentGuildId() {
  try {
    const raw = localStorage.getItem("current_guild_id");
    if (!raw) return "default";
    const trimmed = String(raw).trim();
    if (!trimmed || trimmed === "null" || trimmed === "undefined") {
      return "default";
    }
    return trimmed;
  } catch (e) {
    return "default";
  }
}
window.getCurrentGuildId = getCurrentGuildId;

/**
 * Supabase REST API 직접 호출 공통 함수
 * @param {string} endpoint - 테이블명 및 쿼리 파라미터 (예: 'guild_members?select=*')
 * @param {string} method - GET, POST, PATCH, DELETE
 * @param {object|array|null} body - 전송할 JSON 데이터
 * @param {object} extraHeaders - 추가 HTTP 헤더
 */
async function apiRequest(endpoint, method = "GET", body = null, extraHeaders = {}) {
  const url = `${SUPABASE_CONFIG.url}/rest/v1/${endpoint}`;
  const headers = {
    "apikey": SUPABASE_CONFIG.anonKey,
    "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
    ...extraHeaders
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || `HTTP ${res.status}`);
  }
  
  // 204 No Content 등 본문이 없는 응답 방어
  if (res.status === 204) return null;
  return await res.json();
}
window.apiRequest = apiRequest;

/**
 * 특정 길드(guild_id)의 guild_settings 전체를 { key: value } 객체(Map) 형태로 조회
 * @param {string} [guildId] - 생략 시 getCurrentGuildId() 사용
 * @returns {Promise<Object>}
 */
async function fetchGuildSettingsMap(guildId) {
  const targetGid = (guildId && String(guildId).trim()) ? String(guildId).trim() : getCurrentGuildId();
  const map = {};
  try {
    const rows = await apiRequest(
      `guild_settings?guild_id=eq.${encodeURIComponent(targetGid)}&select=key,value`
    );
    if (Array.isArray(rows)) {
      rows.forEach(item => {
        if (item && item.key) {
          map[item.key] = item.value;
        }
      });
    }
  } catch (e) {
    console.warn("fetchGuildSettingsMap 오류:", e);
  }
  return map;
}
window.fetchGuildSettingsMap = fetchGuildSettingsMap;

/**
 * 길드별 환경설정(guild_settings) 안전한 Upsert 저장 공통 함수
 * UNIQUE(guild_id, key) 제약조건을 활용해 중복 행 없이 생성 또는 갱신
 * @param {string} key - 설정 키 이름 (예: 'guild_name', 'score_base')
 * @param {string|number|boolean} value - 저장할 설정 값
 * @param {string} [guildId] - 생략 시 getCurrentGuildId() 사용
 */
async function upsertGuildSetting(key, value, guildId) {
  const targetGid = (guildId && String(guildId).trim()) ? String(guildId).trim() : getCurrentGuildId();
  const valStr = (value === null || value === undefined) ? "" : String(value);

  try {
    return await apiRequest(
      "guild_settings?on_conflict=guild_id,key",
      "POST",
      [{
        guild_id: targetGid,
        key: String(key).trim(),
        value: valStr,
        updated_at: new Date().toISOString()
      }],
      {
        "Prefer": "resolution=merge-duplicates,return=representation"
      }
    );
  } catch (err) {
    // 만약 on_conflict 호출이 실패할 경우 안전하게 조회 후 PATCH/POST 폴백 수행
    const existing = await apiRequest(
      `guild_settings?guild_id=eq.${encodeURIComponent(targetGid)}&key=eq.${encodeURIComponent(key)}&select=id`
    );
    if (Array.isArray(existing) && existing.length > 0) {
      return await apiRequest(
        `guild_settings?guild_id=eq.${encodeURIComponent(targetGid)}&key=eq.${encodeURIComponent(key)}`,
        "PATCH",
        { value: valStr, updated_at: new Date().toISOString() }
      );
    } else {
      return await apiRequest(
        "guild_settings",
        "POST",
        [{ guild_id: targetGid, key: String(key).trim(), value: valStr }]
      );
    }
  }
}
window.upsertGuildSetting = upsertGuildSetting;

// ==========================================
// 🕒 [KST 표준 타임존 변환 유틸리티]
// 브라우저 타임존 오차 및 자정 전후(0~9시) 날짜 밀림 방지
// ==========================================

/**
 * 어떤 Date 객체나 날짜 문자열이 들어와도 정확한 한국 기준 'YYYY-MM-DD'로 반환
 * @param {Date|string|number} dateInput 
 * @returns {string} 예: "2026-10-11"
 */
function getKSTDateString(dateInput = new Date()) {
  const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return "";

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value || '';
  const m = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  return `${y}-${m}-${day}`;
}

/**
 * input type="datetime-local" 입력창에 들어갈 'YYYY-MM-DDTHH:mm' 형식 반환
 * @param {Date|string|number} dateInput 
 * @returns {string} 예: "2026-10-11T14:30"
 */
function getKSTDateTimeLocalString(dateInput = new Date()) {
  const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return "";

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value || '';
  const m = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  let hour = parts.find(p => p.type === 'hour')?.value || '00';
  const min = parts.find(p => p.type === 'minute')?.value || '00';

  // 24시 표기 방어
  if (hour === '24') hour = '00';

  return `${y}-${m}-${day}T${hour}:${min}`;
}
